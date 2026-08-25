import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { InternalUuid } from '../internal-uuid';

export type BackendRequestContext = Readonly<{
  requestId: InternalUuid;
}>;

@Injectable()
export class RequestContextStore {
  private readonly storage = new AsyncLocalStorage<BackendRequestContext>();

  run<T>(context: BackendRequestContext, callback: () => T): T {
    return this.storage.run(Object.freeze({ ...context }), callback);
  }

  current(): BackendRequestContext | undefined {
    return this.storage.getStore();
  }

  requestId(): InternalUuid | undefined {
    return this.current()?.requestId;
  }
}
