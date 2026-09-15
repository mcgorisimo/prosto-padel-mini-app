import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import {
  readAuthenticatedSessionPrincipal,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { CrmBindingService } from './crm-binding.service';
import { ManualBindingService } from './manual-binding.service';
import { Optional } from '@nestjs/common';

function owner(
  request: FastifyRequest,
  query: Record<string, unknown>,
  body?: unknown,
) {
  const principal = readAuthenticatedSessionPrincipal(request);
  if (!principal)
    throw new HttpException(
      { code: 'session_invalid', message: 'Session is invalid' },
      401,
    );
  if (principal.role !== 'player')
    throw new HttpException(
      { code: 'crm_binding_forbidden', message: 'Request is forbidden' },
      403,
    );
  if (
    Object.keys(query).length ||
    (body !== undefined &&
      (typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length))
  ) {
    throw new HttpException(
      { code: 'crm_binding_invalid_request', message: 'Request is invalid' },
      400,
    );
  }
  return principal.accountId;
}

@Controller('profile/crm-binding')
@UseGuards(SessionBearerGuard)
export class CrmBindingController {
  constructor(
    private readonly service: CrmBindingService,
    @Optional() private readonly manual?: ManualBindingService,
  ) {}
  @Get()
  status(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, unknown>,
  ) {
    const accountId = owner(request, query);
    return this.manual
      ? this.manual.ownStatus(accountId)
      : this.service.status(accountId);
  }
  @Post()
  @HttpCode(200)
  bind(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return this.service.bind(owner(request, query, body));
  }
}
