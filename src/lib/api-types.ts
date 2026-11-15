import type { ParseResult } from './types';

export interface ParseResponse extends ParseResult {
  fileMeta: { name: string; size: number; isPdf: boolean };
  elapsedMs: number;
}

export interface ApiError {
  error: string;
}
