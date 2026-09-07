import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import {
  readAuthenticatedSessionPrincipal,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import type {
  MembershipCatalogResponse,
  OwnMembershipsResponse,
} from './membership-read.types';

function requireAuthenticatedRead(
  request: FastifyRequest,
  query: Record<string, unknown>,
): void {
  if (!readAuthenticatedSessionPrincipal(request)) {
    throw new HttpException(
      {
        statusCode: 401,
        code: 'session_invalid',
        message: 'Session is invalid',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (Object.keys(query).length !== 0) {
    throw new HttpException(
      {
        statusCode: 400,
        code: 'membership_read_invalid_request',
        message: 'Membership read request is invalid',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
@Controller('memberships')
@UseGuards(SessionBearerGuard)
export class MembershipsController {
  @Get('mine')
  readMine(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, unknown>,
  ): OwnMembershipsResponse {
    requireAuthenticatedRead(request, query);
    // A profile phone/email or a reservation-local YCLIENTS client ID is not
    // proof that this account owns a CRM client. Keep the read closed until a
    // durable account-to-client binding and canonical membership contract exist.
    return Object.freeze({
      outcome: 'not_configured',
      memberships: Object.freeze([] as const),
    });
  }

  @Get('catalog')
  readCatalog(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, unknown>,
  ): MembershipCatalogResponse {
    requireAuthenticatedRead(request, query);
    // Bookable YCLIENTS services are not proof of a published membership
    // catalog. Do not expose products until a reviewed publication source exists.
    return Object.freeze({
      outcome: 'not_configured',
      products: Object.freeze([] as const),
    });
  }
}
