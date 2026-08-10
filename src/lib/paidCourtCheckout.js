export const PAYKEEPER_COURT_CHECKOUT_ENABLED = false;

export const PAYKEEPER_COURT_CHECKOUT_PENDING_MESSAGE =
  'Оплата корта через PayKeeper подключается. Бронь без оплаты не создаётся.';

export function resolvePaidCourtCheckoutEntry(match, options = {}) {
  const checkoutEnabled =
    options.checkoutEnabled === true ||
    (options.checkoutEnabled === undefined &&
      PAYKEEPER_COURT_CHECKOUT_ENABLED);
  const visible =
    match?.backendOwned === true &&
    match?.courtBookingStatus === 'unbooked';

  return Object.freeze({
    visible,
    canStart: visible && checkoutEnabled,
    reason: visible && !checkoutEnabled ? 'paykeeper_pending' : null,
  });
}
