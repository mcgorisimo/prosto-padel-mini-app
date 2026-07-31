import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { SessionBearerGuard } from '../auth/session-authentication.guard';
import { isUserGeneratedTextAllowed } from './content-moderation';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_TEXT_CODE_POINTS = 2_000;

function readText(value: unknown): string | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'text')
  ) {
    return undefined;
  }
  const text = (value as Record<string, unknown>).text;
  return typeof text === 'string' &&
    [...text].length <= MAX_TEXT_CODE_POINTS &&
    !CONTROL_CHARACTER_PATTERN.test(text)
    ? text
    : undefined;
}

function publicError(
  statusCode: number,
  code: string,
  message: string,
): HttpException {
  return new HttpException(
    Object.freeze({ statusCode, code, message }),
    statusCode,
  );
}

@Controller('content/moderation')
export class ContentModerationController {
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionBearerGuard)
  moderate(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): void {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
    const text = readText(body);
    if (text === undefined) {
      throw publicError(
        HttpStatus.BAD_REQUEST,
        'content_moderation_invalid_request',
        'Content moderation request is invalid',
      );
    }
    if (!isUserGeneratedTextAllowed(text)) {
      throw publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'content_not_allowed',
        'Content contains disallowed language',
      );
    }
  }
}
