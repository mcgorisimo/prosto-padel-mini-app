export const YOOKASSA_COURT_CHECKOUT_ENABLED = false;

export const YOOKASSA_COURT_CHECKOUT_PENDING_MESSAGE =
  'Оплата корта через ЮKassa подключается. Бронь без оплаты не создаётся.';

export function resolvePaidCourtCheckoutEntry(match, options = {}) {
  const checkoutEnabled =
    options.checkoutEnabled === true ||
    (options.checkoutEnabled === undefined &&
      YOOKASSA_COURT_CHECKOUT_ENABLED);
  const visible =
    match?.backendOwned === true &&
    match?.courtBookingStatus === 'unbooked';

  return Object.freeze({
    visible,
    canStart: visible && checkoutEnabled,
    reason: visible && !checkoutEnabled ? 'yookassa_pending' : null,
  });
}
