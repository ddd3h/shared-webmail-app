// Seed script to create an initial admin user
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

async function hashPassword(password) {
  const salt = randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const dkLen = 64;
  const key = await scryptAsync(password, salt, dkLen, { N, r, p });
  return `scrypt$${N}$${r}$${dkLen}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function main() {
  const existingAdmin = await prisma.users.findUnique({ where: { email: 'admin@example.com' } });
  const defaultSignature = (name, email) =>
    `───────────────\n${name}\nChart株式会社\n\n〒350-0054\n埼玉県川越市三久保町15-2（3F）\nEmail: ${email}\n───────────────`;

  if (!existingAdmin) {
    const hash = await hashPassword('admin1234');
    await prisma.users.create({
      data: {
        name: '管理者',
        email: 'admin@example.com',
        password_hash: hash,
        role: 'admin',
        signature: defaultSignature('管理者', 'admin@example.com')
      }
    });
    console.log('✓ 管理者ユーザーを作成しました: admin@example.com / admin1234');
  } else {
    console.log('✓ 管理者ユーザーは既に存在します');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
