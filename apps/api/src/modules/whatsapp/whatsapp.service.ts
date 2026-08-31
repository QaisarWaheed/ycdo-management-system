import { Injectable, Logger } from '@nestjs/common';
import { LetterType, WhatsAppSendStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePakistanPhone } from './phone.util';
import { generateJpeg, generateJpegFromPdf } from '../letters/pdf.helper';

const GRAPH_VERSION = 'v21.0';

interface DeliverInput {
  letterId: string;
  employeeId: string;
  employeeName: string;
  letterType: LetterType;
  phone?: string | null;
  fileUrl?: string | null;
  pdfBuffer?: Buffer;
  htmlContent?: string;
  filename?: string;
}

function jpgFilename(
  filename: string | undefined,
  letterType: LetterType,
  letterId: string,
): string {
  const base =
    filename ?? `${letterType.toLowerCase()}-${letterId.slice(0, 8)}.jpg`;
  return base.replace(/\.pdf$/i, '.jpg').replace(/\.png$/i, '.jpg');
}

async function jpegBufferForWhatsApp(input: DeliverInput): Promise<Buffer> {
  if (input.htmlContent) {
    return generateJpeg(input.htmlContent);
  }
  const pdfBuffer =
    input.pdfBuffer ??
    (input.fileUrl ? await loadPdfFile(input.fileUrl) : undefined);
  if (!pdfBuffer) {
    throw new Error('No letter file available');
  }
  return generateJpegFromPdf(pdfBuffer);
}

async function loadPdfFile(fileUrl: string): Promise<Buffer> {
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new Error(`Failed to download PDF (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  const relative = fileUrl.replace(/^\//, '');
  const filePath = path.join(process.cwd(), relative);
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF file missing: ${fileUrl}`);
  }
  return fs.readFileSync(filePath);
}

function whatsappLetterTypeLabel(letterType: LetterType): string {
  if (letterType === LetterType.SUSPENSION_ELIGIBILITY) {
    return 'Eligibility for Suspension notice (not a suspension)';
  }
  if (letterType === LetterType.NEAR_SUSPENSION_WARNING) {
    return 'Warning of approaching suspension (not a suspension)';
  }
  return letterType.replace(/_/g, ' ');
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private prisma: PrismaService) {}

  isConfigured(): boolean {
    return Boolean(
      process.env.WHATSAPP_TOKEN?.trim() &&
        process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
    );
  }

  async deliverAfterLetterGenerated(input: DeliverInput): Promise<void> {
    try {
      await this.deliver(input);
    } catch (err) {
      this.logger.error(
        `WhatsApp deliver failed for letter ${input.letterId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async deliver(input: DeliverInput) {
    const existingSend = await this.prisma.whatsAppLetterSend.findUnique({
      where: { letterId: input.letterId },
    });
    if (existingSend?.status === WhatsAppSendStatus.SENT) {
      return existingSend;
    }

    const phoneE164 = normalizePakistanPhone(input.phone) ?? '';
    const filename = jpgFilename(input.filename, input.letterType, input.letterId);

    if (!this.isConfigured()) {
      await this.upsertSend(input, {
        phoneE164: phoneE164 || 'n/a',
        status: WhatsAppSendStatus.SKIPPED,
        error: 'Meta WhatsApp not configured',
      });
      return;
    }

    if (!phoneE164) {
      await this.upsertSend(input, {
        phoneE164: 'n/a',
        status: WhatsAppSendStatus.SKIPPED,
        error: 'Missing or invalid employee phone',
      });
      return;
    }

    if (!input.fileUrl && !input.pdfBuffer && !input.htmlContent) {
      await this.upsertSend(input, {
        phoneE164,
        status: WhatsAppSendStatus.SKIPPED,
        error: 'No letter file available',
      });
      return;
    }

    await this.upsertSend(input, {
      phoneE164,
      status: WhatsAppSendStatus.PENDING,
      error: null,
    });

    try {
      const jpegBuffer = await jpegBufferForWhatsApp(input);
      const mediaId = await this.uploadMedia(
        jpegBuffer,
        filename,
        'image/jpeg',
      );
      const metaMessageId = await this.sendTemplateImage({
        phoneE164,
        mediaId,
        employeeName: input.employeeName,
        letterType: input.letterType,
      });

      await this.upsertSend(input, {
        phoneE164,
        status: WhatsAppSendStatus.SENT,
        error: null,
        metaMessageId,
        bumpAttempts: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.upsertSend(input, {
        phoneE164,
        status: WhatsAppSendStatus.FAILED,
        error: message.slice(0, 1000),
        bumpAttempts: true,
      });
      throw err;
    }
  }

  async listFailed() {
    return this.prisma.whatsAppLetterSend.findMany({
      where: { status: WhatsAppSendStatus.FAILED },
      orderBy: { lastTriedAt: 'desc' },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            phone: true,
          },
        },
        letter: {
          select: {
            id: true,
            letterType: true,
            letterNo: true,
            fileUrl: true,
            generatedAt: true,
          },
        },
      },
    });
  }

  async resend(id: string) {
    const row = await this.prisma.whatsAppLetterSend.findUnique({
      where: { id },
      include: {
        letter: true,
        employee: { select: { fullName: true, phone: true } },
      },
    });

    if (!row) {
      throw new Error('WhatsApp send record not found');
    }

    await this.deliver({
      letterId: row.letterId,
      employeeId: row.employeeId,
      employeeName: row.employee.fullName,
      letterType: row.letter.letterType,
      phone: row.employee.phone,
      fileUrl: row.letter.fileUrl,
    });

    return this.prisma.whatsAppLetterSend.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            phone: true,
          },
        },
        letter: {
          select: {
            id: true,
            letterType: true,
            letterNo: true,
            fileUrl: true,
            generatedAt: true,
          },
        },
      },
    });
  }

  private async upsertSend(
    input: DeliverInput,
    data: {
      phoneE164: string;
      status: WhatsAppSendStatus;
      error: string | null;
      metaMessageId?: string | null;
      bumpAttempts?: boolean;
    },
  ) {
    const existing = await this.prisma.whatsAppLetterSend.findUnique({
      where: { letterId: input.letterId },
    });

    if (existing) {
      return this.prisma.whatsAppLetterSend.update({
        where: { letterId: input.letterId },
        data: {
          phoneE164: data.phoneE164,
          status: data.status,
          error: data.error,
          metaMessageId: data.metaMessageId ?? existing.metaMessageId,
          lastTriedAt: new Date(),
          ...(data.bumpAttempts ? { attempts: { increment: 1 } } : {}),
        },
      });
    }

    return this.prisma.whatsAppLetterSend.create({
      data: {
        letterId: input.letterId,
        employeeId: input.employeeId,
        phoneE164: data.phoneE164,
        status: data.status,
        error: data.error,
        metaMessageId: data.metaMessageId ?? undefined,
        attempts: data.bumpAttempts ? 1 : 0,
        lastTriedAt: new Date(),
      },
    });
  }

  private async uploadMedia(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    const token = process.env.WHATSAPP_TOKEN!;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      filename,
    );

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );

    const body = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok || !body.id) {
      throw new Error(body.error?.message ?? `Media upload failed (${res.status})`);
    }
    return body.id;
  }

  private async sendTemplateImage(params: {
    phoneE164: string;
    mediaId: string;
    employeeName: string;
    letterType: LetterType;
  }): Promise<string | undefined> {
    const token = process.env.WHATSAPP_TOKEN!;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    const templateName =
      process.env.WHATSAPP_TEMPLATE_NAME?.trim() || 'employee_letter_issued';
    const lang = process.env.WHATSAPP_TEMPLATE_LANG?.trim() || 'en';

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: params.phoneE164,
          type: 'template',
          template: {
            name: templateName,
            language: { code: lang },
            components: [
              {
                type: 'header',
                parameters: [
                  {
                    type: 'image',
                    image: { id: params.mediaId },
                  },
                ],
              },
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: params.employeeName },
                  {
                    type: 'text',
                    text: whatsappLetterTypeLabel(params.letterType),
                  },
                ],
              },
            ],
          },
        }),
      },
    );

    const body = (await res.json()) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(body.error?.message ?? `Message send failed (${res.status})`);
    }
    return body.messages?.[0]?.id;
  }

  /**
   * Session/free-form text. Fails quietly for the caller when Meta is not
   * configured or the number is missing; logs and returns skipped/failed.
   */
  async sendPlainText(input: {
    phone?: string | null;
    body: string;
    context: string;
  }): Promise<{ sent: boolean; skippedReason?: string }> {
    const phoneE164 = normalizePakistanPhone(input.phone) ?? '';
    if (!this.isConfigured()) {
      this.logger.warn(`WhatsApp text skipped (${input.context}): not configured`);
      return { sent: false, skippedReason: 'not_configured' };
    }
    if (!phoneE164) {
      this.logger.warn(`WhatsApp text skipped (${input.context}): no phone`);
      return { sent: false, skippedReason: 'no_phone' };
    }

    const token = process.env.WHATSAPP_TOKEN!;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phoneE164,
            type: 'text',
            text: { body: input.body.slice(0, 4096), preview_url: true },
          }),
        },
      );
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message ?? `Message send failed (${res.status})`);
      }
      return { sent: true };
    } catch (err) {
      this.logger.error(
        `WhatsApp text failed (${input.context})`,
        err instanceof Error ? err.stack : String(err),
      );
      return { sent: false, skippedReason: err instanceof Error ? err.message : 'send_failed' };
    }
  }
}
