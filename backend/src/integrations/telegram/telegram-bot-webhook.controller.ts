import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import {
  TelegramBotWebhookNotAvailableError,
  TelegramBotWebhookPersistenceError,
  TelegramBotWebhookService,
} from './telegram-bot-webhook.service';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function setPrivateResponseHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('X-Content-Type-Options', 'nosniff');
}

@Controller('integrations/telegram')
export class TelegramBotWebhookController {
  constructor(private readonly webhooks: TelegramBotWebhookService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(
    @Headers(SECRET_HEADER) secretHeader: string | undefined,
    @Body() rawUpdate: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    setPrivateResponseHeaders(reply);
    try {
      const outcome = await this.webhooks.accept(secretHeader, rawUpdate);
      if (outcome.outcome === 'reply') {
        await reply.code(HttpStatus.OK).send(outcome.response);
        return;
      }
      await reply.code(HttpStatus.NO_CONTENT).send();
    } catch (error) {
      if (error instanceof TelegramBotWebhookNotAvailableError) {
        await reply.code(HttpStatus.NOT_FOUND).send({
          code: 'TELEGRAM_BOT_WEBHOOK_NOT_FOUND',
          message: 'Not found',
        });
        return;
      }
      if (error instanceof TelegramBotWebhookPersistenceError) {
        await reply.code(HttpStatus.SERVICE_UNAVAILABLE).send({
          code: 'TELEGRAM_BOT_WEBHOOK_UNAVAILABLE',
          message: 'Webhook is temporarily unavailable',
        });
        return;
      }
      throw error;
    }
  }
}
