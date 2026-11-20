// Look at or lift the lockdown, on the server:  node --env-file=.env scripts/lockdown.mjs status|release|engage
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const cmd = process.argv[2];
try {
  const row = await prisma.app_settings.findUnique({ where: { key: 'LOCKDOWN' } });
  if (cmd === 'release') {
    await prisma.app_settings.deleteMany({ where: { key: 'LOCKDOWN' } });
    console.log(row ? 'シャットアウトを解除しました（数秒で反映されます）' : 'シャットアウトは掛かっていません');
  } else if (cmd === 'engage') {
    const value = JSON.stringify({ at: new Date().toISOString(), manual: true });
    await prisma.app_settings.upsert({ where: { key: 'LOCKDOWN' }, create: { key: 'LOCKDOWN', value }, update: { value } });
    console.log('手動でシャットアウトしました（数秒で反映されます）');
  } else {
    console.log(row ? `シャットアウト中: ${row.value}` : 'シャットアウトは掛かっていません');
  }
} finally { await prisma.$disconnect(); }
