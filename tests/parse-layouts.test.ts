import { describe, expect, it } from 'vitest';
import { parseTimetable } from '../src/lib/parse';
import type { SourceInfo } from '../src/lib/types';
import { gridPage, textPage } from './helpers';

const source: SourceInfo = { kind: 'pdf-text', fileName: 'fixture.pdf', pages: 1, textChars: 500 };

describe('period numbers with a time legend', () => {
  const page = gridPage({
    header: ['P1', 'P2', 'P3'],
    rowLabels: ['MON', 'TUE', 'WED'],
    cells: [
      ['CS301\nData Structures\nLH-204\nDr. A. Kumar', 'CS302\nDBMS\nLH-201\nProf. S. Rao', null],
      ['CS302\nDBMS\nLH-201\nProf. S. Rao', null, 'CS303\nOperating Systems\nRoom 305\nMs. N. Iyer'],
      [null, 'CS301\nData Structures\nLH-204\nDr. A. Kumar', 'CS303\nOperating Systems\nRoom 305\nMs. N. Iyer'],
    ],
    footer: ['P1 09:00-09:55   P2 10:00-10:55   P3 11:00-11:55'],
  });

  it('resolves the legend into real times', () => {
    const result = parseTimetable([page], source);
    expect(result.meta.layout).toBe('days-as-rows');
    const monday = result.events.find((e) => e.day === 1 && e.subject === 'Data Structures');
    expect(monday?.start).toBe('09:00');
    expect(monday?.end).toBe('09:55');
    const tueOs = result.events.find((e) => e.day === 2 && e.start === '11:00');
    expect(tueOs?.subject).toBe('Operating Systems');
    expect(tueOs?.room).toBe('305');
  });
});

describe('weekdays across the top', () => {
  const page = gridPage({
    transpose: true,
    header: ['MON', 'TUE', 'WED'],
    rowLabels: ['09:00-09:55', '10:00-10:55'],
    cells: [
      ['MA201 Engineering Maths III / LH-105 / Dr. P. Menon', 'CS351 DS Lab / Lab-2 / Mr. R. Verma', null],
      ['CS304 Discrete Maths / LH-105 / Dr. P. Menon', 'HS101 Technical Writing / LH-102 / Ms. K. Bose', 'CS301 Data Structures / LH-204 / Dr. A. Kumar'],
    ],
  });

  it('detects the transposed layout and keeps columns aligned', () => {
    const result = parseTimetable([page], source);
    expect(result.meta.layout).toBe('days-as-columns');
    expect(result.events).toHaveLength(5); // five non-empty cells in the fixture
    const wed = result.events.find((e) => e.day === 3);
    expect(wed?.subject).toBe('Data Structures');
    expect(wed?.start).toBe('10:00');
    expect(wed?.room).toBe('LH-204');
    const tueLab = result.events.find((e) => e.day === 2);
    expect(tueLab?.kind).toBe('lab');
    expect(tueLab?.room).toBe('Lab-2');
  });
});

describe('free-form line list (bad OCR)', () => {
  const page = textPage([
    'CSE SEM 3 TIMETABLE',
    'MON 9:00-10:00 Data Structures Room 204 Dr. A. Kumar',
    'MON 10:00-11:00 DBMS LH-201 Prof. S. Rao',
    'TUE 9:00-10:00 DBMS LH-201 Prof. S. Rao',
    'WED 11:00-12:00 Operating Systems Room 305 Ms. N. Iyer',
  ]);

  it('falls back to reading each line', () => {
    const result = parseTimetable([page], source);
    expect(result.meta.layout).toBe('line-list');
    expect(result.events).toHaveLength(4);
    expect(result.warnings.some((warning) => warning.code === 'fallback-parser')).toBe(true);
    const wed = result.events.find((e) => e.day === 3);
    expect(wed?.subject).toBe('Operating Systems');
    expect(wed?.room).toBe('305');
    expect(wed?.start).toBe('11:00');
  });
});

describe('multi-page timetables', () => {
  const monday = gridPage({
    header: ['09:00-09:55'],
    rowLabels: ['MON'],
    cells: [['CS301\nData Structures\nLH-204\nDr. A. Kumar']],
  }, 0);
  const tuesday = gridPage({
    header: ['09:00-09:55'],
    rowLabels: ['TUE'],
    cells: [['CS301\nData Structures\nLH-204\nDr. A. Kumar']],
  }, 1);

  it('merges both pages and de-duplicates repeated slots', () => {
    const result = parseTimetable([monday, tuesday], { ...source, pages: 2 });
    expect(result.events).toHaveLength(2);
    expect(result.warnings.some((w) => w.code === 'multiple-pages')).toBe(true);
  });

  it('de-duplicates the same slot printed twice', () => {
    const duplicate = gridPage({
      header: ['09:00-09:55'],
      rowLabels: ['MON'],
      cells: [['CS301\nData Structures\nLH-204\nDr. A. Kumar']],
    }, 1);
    const result = parseTimetable([monday, duplicate], { ...source, pages: 2 });
    expect(result.events).toHaveLength(1);
  });
});

describe('degraded input', () => {
  it('still returns slots when rooms and teachers are missing', () => {
    const page = gridPage({
      header: ['09:00-09:55', '10:00-10:55'],
      rowLabels: ['MON', 'TUE'],
      cells: [['Data Structures', 'DBMS'], ['DBMS', null]],
    });
    const result = parseTimetable([page], source);
    expect(result.events).toHaveLength(3);
    expect(result.events[0].room).toBeUndefined();
    expect(result.warnings.some((w) => w.code === 'partial-cell')).toBe(true);
  });

  it('reports a clear warning when nothing matches', () => {
    const result = parseTimetable([textPage(['nothing useful here at all'])], source);
    expect(result.events).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'no-events')).toBe(true);
  });

  it('ignores lunch rows when asked at export time but still detects them', () => {
    const page = gridPage({
      header: ['09:00-09:55', '12:00-12:55'],
      rowLabels: ['MON'],
      cells: [['CS301\nData Structures\nLH-204\nDr. A. Kumar', 'LUNCH\nBREAK']],
    });
    const result = parseTimetable([page], source);
    expect(result.events.filter((e) => e.kind === 'break')).toHaveLength(1);
  });
});
