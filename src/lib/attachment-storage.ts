// Disk-side handling for attachment files. Every attachment in the app — incoming
// (IMAP sync), outgoing, scheduled and draft — lives in a single flat directory
// under APP_ROOT/storage/attachments with a UUID filename, and the DB stores the
// project-root-relative path in `storage_key`.
import { writeFile, mkdir, copyFile, unlink } from 'fs/promises';
import path from 'path';
import { APP_ROOT } from '@/lib/app-root';
import type { DeliverAttachment } from '@/lib/mail/deliver';

const STORAGE_SUBDIR = path.join('storage', 'attachments');

function extensionOf(name: string) {
  return name.includes('.') ? '.' + name.split('.').pop() : '';
}

function newStorageKey(originalName: string) {
  return path.join(STORAGE_SUBDIR, `${crypto.randomUUID()}${extensionOf(originalName)}`);
}

// Persists uploaded files to disk. DB rows are the caller's job — the same files
// become `attachments`, `scheduled_send_attachments` or `draft_attachments`
// depending on which route saved them.
export async function saveUploadedFiles(files: File[]): Promise<DeliverAttachment[]> {
  if (files.length === 0) return [];
  await mkdir(path.join(APP_ROOT, STORAGE_SUBDIR), { recursive: true });

  const saved: DeliverAttachment[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const storageKey = newStorageKey(file.name);
    await writeFile(path.join(APP_ROOT, storageKey), buffer);
    saved.push({
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
      storage_key: storageKey,
    });
  }
  return saved;
}

// Duplicates a stored file under a fresh key. Used when a draft attachment is
// promoted to a sent/scheduled message: the two rows must not share a file,
// otherwise deleting the draft would unlink the sent message's attachment.
export async function copyStoredFile(storageKey: string, filename: string): Promise<string> {
  await mkdir(path.join(APP_ROOT, STORAGE_SUBDIR), { recursive: true });
  const newKey = newStorageKey(filename);
  await copyFile(path.join(APP_ROOT, storageKey), path.join(APP_ROOT, newKey));
  return newKey;
}

// Best-effort unlink — a missing file is not an error worth failing a request over.
export async function deleteStoredFiles(storageKeys: string[]): Promise<void> {
  await Promise.all(
    storageKeys.map(key =>
      unlink(path.join(APP_ROOT, key)).catch(() => {})
    )
  );
}
