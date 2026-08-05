import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import {
  isYclientsPositiveSafeInteger,
  isYclientsRecordEventType,
} from './yclients-webhook.types';
import {
  YclientsWebhookNotAvailableError,
  YclientsWebhookPersistenceError,
  YclientsWebhookService,
} from './yclients-webhook.service';

interface YclientsWebhookBody {
  readonly company_id: number;
  readonly resource: 'record';
  readonly resource_id: number;
  readonly status: 'create' | 'update' | 'delete';
  readonly data: Readonly<Record<string, unknown>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function parseWebhookBody(value: unknown): YclientsWebhookBody {
  if (
    !isPlainObject(value) ||
    !isYclientsPositiveSafeInteger(value.company_id) ||
    value.resource !== 'record' ||
    !isYclientsPositiveSafeInteger(value.resource_id) ||
    !isYclientsRecordEventType(value.status) ||
    !isPlainObject(value.data)
  ) {
    throw new HttpException(
      { code: 'YCLIENTS_WEBHOOK_INVALID', message: 'Invalid webhook payload' },
      HttpStatus.BAD_REQUEST,
    );
  }

  return Object.freeze({
    company_id: value.company_id,
    resource: 'record',
    resource_id: value.resource_id,
    status: value.status,
    data: value.data,
  });
}

function setPrivateResponseHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

@Controller('integrations/yclients')
export class YclientsWebhookController {
  constructor(private readonly webhooks: YclientsWebhookService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    setPrivateResponseHeaders(reply);
    const body = parseWebhookBody(rawBody);

    try {
      await this.webhooks.acceptRecordSignal({
        companyId: body.company_id,
        recordId: body.resource_id,
        eventType: body.status,
      });
    } catch (error) {
      if (error instanceof YclientsWebhookNotAvailableError) {
        throw new HttpException(
          {
            code: 'YCLIENTS_WEBHOOK_NOT_AVAILABLE',
            message: 'Webhook is not available',
          },
          HttpStatus.NOT_FOUND,
        );
      }
      if (error instanceof YclientsWebhookPersistenceError) {
        throw new HttpException(
          {
            code: 'YCLIENTS_WEBHOOK_UNAVAILABLE',
            message: 'Webhook is temporarily unavailable',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }
}
