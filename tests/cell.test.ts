import { describe, expect, it } from 'vitest';
import { parseCell } from '../src/lib/parse/cell';

describe('parseCell', () => {
  const cases: Array<[string, { subject: string; code?: string; room?: string; faculty?: string }]> = [
    ['CS301\nData Structures\nLH-204\nDr. A. Kumar', { subject: 'Data Structures', code: 'CS301', room: 'LH-204', faculty: 'Dr. A. Kumar' }],
    ['CS302 DBMS / LH-201 / Prof. S. Rao', { subject: 'DBMS', code: 'CS302', room: 'LH-201', faculty: 'Prof. S. Rao' }],
    ['CS303\nOperating Systems\nRoom 305\nMs. N. Iyer', { subject: 'Operating Systems', code: 'CS303', room: '305', faculty: 'Ms. N. Iyer' }],
    ['Data Structures  Lab-2  Mr. R. Verma', { subject: 'Data Structures', room: 'Lab-2', faculty: 'Mr. R. Verma' }],
    ['LUNCH\nBREAK', { subject: 'LUNCH BREAK' }],
    ['MA201 Engineering Maths III LH-105 Dr. P. Menon', { subject: 'Engineering Maths III', code: 'MA201', room: 'LH-105', faculty: 'Dr. P. Menon' }],
    ['Operating Systems\nMs. N. Iyer\n305', { subject: 'Operating Systems', room: '305', faculty: 'Ms. N. Iyer' }],
    ['Physics Lab / B-12', { subject: 'Physics Lab', room: 'B-12' }],
  ];

  for (const [raw, expected] of cases) {
    it(`parses ${JSON.stringify(raw)}`, () => {
      const result = parseCell(raw);
      expect(result.subject).toBe(expected.subject);
      if (expected.code) expect(result.code).toBe(expected.code);
      if (expected.room) expect(result.room).toBe(expected.room);
      if (expected.faculty) expect(result.faculty).toBe(expected.faculty);
    });
  }

  it('marks labs', () => {
    expect(parseCell('CS351 DS Lab / Lab-2 / Mr. R. Verma').kind).toBe('lab');
    expect(parseCell('CS301 Data Structures / LH-204 / Dr. A. Kumar').kind).toBe('class');
  });
});
