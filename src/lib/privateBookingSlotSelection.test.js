import { describe, expect, it } from 'vitest';
import {
  MAX_PRIVATE_BOOKING_SLOTS,
  findPrivateBookingRangeOption,
  formatPrivateBookingMinute,
  getPrivateBookingDuration,
  getPrivateBookingRangeEndMinute,
  updatePrivateBookingRange,
} from './privateBookingSlotSelection.js';

const court = Object.freeze({ id: 5730531, name: 'Корт №1' });

function option(startMinute, durationSlots) {
  return Object.freeze({ startMinute, durationSlots, court });
}

describe('private booking 30-minute range selection', () => {
  it('keeps one slot incomplete and accepts exact continuous ranges from 1 to 2 hours', () => {
    const options = [2, 3, 4].map((durationSlots) =>
      option(22 * 60, durationSlots),
    );
    let result = updatePrivateBookingRange({
      range: null,
      targetMinute: 22 * 60,
      options,
    });
    expect(result).toMatchObject({
      outcome: 'selected',
      range: { slotCount: 1 },
    });
    expect(
      findPrivateBookingRangeOption(options, result.range, { exact: true }),
    ).toBeNull();

    for (const targetMinute of [22 * 60 + 30, 23 * 60, 23 * 60 + 30]) {
      result = updatePrivateBookingRange({
        range: result.range,
        targetMinute,
        options,
      });
      expect(result.outcome).toBe('selected');
    }

    expect(result.range.slotCount).toBe(4);
    expect(getPrivateBookingDuration(result.range)).toBe(2);
    expect(getPrivateBookingRangeEndMinute(result.range)).toBe(24 * 60);
    expect(
      formatPrivateBookingMinute(getPrivateBookingRangeEndMinute(result.range)),
    ).toBe('00:00');
    expect(
      findPrivateBookingRangeOption(options, result.range, { exact: true }),
    ).not.toBeNull();
  });

  it('supports 22:30–00:00 and 23:00–00:00 without a 22:00 cutoff', () => {
    for (const [startMinute, durationSlots] of [
      [22 * 60 + 30, 3],
      [23 * 60, 2],
    ]) {
      const options = [option(startMinute, durationSlots)];
      let result = updatePrivateBookingRange({
        range: null,
        targetMinute: startMinute,
        options,
      });
      for (let index = 1; index < durationSlots; index += 1) {
        result = updatePrivateBookingRange({
          range: result.range,
          targetMinute: startMinute + index * 30,
          options,
        });
      }
      expect(result.outcome).toBe('selected');
      expect(getPrivateBookingRangeEndMinute(result.range)).toBe(24 * 60);
    }
  });

  it('rejects 23:30 as a start, gaps, occupied continuations and a fifth slot', () => {
    const longOption = option(21 * 60, MAX_PRIVATE_BOOKING_SLOTS);
    expect(
      updatePrivateBookingRange({
        range: null,
        targetMinute: 23 * 60 + 30,
        options: [longOption],
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'minimum' });

    let result = updatePrivateBookingRange({
      range: null,
      targetMinute: 21 * 60,
      options: [longOption],
    });
    expect(
      updatePrivateBookingRange({
        range: result.range,
        targetMinute: 22 * 60,
        options: [longOption],
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'gap' });

    result = updatePrivateBookingRange({
      range: result.range,
      targetMinute: 21 * 60 + 30,
      options: [option(21 * 60, 2)],
    });
    expect(result.outcome).toBe('selected');
    expect(
      updatePrivateBookingRange({
        range: result.range,
        targetMinute: 22 * 60,
        options: [option(22 * 60, 2)],
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'unavailable' });

    result = {
      outcome: 'selected',
      range: {
        startMinute: 21 * 60,
        slotCount: MAX_PRIVATE_BOOKING_SLOTS,
        courtId: court.id,
      },
    };
    expect(
      updatePrivateBookingRange({
        range: result.range,
        targetMinute: 23 * 60,
        options: [option(21 * 60, MAX_PRIVATE_BOOKING_SLOTS + 1)],
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'maximum' });
  });

  it('allows removing only an edge so a selected range cannot split', () => {
    const options = [option(17 * 60, 3), option(17 * 60 + 30, 2)];
    const range = { startMinute: 17 * 60, slotCount: 3, courtId: court.id };
    expect(
      updatePrivateBookingRange({
        range,
        targetMinute: 17 * 60 + 30,
        options,
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'gap' });
    expect(
      updatePrivateBookingRange({
        range,
        targetMinute: 17 * 60,
        options,
      }),
    ).toMatchObject({
      outcome: 'selected',
      range: { startMinute: 17 * 60 + 30, slotCount: 2 },
    });
  });
});
