export const AUTH_INTEGRATION_HTTP_CLEANUP_ERROR_MESSAGE =
  'Auth integration HTTP fixture cleanup failed';

export class AuthIntegrationHttpCleanupError extends Error {
  readonly name = 'AuthIntegrationHttpCleanupError';

  constructor() {
    super(AUTH_INTEGRATION_HTTP_CLEANUP_ERROR_MESSAGE);
  }
}

export type AuthIntegrationCleanup = () => Promise<void>;
export type RegisterAuthIntegrationCleanup = (
  cleanup: AuthIntegrationCleanup,
) => void;

export async function runWithAuthIntegrationCleanup<T>(
  operation: (
    registerCleanup: RegisterAuthIntegrationCleanup,
  ) => Promise<T>,
): Promise<T> {
  const resourcesInCreationOrder: AuthIntegrationCleanup[] = [];
  const registerCleanup: RegisterAuthIntegrationCleanup = (cleanup) => {
    resourcesInCreationOrder.push(cleanup);
  };
  let operationFailed = false;
  let operationError: unknown;
  let operationResult: T | undefined;

  try {
    operationResult = await operation(registerCleanup);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let cleanupFailed = false;
  for (const close of [...resourcesInCreationOrder].reverse()) {
    try {
      await close();
    } catch {
      cleanupFailed = true;
    }
  }

  if (operationFailed) {
    throw operationError;
  }
  if (cleanupFailed) {
    throw new AuthIntegrationHttpCleanupError();
  }
  return operationResult as T;
}
