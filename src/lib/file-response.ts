// Serving an uploaded receipt / invoice back to a person who may see it: shown in the browser, not downloaded.
// Only the types the upload accepts (images and PDF) are shown in place; anything else is a download. The type sent is the one checked at
// upload, with `nosniff`, so a file can never be taken for a web page. Nothing is cached: access is checked on every request.
import { createReadStream } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { APP_ROOT } from '@/lib/app-root';

/** Types a browser shows by itself. (HEIC is not among them: most browsers cannot show it, so it downloads.) */
export const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export function fileResponse(file: { storage_key: string; content_type: string; filename: string; size: number }) {
  const inline = INLINE_TYPES.includes(file.content_type);
  return new NextResponse(createReadStream(path.join(APP_ROOT, file.storage_key)) as unknown as ReadableStream, {
    headers: {
      'Content-Type': file.content_type,
      'Content-Length': String(file.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
