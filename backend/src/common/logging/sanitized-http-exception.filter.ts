import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { RequestContextStore } from './request-context.store';

const BACKEND_SERVICE = 'prosto-padel-backend';
const MISSING_REQUEST_ID = 'unavailable';

type BackendEnvironment = 'development' | 'test' | 'production';

type SafeErrorKind =
  | 'error'
  | 'http_exception'
  | 'range_error'
  | 'reference_error'
  | 'syntax_error'
  | 'type_error'
  | 'unknown_throwable';

const SAFE_RUNTIME_ERROR_CODES = new Map<string, string>([
  ['ECONNREFUSED', 'network_connection_refused'],
  ['ECONNRESET', 'network_connection_reset'],
  ['ENOTFOUND', 'network_host_not_found'],
  ['ETIMEDOUT', 'network_timeout'],
]);

const SAFE_SQLSTATE_CLASSES = new Map<string, string>([
  ['08', 'database_connection_error'],
  ['22', 'database_data_error'],
  ['23', 'database_integrity_error'],
  ['40', 'database_transaction_rollback'],
  ['42', 'database_access_or_query_error'],
  ['53', 'database_resource_error'],
  ['57', 'database_operator_intervention'],
  ['58', 'database_system_error'],
]);

const INTERNAL_ERROR_RESPONSE = Object.freeze({
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  message: 'Internal server error',
});

function publicHttpExceptionResponse(exception: HttpException): unknown {
  const response = exception.getResponse();
  if (typeof response === 'object' && response !== null) {
    return response;
  }

  return {
    statusCode: exception.getStatus(),
    message: response,
  };
}

function safeErrorKind(exception: unknown): SafeErrorKind {
  if (exception instanceof TypeError) return 'type_error';
  if (exception instanceof RangeError) return 'range_error';
  if (exception instanceof ReferenceError) return 'reference_error';
  if (exception instanceof SyntaxError) return 'syntax_error';
  if (exception instanceof Error) return 'error';
  return 'unknown_throwable';
}

function errorCode(exception: unknown): unknown {
  if (typeof exception !== 'object' || exception === null) return undefined;
  try {
    return Reflect.get(exception, 'code');
  } catch {
    return undefined;
  }
}

function safeErrorCode(exception: unknown): string {
  const code = errorCode(exception);
  if (typeof code !== 'string') return 'unclassified_error';

  const runtimeCode = SAFE_RUNTIME_ERROR_CODES.get(code);
  if (runtimeCode !== undefined) return runtimeCode;

  if (/^[0-9A-Z]{5}$/u.test(code)) {
    return (
      SAFE_SQLSTATE_CLASSES.get(code.slice(0, 2)) ?? 'database_other_error'
    );
  }

  return 'unclassified_error';
}

function safeHttpExceptionCode(exception: HttpException): string {
  const response = exception.getResponse();
  const code = errorCode(response);
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(code)
    ? code
    : 'http_server_error';
}

@Catch()
export class SanitizedHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  constructor(
    private readonly requestContexts: RequestContextStore,
    private readonly environment: BackendEnvironment,
    private readonly release: string,
  ) {}

  private logServerException(
    statusCode: number,
    errorKind: SafeErrorKind,
    errorCode: string,
  ): void {
    try {
      this.logger.error(
        Object.freeze({
          event: 'http_request_exception',
          service: BACKEND_SERVICE,
          environment: this.environment,
          release: this.release,
          requestId: this.requestContexts.requestId() ?? MISSING_REQUEST_ID,
          statusCode,
          outcome: 'failure',
          errorKind,
          errorCode,
        }),
      );
    } catch {
      // Diagnostics must never replace the sanitized HTTP response.
    }
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (reply.sent) return;

    if (exception instanceof HttpException) {
      if (exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logServerException(
          exception.getStatus(),
          'http_exception',
          safeHttpExceptionCode(exception),
        );
      }
      reply
        .status(exception.getStatus())
        .send(publicHttpExceptionResponse(exception));
      return;
    }

    this.logServerException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      safeErrorKind(exception),
      safeErrorCode(exception),
    );
    reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send(INTERNAL_ERROR_RESPONSE);
  }
}
