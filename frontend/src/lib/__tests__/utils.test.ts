import { toStroops, fromStroops, toBigIntSafe, isValidTimestamp } from '../utils';

describe('amount conversions', () => {
  test('toStroops converts XLM to stroops', () => {
    expect(toStroops('1').toString()).toBe('10000000');
    expect(toStroops('1.5').toString()).toBe('15000000');
    expect(toStroops('0.1234567').toString()).toBe('1234567');
  });

  test('fromStroops converts stroops to XLM', () => {
    expect(fromStroops(10000000n)).toBe('1');
    expect(fromStroops(15000000n)).toBe('1.5');
    expect(fromStroops(1234567n)).toBe('0.1234567');
  });
});

describe('toBigIntSafe', () => {
  test('handles strings and numbers safely', () => {
    expect(toBigIntSafe('100').toString()).toBe('100');
    expect(toBigIntSafe(100).toString()).toBe('100');
  });
});

describe('isValidTimestamp', () => {
  test('validates sensible timestamps', () => {
    expect(isValidTimestamp(Math.floor(Date.now() / 1000))).toBe(true);
    expect(isValidTimestamp(-1)).toBe(false);
  });
});
