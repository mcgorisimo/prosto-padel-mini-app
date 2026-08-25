import { InternalUuid, newInternalUuid } from '../internal-uuid';

export const REQUEST_ID_HEADER = 'x-request-id';

export function newRequestId(): InternalUuid {
  return newInternalUuid();
}
