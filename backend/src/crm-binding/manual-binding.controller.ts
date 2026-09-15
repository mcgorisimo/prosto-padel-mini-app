import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  readAuthenticatedSessionPrincipal,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { ManualBindingService } from './manual-binding.service';
import { positiveId } from './yclients-client-lookup';

function inputs(
  request: FastifyRequest,
  target: unknown,
  query: Record<string, unknown>,
  body: unknown,
  keys: string[],
) {
  const principal = readAuthenticatedSessionPrincipal(request);
  if (!principal)
    throw new HttpException(
      { code: 'session_invalid', message: 'Session is invalid' },
      401,
    );
  if (
    !isAccountId(target) ||
    Object.keys(query).length ||
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(body, k))
  ) {
    throw new HttpException(
      { code: 'crm_binding_invalid_request', message: 'Request is invalid' },
      400,
    );
  }
  return {
    actor: principal.accountId,
    target,
    body: body as Record<string, unknown>,
  };
}
function invalid(): never {
  throw new HttpException(
    { code: 'crm_binding_invalid_request', message: 'Request is invalid' },
    400,
  );
}

@Controller('admin/players/:playerId/crm-binding')
@UseGuards(SessionBearerGuard)
export class ManualBindingController {
  constructor(private readonly service: ManualBindingService) {}
  @Post('preview')
  @HttpCode(200)
  preview(
    @Req() request: FastifyRequest,
    @Param('playerId') target: unknown,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    const input = inputs(request, target, query, body, ['clientId']);
    if (!positiveId(input.body.clientId)) invalid();
    return this.service.preview(input.actor, input.target, input.body.clientId);
  }
  @Post('confirm')
  @HttpCode(200)
  confirm(
    @Req() request: FastifyRequest,
    @Param('playerId') target: unknown,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    const input = inputs(request, target, query, body, [
      'draftId',
      'identityChecked',
    ]);
    if (
      !isInternalUuid(input.body.draftId) ||
      input.body.identityChecked !== true
    )
      invalid();
    return this.service.confirm(
      input.actor,
      input.target,
      input.body.draftId,
      true,
    );
  }
}
