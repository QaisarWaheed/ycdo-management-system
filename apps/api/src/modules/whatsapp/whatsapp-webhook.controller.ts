import { Body, Controller, Get, HttpCode, Logger, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WhatsAppSendStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Meta WhatsApp Cloud API webhook — deliberately unauthenticated (no JwtAuthGuard):
 * Meta calls this directly, it never carries a session JWT. Verification is the
 * GET handshake (hub.verify_token) required once when registering the callback
 * URL in the Meta App Dashboard; POST receives ongoing delivery-status events.
 */
@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private prisma: PrismaService) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected) {
      this.logger.log('Webhook verification succeeded');
      res.status(200).send(challenge);
      return;
    }
    this.logger.warn(`Webhook verification failed (mode=${mode})`);
    res.status(403).send('Forbidden');
  }

  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown) {
    // Always ack 200 even on internal errors — Meta disables a webhook that
    // repeatedly responds non-200 or times out.
    try {
      await this.handleEvent(body);
    } catch (err) {
      this.logger.error(
        'Error processing WhatsApp webhook event',
        err instanceof Error ? err.stack : String(err),
      );
    }
    return { received: true };
  }

  private async handleEvent(body: unknown) {
    const entries = (body as { entry?: unknown[] } | null)?.entry;
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] } | null)?.changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        const value = (change as { value?: Record<string, unknown> } | null)
          ?.value;
        const statuses = value?.statuses as
          | Array<{
              id?: string;
              status?: string;
              errors?: Array<{ title?: string; message?: string }>;
            }>
          | undefined;

        if (!Array.isArray(statuses)) continue;

        for (const status of statuses) {
          this.logger.log(
            `WhatsApp status update: ${status.id ?? '?'} -> ${status.status ?? '?'}`,
          );

          if (status.status === 'failed' && status.id) {
            const errorMessage =
              status.errors?.[0]?.message ??
              status.errors?.[0]?.title ??
              'Delivery failed';
            await this.prisma.whatsAppLetterSend
              .updateMany({
                where: { metaMessageId: status.id },
                data: {
                  status: WhatsAppSendStatus.FAILED,
                  error: errorMessage.slice(0, 1000),
                },
              })
              .catch((err) =>
                this.logger.error(
                  'Failed to record WhatsApp delivery failure',
                  err instanceof Error ? err.stack : String(err),
                ),
              );
          }
        }
      }
    }
  }
}
