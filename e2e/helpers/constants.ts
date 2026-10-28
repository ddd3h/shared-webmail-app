export const PORT = Number(process.env.E2E_PORT || 3100);
export const BASE_URL = `http://localhost:${PORT}`;
export const MM_PORT = Number(process.env.E2E_MM_PORT || 8065);
export const MM_URL = `http://localhost:${MM_PORT}`;
export const DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgresql://postgres@localhost:5433/webmail_e2e?schema=public';

export const ENCRYPTION_KEY_HEX = '1111111111111111111111111111111111111111111111111111111111111111';

export const PASSWORD = 'E2ePassw0rd!';

export type Role = 'admin' | 'admin2' | 'sato' | 'suzuki' | 'yamada' | 'tanaka' | 'keiri' | 'guest';

// worker_type: 従業員=employee / 業務委託=contractor / 役員=executive
export const USERS: Record<Role, { id: string; name: string; email: string; role: 'admin' | 'user'; worker_type: 'employee' | 'contractor' | 'executive'; is_accounting?: boolean }> = {
  admin:  { id: 'u_admin',  name: '管理者',   email: 'admin@e2e.test',  role: 'admin', worker_type: 'employee' },
  admin2: { id: 'u_admin2', name: '副管理者', email: 'admin2@e2e.test', role: 'admin', worker_type: 'executive' },
  sato:   { id: 'u_sato',   name: '佐藤',     email: 'sato@e2e.test',   role: 'user',  worker_type: 'employee' },
  suzuki: { id: 'u_suzuki', name: '鈴木',     email: 'suzuki@e2e.test', role: 'user',  worker_type: 'contractor' },
  yamada: { id: 'u_yamada', name: '山田',     email: 'yamada@e2e.test', role: 'user',  worker_type: 'executive' },
  tanaka: { id: 'u_tanaka', name: '田中',     email: 'tanaka@e2e.test', role: 'user',  worker_type: 'employee' },
  // 経理担当: a normal user who may also make 全銀 files and check receiving accounts
  // a person nobody else's test depends on: security tests may end all of this account's sessions or lock it
  guest:  { id: 'u_guest',  name: '来客',     email: 'guest@e2e.test',  role: 'user',  worker_type: 'contractor' },
  keiri:  { id: 'u_keiri',  name: '経理',     email: 'keiri@e2e.test',  role: 'user',  worker_type: 'employee', is_accounting: true },
};

export const ROLES = Object.keys(USERS) as Role[];
export const AUTH = Object.fromEntries(ROLES.map(r => [r, `e2e/.auth/${r}.json`])) as Record<Role, string>;

export const MAILBOX_ID = 'mb_team';
export const RATE_IDS = { domestic: 'tat_domestic', overseas: 'tat_overseas', onsite: 'tat_onsite', resident: 'tat_resident', lodging: 'tat_lodging', event: 'tat_event' };
