import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Deployment smoke test: is the OCR model present and is the runtime healthy? */
export async function GET() {
  const tessdata = path.join(process.cwd(), 'vendor', 'tessdata', 'eng.traineddata.gz');
  const core = path.join(process.cwd(), 'vendor', 'tesseract-core');
  return NextResponse.json({
    ok: true,
    service: 'timetable-to-calendar',
    ocr: {
      model: fs.existsSync(tessdata),
      core: fs.existsSync(core),
      modelBytes: fs.existsSync(tessdata) ? fs.statSync(tessdata).size : 0,
    },
    runtime: process.version,
    uptimeSeconds: Math.round(process.uptime()),
  });
}
