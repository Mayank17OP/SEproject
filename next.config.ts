import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native / WASM-heavy libraries must stay outside the bundler.
  serverExternalPackages: ['@napi-rs/canvas', 'sharp', 'pdfjs-dist', 'tesseract.js', 'tesseract.js-core'],
  // The OCR model + WASM core live in ./vendor (created by postinstall). Make
  // sure serverless builds include them in the function bundle.
  outputFileTracingIncludes: {
    '/api/parse': ['./vendor/**/*'],
  },
  experimental: {
    serverActions: { bodySizeLimit: '12mb' },
  },
  // The live-preview host and localhost both hit the dev server directly.
  allowedDevOrigins: ['*.e2b.app', 'localhost', '127.0.0.1'],
  poweredByHeader: false,
};

export default nextConfig;
