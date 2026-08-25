import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyReply, FastifyRequest } from 'fastify';
import { InternalUuid } from '../internal-uuid';
import { RequestContextStore } from './request-context.store';
import { REQUEST_ID_HEADER, newRequestId } from './request-id';
import { SanitizedHttpExceptionFilter } from './sanitized-http-exception.filter';

const BACKEND_SERVICE = 'prosto-padel-backend';
const UNKNOWN_ROUTE = 'unmatched';
const MAX_ROUTE_LENGTH = 256;
const HTTP_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);

type BackendEnvironment = 'development' | 'test' | 'production';

type RequestState = {
  readonly requestId: InternalUuid;
  readonly startedAt: bigint;
};

type HttpRequestOutcome = 'success' | 'rejected' | 'failure';

function safeMethod(method: string): string {
  return HTTP_METHODS.has(method) ? method : 'OTHER';
}

function safeRoute(request: FastifyRequest): string {
  const route = request.routeOptions.url;
  return typeof route === 'string' && route.length <= MAX_ROUTE_LENGTH
    ? route
    : UNKNOWN_ROUTE;
}

function requestOutcome(statusCode: number): HttpRequestOutcome {
  if (statusCode >= 500) return 'failure';
  if (statusCode >= 400) return 'rejected';
  return 'success';
}

function durationMilliseconds(startedAt: bigint): number {
  const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
  return Number(elapsedNanoseconds / 1_000_000n);
}

function isSuccessfulHealthCheck(route: string, statusCode: number): boolean {
  return statusCode < 400 && route.endsWith('/health');
}

function writeRequestLog(
  logger: Logger,
  request: FastifyRequest,
  reply: FastifyReply,
  state: RequestState,
  environment: BackendEnvironment,
  release: string,
): void {
  const route = safeRoute(request);
  if (isSuccessfulHealthCheck(route, reply.statusCode)) return;

  const event = Object.freeze({
    event: 'http_request_completed',
    service: BACKEND_SERVICE,
    environment,
    release,
    requestId: state.requestId,
    method: safeMethod(request.method),
    route,
    statusCode: reply.statusCode,
    durationMs: durationMilliseconds(state.startedAt),
    outcome: requestOutcome(reply.statusCode),
  });

  if (reply.statusCode >= 500) {
    logger.error(event);
    return;
  }
  if (reply.statusCode >= 400) {
    logger.warn(event);
    return;
  }
  logger.log(event);
}

export function registerBackendHttpLogging(
  application: NestFastifyApplication,
): void {
  const fastify = application.getHttpAdapter().getInstance();
  const requestContexts = application.get(RequestContextStore);
  const config = application.get(ConfigService);
  const environment = config.getOrThrow<BackendEnvironment>('NODE_ENV');
  const release = config.getOrThrow<string>('APP_RELEASE');
  const logger = new Logger('HttpRequest');
  const requestStates = new WeakMap<FastifyRequest, RequestState>();

  application.useGlobalFilters(
    new SanitizedHttpExceptionFilter(requestContexts, environment, release),
  );

  fastify.addHook('onRequest', (request, reply, done) => {
    const requestId = newRequestId();
    requestStates.set(request, {
      requestId,
      startedAt: process.hrtime.bigint(),
    });
    reply.header(REQUEST_ID_HEADER, requestId);
    requestContexts.run({ requestId }, done);
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const state = requestStates.get(request);
    requestStates.delete(request);
    if (state !== undefined) {
      try {
        writeRequestLog(logger, request, reply, state, environment, release);
      } catch {
        // Logging must never change an already completed HTTP response.
      }
    }
    done();
  });
}
