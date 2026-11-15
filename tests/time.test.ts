import { describe, expect, it } from 'vitest';
import {
  findDayTokens,
  findTimeRanges,
  parseStartTime,
  parseTimeRange,
  splitDayTime,
  to12h,
  fromHHMM,
  toHHMM,
} from '../src/lib/time';

describe('parseTimeRange', () => {
  const cases: Array<[string, string, string]> = [
    ['09:00-09:55', '09:00', '09:55'],
    ['9:00 – 10:00', '09:00', '10:00'],
    ['9.00 to 10.00', '09:00', '10:00'],
    ['0900-1000', '09:00', '10:00'],
    ['9-10', '09:00', '10:00'],
    ['9:00 AM - 10:00 AM', '09:00', '10:00'],
    ['10:00 am to 11:00 am', '10:00', '11:00'],
    ['1:00 pm - 2:00 pm', '13:00', '14:00'],
    ['1-2', '13:00', '14:00'],
    ['11:00-12:00', '11:00', '12:00'],
    ['12:00-13:00', '12:00', '13:00'],
    ['02:30 PM - 03:25 PM', '14:30', '15:25'],
    ['13:00-13:55', '13:00', '13:55'],
  ];

  for (const [input, start, end] of cases) {
    it(`reads "${input}"`, () => {
      const result = parseTimeRange(input);
      expect(result, input).not.toBeNull();
      expect(result!.start).toBe(start);
      expect(result!.end).toBe(end);
    });
  }

  it('rejects things that are not ranges', () => {
    expect(parseTimeRange('Data Structures')).toBeNull();
    expect(parseTimeRange('LH-204')).toBeNull();
    expect(parseTimeRange('9:00-21:00')).toBeNull();
  });
});

describe('parseStartTime', () => {
  it('reads a lone start time', () => {
    expect(parseStartTime('9:00')?.start).toBe('09:00');
    expect(parseStartTime('9.30am')?.start).toBe('09:30');
  });
});

describe('findDayTokens', () => {
  it('finds abbreviated and full day names', () => {
    expect(findDayTokens('MON Data Structures').map((t) => t.day)).toEqual([1]);
    expect(findDayTokens('Wednesday lab').map((t) => t.day)).toEqual([3]);
    expect(findDayTokens('THU/FRI').map((t) => t.day)).toEqual([4, 5]);
  });

  it('tolerates OCR zero-for-O', () => {
    expect(findDayTokens('M0N').map((t) => t.day)).toEqual([1]);
  });

  it('ignores day-like substrings inside words', () => {
    expect(findDayTokens('MONTHLY report')).toEqual([]);
    expect(findDayTokens('SUNDAY special')).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('round-trips minutes', () => {
    expect(fromHHMM('09:55')).toBe(595);
    expect(toHHMM(595)).toBe('09:55');
    expect(toHHMM(-30)).toBe('23:30');
  });

  it('formats 12h', () => {
    expect(to12h('09:00')).toBe('9:00 AM');
    expect(to12h('13:05')).toBe('1:05 PM');
    expect(to12h('00:15')).toBe('12:15 AM');
    expect(to12h('12:00')).toBe('12:00 PM');
  });

  it('splits day + time out of a free-form line', () => {
    const split = splitDayTime('TUE 10:00-11:00 DBMS Room 204 Dr. Rao');
    expect(split?.day).toBe(2);
    expect(split?.range.start).toBe('10:00');
    expect(split?.rest).toContain('DBMS');
  });

  it('finds several ranges in a legend', () => {
    const ranges = findTimeRanges('P1 9:00-9:55  P2 10:00-10:55  P3 11:00-11:55');
    expect(ranges.map((r) => r.start)).toEqual(['09:00', '10:00', '11:00']);
  });
});
