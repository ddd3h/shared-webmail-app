import { readFile, writeFile, mkdir, stat, unlink } from 'fs/promises';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'storage', 'avatars');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getCachedAvatar(userId: string): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const file = path.join(CACHE_DIR, userId);
    const s = await stat(file);
    if (Date.now() - s.mtimeMs > TTL_MS) return null;
    const [data, ct] = await Promise.all([
      readFile(file),
      readFile(`${file}.meta`, 'utf8').catch(() => 'image/png'),
    ]);
    return { data, contentType: ct };
  } catch {
    return null;
  }
}

export async function saveAvatarCache(userId: string, data: Buffer, contentType: string): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, userId);
  await Promise.all([
    writeFile(file, data),
    writeFile(`${file}.meta`, contentType),
  ]);
}

export async function clearAvatarCache(userId: string): Promise<void> {
  const file = path.join(CACHE_DIR, userId);
  await Promise.all([
    unlink(file).catch(() => {}),
    unlink(`${file}.meta`).catch(() => {}),
  ]);
}
