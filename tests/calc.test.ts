import { describe, expect, it } from 'vitest';
import {
  avgDailyUseFromReadings, bookingCostPaise, costPerFlatPaise, evaluateDelivery, hoursLeft, litresReceived,
  normaliseVehicleNumber, proRatedCostPaise, wouldOverflow,
} from '../src/shared/calc';
import { formatINR, formatLitres, renderTemplate } from '../src/shared/format';
import { passwordProblem } from '../src/shared/roles';

describe('litres received = (after % − before %) × capacity', () => {
  it('computes litres for a 1,50,000 L sump', () => {
    expect(litresReceived(39.5, 46, 150_000)).toBe(9_750);
    expect(litresReceived(20, 26.7, 150_000)).toBe(10_050);
  });
  it('handles a small overhead tank', () => {
    expect(litresReceived(10, 43.5, 30_000)).toBe(10_050);
  });
  it('is never negative', () => {
    expect(litresReceived(50, 45, 150_000)).toBe(0);
  });
});

describe('short delivery against tolerance', () => {
  it('within tolerance is not short', () => {
    expect(evaluateDelivery(10_000, 9_750, 300)).toEqual({ shortfall: 250, isShort: false, shortByLitres: 0 });
  });
  it('exactly at tolerance is not short', () => {
    expect(evaluateDelivery(10_000, 9_700, 300).isShort).toBe(false);
  });
  it('beyond tolerance is short by the full shortfall', () => {
    expect(evaluateDelivery(10_000, 9_200, 300)).toEqual({ shortfall: 800, isShort: true, shortByLitres: 800 });
  });
  it('over-delivery is not short', () => {
    expect(evaluateDelivery(10_000, 10_400, 300)).toEqual({ shortfall: 0, isShort: false, shortByLitres: 0 });
  });
});

describe('booking cost and pro-rating', () => {
  it('rate per 10,000 L × litres × count', () => {
    expect(bookingCostPaise(1_750_00, 10_000, 2)).toBe(3_500_00);
    expect(bookingCostPaise(1_650_00, 12_000, 1)).toBe(1_980_00);
    expect(bookingCostPaise(1_800_00, 5_000, 3)).toBe(2_700_00);
  });
  it('pro-rates only when short', () => {
    expect(proRatedCostPaise(1_750_00, 10_000, 9_200, true)).toBe(1_610_00);
    expect(proRatedCostPaise(1_750_00, 10_000, 9_750, false)).toBe(1_750_00);
  });
  it('never charges more than ordered', () => {
    expect(proRatedCostPaise(1_750_00, 10_000, 12_000, true)).toBe(1_750_00);
  });
});

describe('cost per flat = month spend ÷ flats', () => {
  it('divides and rounds to the nearest paisa', () => {
    expect(costPerFlatPaise(2_16_000_00, 186)).toBe(1_16_129);
    expect(formatINR(costPerFlatPaise(2_16_000_00, 186))).toBe('₹\u00A01,161');
  });
  it('is zero with no flats or no spend', () => {
    expect(costPerFlatPaise(10_000_00, 0)).toBe(0);
    expect(costPerFlatPaise(0, 186)).toBe(0);
  });
});

describe('hours left = litres ÷ (7-day avg daily use ÷ 24)', () => {
  it('computes hours', () => {
    expect(hoursLeft(7_200, 27_500)).toBeCloseTo(6.28, 2);
    expect(hoursLeft(60_000, 72_000)).toBe(20);
  });
  it('is null when usage is unknown', () => {
    expect(hoursLeft(5_000, 0)).toBeNull();
  });
  it('averages only the drops between readings over the series span', () => {
    const r = [
      { litres: 20_000, createdAt: '2026-10-01T00:00:00Z' },
      { litres: 15_000, createdAt: '2026-10-01T12:00:00Z' },
      { litres: 28_000, createdAt: '2026-10-01T13:00:00Z' }, // refill — ignored
      { litres: 18_000, createdAt: '2026-10-03T00:00:00Z' },
    ];
    expect(avgDailyUseFromReadings(r)).toBeCloseTo(15_000 / 2, 5);
  });
});

describe('helpers', () => {
  it('detects tank overflow', () => {
    expect(wouldOverflow(140_000, 20_000, 150_000)).toBe(true);
    expect(wouldOverflow(100_000, 20_000, 150_000)).toBe(false);
  });
  it('normalises Maharashtra vehicle numbers', () => {
    expect(normaliseVehicleNumber('mh12ab1234')).toBe('MH 12 AB 1234');
    expect(normaliseVehicleNumber('MH-14 GH 305')).toBe('MH 14 GH 0305');
    expect(normaliseVehicleNumber('hello')).toBeNull();
  });
  it('formats Indian numbers', () => {
    expect(formatLitres(150000)).toBe('1,50,000\u00A0L');
    expect(formatINR(25_200_00)).toBe('₹\u00A025,200');
  });
  it('renders template placeholders', () => {
    expect(renderTemplate('Flat {{flat}} at {{ time }} — {{missing}}', { flat: 'B-1104', time: '6:00 AM' })).toBe('Flat B-1104 at 6:00 AM — {{missing}}');
  });
  it('enforces password rules per role', () => {
    expect(passwordProblem('committee_admin', 'short')).toMatch(/10 characters/);
    expect(passwordProblem('committee_admin', '1234567890')).toBeNull();
    expect(passwordProblem('resident', '135792')).toBeNull();
    expect(passwordProblem('resident', '111111')).toMatch(/easy/);
    expect(passwordProblem('guard', '1357')).toMatch(/6 digits/);
    expect(passwordProblem('treasurer', '135792')).toMatch(/10 characters/);
  });
});
