#!/usr/bin/env node
/**
 * Generates the demo timetables in `public/samples/`:
 *
 *   cse-sem3.pdf        digital PDF, weekdays down the left column (the easy case)
 *   days-across-top.pdf digital PDF, weekdays across the top (the other layout)
 *   timetable-photo.jpg a "phone photo" of the first timetable: skewed, noisy,
 *                       compressed — this is what exercises the OCR path
 *
 * Run with `npm run samples`.
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';

const outDir = path.join(process.cwd(), 'public', 'samples');
fs.mkdirSync(outDir, { recursive: true });

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const SLOTS = [
  '09:00-09:55',
  '10:00-10:55',
  '11:00-11:55',
  '12:00-12:55',
  '14:00-14:55',
  '15:00-15:55',
];

/** rows: day → array of cell lines (null = free period) */
const ROWS = [
  ['CS301\nData Structures\nLH-204\nDr. A. Kumar', 'CS302\nDBMS\nLH-201\nProf. S. Rao', 'CS303\nOperating Systems\nRoom 305\nMs. N. Iyer', 'CS351\nDS Lab\nLab-2\nMr. R. Verma', 'LUNCH\nBREAK', 'CS304\nDiscrete Maths\nLH-105\nDr. P. Menon'],
  ['CS302\nDBMS\nLH-201\nProf. S. Rao', 'CS301\nData Structures\nLH-204\nDr. A. Kumar', 'MA201\nEngineering Maths III\nLH-105\nDr. P. Menon', 'CS352\nDBMS Lab\nLab-1\nProf. S. Rao', 'LUNCH\nBREAK', 'HS101\nTechnical Writing\nLH-102\nMs. K. Bose'],
  ['CS303\nOperating Systems\nRoom 305\nMs. N. Iyer', 'CS351\nDS Lab\nLab-2\nMr. R. Verma', 'CS301\nData Structures\nLH-204\nDr. A. Kumar', 'CS302\nDBMS\nLH-201\nProf. S. Rao', 'LUNCH\nBREAK', 'CS303\nOperating Systems\nRoom 305\nMs. N. Iyer'],
  ['MA201\nEngineering Maths III\nLH-105\nDr. P. Menon', 'CS304\nDiscrete Maths\nLH-105\nDr. P. Menon', 'CS352\nDBMS Lab\nLab-1\nProf. S. Rao', 'CS353\nOS Lab\nLab-3\nMs. N. Iyer', 'LUNCH\nBREAK', 'CS355\nMini Project\nLab-4\nDr. A. Kumar'],
  ['CS301\nData Structures\nLH-204\nDr. A. Kumar', 'CS303\nOperating Systems\nRoom 305\nMs. N. Iyer', 'HS101\nTechnical Writing\nLH-102\nMs. K. Bose', 'CS304\nDiscrete Maths\nLH-105\nDr. P. Menon', 'LUNCH\nBREAK', 'FREE\nPERIOD', ],
  ['CS355\nMini Project\nLab-4\nDr. A. Kumar', 'CS352\nDBMS Lab\nLab-1\nProf. S. Rao', null, 'CS351\nDS Lab\nLab-2\nMr. R. Verma', 'LUNCH\nBREAK', null],
];

const TITLE = 'Department of Computer Science & Engineering';
const SUBTITLE = 'B.Tech CSE — Semester III — Class Timetable (Odd Semester 2026–27)';

/* ------------------------------------------------------------------ */
/* 1. Weekdays down the left column                                     */
/* ------------------------------------------------------------------ */
function drawRowsLayout(doc) {
  const pageWidth = doc.page.width;
  const marginX = 36;
  const tableWidth = pageWidth - marginX * 2;
  const labelWidth = 56;
  const colWidth = (tableWidth - labelWidth) / SLOTS.length;
  let y = 40;

  doc.font('Helvetica-Bold').fontSize(15).fillColor('#111');
  doc.text(TITLE, marginX, y, { width: tableWidth, align: 'center' });
  y += 20;
  doc.font('Helvetica').fontSize(10.5);
  doc.text(SUBTITLE, marginX, y, { width: tableWidth, align: 'center' });
  y += 26;

  const rowHeight = 68;

  // header
  doc.rect(marginX, y, tableWidth, 26).fill('#eef2ff');
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(9);
  doc.text('DAY', marginX + 6, y + 8, { width: labelWidth });
  SLOTS.forEach((slot, i) => {
    doc.text(slot, marginX + labelWidth + i * colWidth + 4, y + 8, { width: colWidth - 8, align: 'center' });
  });
  y += 26;

  ROWS.forEach((cells, r) => {
    doc.rect(marginX, y, tableWidth, rowHeight).stroke('#c7d2fe');
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1e3a8a');
    doc.text(DAYS[r], marginX + 6, y + 12, { width: labelWidth });
    cells.forEach((cell, c) => {
      const x = marginX + labelWidth + c * colWidth;
      doc.rect(x, y, colWidth, rowHeight).stroke('#e0e7ff');
      if (!cell) return;
      const isLunch = /LUNCH/i.test(cell);
      doc.font('Helvetica').fontSize(7.6).fillColor(isLunch ? '#6b7280' : '#111827');
      doc.text(cell, x + 4, y + 6, { width: colWidth - 8, lineGap: 1 });
    });
    y += rowHeight;
  });

  doc.font('Helvetica').fontSize(7.5).fillColor('#6b7280').text(
    'Room codes: LH = Lecture Hall, Lab = Laboratory. LUNCH BREAK is not a class.',
    marginX,
    y + 10,
    { width: tableWidth },
  );
}

const pdfA = new PDFDocument({ size: 'A4', margin: 0, layout: 'landscape' });
doc0(pdfA, drawRowsLayout, path.join(outDir, 'cse-sem3.pdf'));

/* ------------------------------------------------------------------ */
/* 2. Weekdays across the top                                           */
/* ------------------------------------------------------------------ */
function drawColumnsLayout(doc) {
  const pageWidth = doc.page.width;
  const marginX = 34;
  const tableWidth = pageWidth - marginX * 2;
  const timeWidth = 74;
  const colWidth = (tableWidth - timeWidth) / DAYS.length;
  let y = 34;

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111');
  doc.text('B.Tech IT — Semester V — Timetable (Even Semester 2026)', marginX, y, { width: tableWidth, align: 'center' });
  y += 30;

  doc.rect(marginX, y, tableWidth, 24).fill('#eef2ff');
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(9);
  doc.text('TIME', marginX + 4, y + 7, { width: timeWidth });
  DAYS.forEach((day, i) => {
    doc.text(day, marginX + timeWidth + i * colWidth + 4, y + 7, { width: colWidth - 8, align: 'center' });
  });
  y += 24;

  const rowHeight = 58;
  SLOTS.slice(0, 5).forEach((slot, r) => {
    doc.rect(marginX, y, tableWidth, rowHeight).stroke('#c7d2fe');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e3a8a');
    doc.text(slot, marginX + 4, y + 10, { width: timeWidth - 6 });
    DAYS.forEach((_, c) => {
      const x = marginX + timeWidth + c * colWidth;
      doc.rect(x, y, colWidth, rowHeight).stroke('#e0e7ff');
      const cell = ROWS[c][r];
      if (!cell || /LUNCH/i.test(cell)) return;
      doc.font('Helvetica').fontSize(7.4).fillColor('#111827');
      doc.text(cell, x + 4, y + 5, { width: colWidth - 8, lineGap: 1 });
    });
    y += rowHeight;
  });
}

const pdfB = new PDFDocument({ size: 'A4', margin: 0, layout: 'landscape' });
doc0(pdfB, drawColumnsLayout, path.join(outDir, 'days-across-top.pdf'));

function doc0(doc, draw, file) {
  const stream = fs.createWriteStream(file);
  doc.pipe(stream);
  draw(doc);
  doc.end();
  return new Promise((resolve) => stream.on('finish', resolve));
}

/* ------------------------------------------------------------------ */
/* 3. A "phone photo" of layout #1 (for the OCR path)                   */
/* ------------------------------------------------------------------ */
const FONT = 'Helvetica, Arial, sans-serif';
const W = 1500;
const H = 900;

function svgEsc(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSvg() {
  const marginX = 40;
  const tableWidth = W - marginX * 2;
  const labelWidth = 70;
  const colWidth = (tableWidth - labelWidth) / SLOTS.length;
  const rowHeight = 100;
  let y = 46;
  const parts = [
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${W / 2}" y="${y}" font-family="${FONT}" font-size="27" font-weight="bold" text-anchor="middle" fill="#111">${svgEsc(TITLE)}</text>`,
  ];
  y += 34;
  parts.push(`<text x="${W / 2}" y="${y}" font-family="${FONT}" font-size="19" text-anchor="middle" fill="#333">${svgEsc(SUBTITLE)}</text>`);
  y += 30;

  parts.push(`<rect x="${marginX}" y="${y}" width="${tableWidth}" height="38" fill="#eef2ff"/>`);
  parts.push(`<text x="${marginX + 8}" y="${y + 25}" font-family="${FONT}" font-size="16" font-weight="bold" fill="#111">DAY</text>`);
  SLOTS.forEach((slot, i) => {
    parts.push(
      `<text x="${marginX + labelWidth + i * colWidth + colWidth / 2}" y="${y + 25}" font-family="${FONT}" font-size="15" font-weight="bold" text-anchor="middle" fill="#111">${slot}</text>`,
    );
  });
  y += 38;

  ROWS.forEach((cells, r) => {
    parts.push(`<rect x="${marginX}" y="${y}" width="${tableWidth}" height="${rowHeight}" fill="none" stroke="#c7d2fe" stroke-width="2"/>`);
    parts.push(`<text x="${marginX + 8}" y="${y + 26}" font-family="${FONT}" font-size="16" font-weight="bold" fill="#1e3a8a">${DAYS[r]}</text>`);
    cells.forEach((cell, c) => {
      const x = marginX + labelWidth + c * colWidth;
      parts.push(`<rect x="${x}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="none" stroke="#e0e7ff" stroke-width="1.5"/>`);
      if (!cell) return;
      const lines = cell.split('\n');
      lines.forEach((lineText, li) => {
        parts.push(
          `<text x="${x + 6}" y="${y + 22 + li * 20}" font-family="${FONT}" font-size="13.5" fill="#111827">${svgEsc(lineText)}</text>`,
        );
      });
    });
    y += rowHeight;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

const photoPath = path.join(outDir, 'timetable-photo.jpg');
await sharp(Buffer.from(buildSvg()))
  .rotate(-0.8, { background: '#f7f5f0' })
  .resize({ width: 1800 })
  .median(1)
  .modulate({ brightness: 1.02, saturation: 0.9 })
  .jpeg({ quality: 62, chromaSubsampling: '4:2:0' })
  .toFile(photoPath);

/* ------------------------------------------------------------------ */
/* 4. A "scanned" PDF: the photo wrapped in a PDF with no text layer    */
/* ------------------------------------------------------------------ */
const scannedPdf = new PDFDocument({ size: 'A4', margin: 0, layout: 'landscape' });
const scannedStream = fs.createWriteStream(path.join(outDir, 'scanned-timetable.pdf'));
scannedPdf.pipe(scannedStream);
scannedPdf.image(fs.readFileSync(photoPath), 0, 0, {
  fit: [scannedPdf.page.width, scannedPdf.page.height],
  align: 'center',
  valign: 'center',
});
scannedPdf.end();
await new Promise((resolve) => scannedStream.on('finish', resolve));

console.log('samples written:', fs.readdirSync(outDir).join(', '));
