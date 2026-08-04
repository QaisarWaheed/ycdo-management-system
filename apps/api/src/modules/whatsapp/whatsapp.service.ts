import { Injectable, Logger } from '@nestjs/common';
import { LetterType, WhatsAppSendStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePakistanPhone } from './phone.util';

const GRAPH_VERSION = 'v21.0';

type DeliverInput = {
  letterId: string;
  employeeId: string;
  employeeName: string;
  letterType: LetterType;
  phone?: string | null;
  fileUrl?: string | null;
  pdfBuffer?: Buffer;
  filename?: string;
};

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
    const phoneE164 = normalizePakistanPhone(input.phone) ?? '';
    const filename =
      input.filename ??
      `${input.letterType.toLowerCase()}-${input.letterId.slice(0, 8)}.pdf`;

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

    if (!input.fileUrl && !input.pdfBuffer) {
      await this.upsertSend(input, {
        phoneE164,
        status: WhatsAppSendStatus.SKIPPED,
        error: 'No letter PDF available',
      });
      return;
    }

    await this.upsertSend(input, {
      phoneE164,
      status: WhatsAppSendStatus.PENDING,
      error: null,
    });

    try {
      const pdfBuffer =
        input.pdfBuffer ?? (await this.loadPdfBuffer(input.fileUrl!));
      const mediaId = await this.uploadMedia(pdfBuffer, filename);
      const metaMessageId = await this.sendTemplateDocument({
        phoneE164,
        mediaId,
        filename,
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

  private async loadPdfBuffer(fileUrl: string): Promise<Buffer> {
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

  private async uploadMedia(pdfBuffer: Buffer, filename: string): Promise<string> {
    const token = process.env.WHATSAPP_TOKEN!;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append(
      'file',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
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

  private async sendTemplateDocument(params: {
    phoneE164: string;
    mediaId: string;
    filename: string;
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
                    type: 'document',
                    document: {
                      id: params.mediaId,
                      filename: params.filename,
                    },
                  },
                ],
              },
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: params.employeeName },
                  {
                    type: 'text',
                    text: params.letterType.replace(/_/g, ' '),
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
}
