import { gzipSync } from 'zlib';
import { getSession } from '@/lib/auth';
import { getTrainingData } from '@/lib/spam-classifier';
import { checkAdmin } from '../route';

// GET /api/admin/spam-classifier/export — download training data as gzip-compressed JSON
export async function GET() {
  const session = await getSession();
  await checkAdmin(session);
  const items = await getTrainingData();
  const json = JSON.stringify({ items, exportedAt: new Date().toISOString() });
  const compressed = gzipSync(Buffer.from(json, 'utf-8'));
  return new Response(compressed, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': 'attachment; filename="training-data.json.gz"',
    },
  });
}
