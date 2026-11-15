'use client';

import { useCallback, useRef, useState, type DragEvent } from 'react';
import { CameraIcon, SparkIcon, UploadIcon } from './icons';

interface UploaderProps {
  busy: boolean;
  progressLabel: string;
  error: string | null;
  onFile: (file: File) => void;
  onSample: (url: string, label: string) => void;
  compact?: boolean;
}

const SAMPLES = [
  { file: 'cse-sem3.pdf', label: 'PDF timetable', hint: 'CSE sem 3, digital PDF', icon: '📄' },
  { file: 'days-across-top.pdf', label: 'Transposed layout', hint: 'days across the top', icon: '🧭' },
  { file: 'timetable-photo.jpg', label: 'Phone photo', hint: 'skewed JPEG → OCR', icon: '📷' },
  { file: 'scanned-timetable.pdf', label: 'Scanned PDF', hint: 'no text layer → OCR', icon: '🖨️' },
];

const MAX_BYTES = 12 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,image/*,application/pdf';

export default function Uploader({ busy, progressLabel, error, onFile, onSample, compact }: UploaderProps) {
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      setLocalError(null);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name);
      if (!isPdf && !isImage) {
        setLocalError('That is not a PDF or an image. Teams exports, Word files and screenshots-in-a-zip will not work.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setLocalError(`That file is ${(file.size / 1e6).toFixed(1)} MB. Please keep it under 12 MB.`);
        return;
      }
      onFile(file);
    },
    [onFile],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div className="card animate-rise p-4 sm:p-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={(event) => {
          // Ignore clicks that bubbled up from the hidden file inputs, otherwise
          // opening the picker would re-trigger this handler in a loop.
          if ((event.target as HTMLElement).tagName === 'INPUT') return;
          if (!busy) fileInput.current?.click();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click();
        }}
        className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed px-4 text-center transition
          ${compact ? 'py-7' : 'py-10 sm:py-14'}
          ${dragging ? 'border-brand-400 bg-brand-500/10' : 'border-white/15 bg-white/[0.02] hover:border-brand-400/60 hover:bg-white/[0.04]'}
          ${busy ? 'pointer-events-none opacity-80' : ''}`}
      >
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand-500/25 to-mint-400/15 text-brand-400 ring-1 ring-inset ring-white/10">
          {busy ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6 animate-spin" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          ) : (
            <UploadIcon className="h-6 w-6" />
          )}
        </div>
        <p className="text-base font-semibold text-white">
          {busy ? progressLabel : 'Drop your timetable here'}
        </p>
        <p className="mt-1 max-w-md text-sm text-slate-400">
          {busy
            ? 'This usually takes a few seconds — OCR has to look at every cell.'
            : 'A PDF from your college portal, or a photo of the printed sheet. Max 12 MB.'}
        </p>

        {busy && (
          <div className="relative mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-white/10 shimmer" />
        )}

        {!busy && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <span className="btn-primary text-sm">
              <UploadIcon className="h-4 w-4" /> Choose file
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cameraInput.current?.click();
              }}
              className="btn-ghost text-sm"
            >
              <CameraIcon className="h-4 w-4" /> Take photo
            </button>
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {(error || localError) && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <span className="mt-0.5">⚠</span>
          <span>{localError ?? error}</span>
        </div>
      )}

      <div className="mt-5">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">
          <SparkIcon className="h-3.5 w-3.5" /> No timetable handy? Try a sample
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SAMPLES.map((sample) => (
            <button
              key={sample.file}
              type="button"
              disabled={busy}
              onClick={() => onSample(`/samples/${sample.file}`, sample.file)}
              className="group flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition hover:border-brand-400/50 hover:bg-white/[0.06] disabled:opacity-50"
            >
              <span className="text-lg">{sample.icon}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-200">{sample.label}</span>
                <span className="block truncate text-xs text-slate-500">{sample.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
