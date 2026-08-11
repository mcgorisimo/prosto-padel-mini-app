import { describe, expect, it } from 'vitest';
import {
  addDaysToDateISO,
  formatMoscowDateISO,
  getMoscowDateISO,
  getMoscowDateRange,
  hasMoscowSlotStarted,
} from './moscowDateTime.js';

describe('Moscow date helpers', () => {
  it('uses the Moscow calendar across a UTC day boundary', () => {
    expect(getMoscowDateISO(Date.parse('2030-01-01T21:30:00Z')))
      .toBe('2030-01-02');
    expect(getMoscowDateISO('not-an-instant')).toBeNull();
  });

  it('adds calendar days and rejects impossible input', () => {
    expect(addDaysToDateISO('2032-02-28', 2)).toBe('2032-03-01');
    expect(addDaysToDateISO('2031-02-29', 1)).toBeNull();
    expect(addDaysToDateISO('2030-01-01', 1.5)).toBeNull();
  });

  it('builds deterministic ranges and formats at the club timezone', () => {
    expect(getMoscowDateRange(3, Date.parse('2030-01-01T21:30:00Z')))
      .toEqual(['2030-01-02', '2030-01-03', '2030-01-04']);
    expect(getMoscowDateRange(-1, 0)).toEqual([]);
    expect(formatMoscowDateISO(
      '2030-01-02',
      { year: 'numeric', month: '2-digit', day: '2-digit' },
      'en-CA',
    )).toBe('2030-01-02');
    expect(formatMoscowDateISO('2030-02-30')).toBe('');
  });

  it('compares slots at second precision and fails closed on invalid input', () => {
    const instant = Date.parse('2030-01-02T07:30:15Z'); // 10:30:15 MSK
    expect(hasMoscowSlotStarted('2030-01-02', '10:30', instant)).toBe(true);
    expect(hasMoscowSlotStarted('2030-01-02', '10:31', instant)).toBe(false);
    expect(hasMoscowSlotStarted('2030-01-01', '23:59', instant)).toBe(true);
    expect(hasMoscowSlotStarted('2030-01-03', '00:00', instant)).toBe(false);
    expect(hasMoscowSlotStarted('2030-01-02', '25:00', instant)).toBe(true);
  });
});
