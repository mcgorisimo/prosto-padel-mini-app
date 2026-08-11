import { describe, expect, it } from 'vitest';
import {
  YOOKASSA_COURT_CHECKOUT_ENABLED,
  resolvePaidCourtCheckoutEntry,
} from './paidCourtCheckout.js';

describe('resolvePaidCourtCheckoutEntry', () => {
  it('keeps checkout fail-closed by default for an unbooked backend court', () => {
    expect(YOOKASSA_COURT_CHECKOUT_ENABLED).toBe(false);
    expect(resolvePaidCourtCheckoutEntry({
      backendOwned: true,
      courtBookingStatus: 'unbooked',
    })).toEqual({
      visible: true,
      canStart: false,
      reason: 'yookassa_pending',
    });
  });

  it('starts only when explicitly enabled and the entry is visible', () => {
    expect(resolvePaidCourtCheckoutEntry({
      backendOwned: true,
      courtBookingStatus: 'unbooked',
    }, { checkoutEnabled: true })).toEqual({
      visible: true,
      canStart: true,
      reason: null,
    });
    expect(resolvePaidCourtCheckoutEntry({
      backendOwned: false,
      courtBookingStatus: 'unbooked',
    }, { checkoutEnabled: true })).toEqual({
      visible: false,
      canStart: false,
      reason: null,
    });
  });
});
