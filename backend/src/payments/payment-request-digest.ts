import { createHash } from 'node:crypto';
import { encodeLengthPrefixedUtf8 } from '../auth/crypto-encoding';
import {
  PaymentAttemptRequest,
  PaymentOrder,
  PaymentRequestDigest,
  isPaymentAttemptRequest,
  isPaymentOrder,
  paymentRequestDigest,
} from './payment.types';

const PAYMENT_ATTEMPT_REQUEST_DIGEST_DOMAIN =
  'prosto-padel.payments.attempt.request.v1';

export function digestPaymentAttemptRequest(
  order: PaymentOrder,
  request: PaymentAttemptRequest,
): PaymentRequestDigest {
  if (
    !isPaymentOrder(order) ||
    !isPaymentAttemptRequest(request) ||
    request.orderId !== order.orderId ||
    request.ownerAccountId !== order.ownerAccountId
  ) {
    throw new TypeError('Payment attempt request binding is invalid');
  }

  return paymentRequestDigest(
    createHash('sha256')
      .update(
        encodeLengthPrefixedUtf8([
          PAYMENT_ATTEMPT_REQUEST_DIGEST_DOMAIN,
          request.type,
          request.orderId,
          request.ownerAccountId,
          order.reservationId,
          String(order.amount.amountMinor),
          order.amount.currency,
          order.pricingContractVersion,
          order.pricingSnapshotDigest,
          order.receiptContractVersion,
          order.receiptContactSnapshotDigest,
          order.cancellationPolicyVersion,
          request.acquiringRouteId,
        ]),
      )
      .digest('hex'),
  );
}
