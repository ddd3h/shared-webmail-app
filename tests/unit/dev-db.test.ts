import { describe, it, expect } from 'vitest';
import { parseDbTarget, splitArgs, composeEnv, loopbackUrl } from '../../scripts/lib/dev-db.mjs';

describe('parseDbTarget', () => {
  it('localhost は自分のPC。ユーザー・パスワード・DB名・ポートを取り出す（記号は復号）', () => {
    expect(parseDbTarget('postgresql://webmail:p%40ss%3A1@localhost:5433/webmail_app?schema=public')).toEqual({
      host: 'localhost', port: 5433, user: 'webmail', password: 'p@ss:1', database: 'webmail_app', isLocal: true,
    });
  });
  it('ポートを省くと 5432。127.0.0.1 も自分のPC', () => {
    expect(parseDbTarget('postgres://u:p@127.0.0.1/db')).toMatchObject({ port: 5432, isLocal: true });
  });
  it('別のホストは自分のPCではない（データベースを起動しない）', () => {
    expect(parseDbTarget('postgresql://u:p@db.example.com:5432/x')?.isLocal).toBe(false);
    expect(parseDbTarget('postgresql://u:p@db:5432/x')?.isLocal).toBe(false);
  });
  it('PostgreSQL の URL でなければ null', () => {
    expect(parseDbTarget('')).toBeNull();
    expect(parseDbTarget('not a url')).toBeNull();
    expect(parseDbTarget('mysql://u:p@localhost/x')).toBeNull();
  });
});

describe('splitArgs', () => {
  it('-- の後ろを実行するコマンドにする', () => {
    expect(splitArgs(['--migrate', '--', 'next', 'dev'])).toEqual({ migrate: true, command: ['next', 'dev'] });
    expect(splitArgs(['--', 'node', 'seed.mjs', '--reset'])).toEqual({ migrate: false, command: ['node', 'seed.mjs', '--reset'] });
  });
  it('-- が無ければ全部がコマンド', () => {
    expect(splitArgs(['next', 'dev'])).toEqual({ migrate: false, command: ['next', 'dev'] });
  });
});

describe('composeEnv', () => {
  it('DATABASE_URL のユーザー・パスワード・DB名・ポートで Docker のDBを作る', () => {
    const env = composeEnv({ port: 5433, user: 'webmail', password: 'pw', database: 'webmail_app' }, { PATH: '/bin' } as unknown as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ PATH: '/bin', DEV_DB_PORT: '5433', DEV_DB_USER: 'webmail', DEV_DB_PASSWORD: 'pw', DEV_DB_NAME: 'webmail_app', DEV_DB_AUTH: 'scram-sha-256' });
  });
  it('パスワードのない DATABASE_URL なら、コンテナはパスワードなしで受け付ける（このPCからだけ）', () => {
    expect(composeEnv({ port: 5432, user: 'ddd3h', password: '', database: 'x' }, {} as NodeJS.ProcessEnv)).toMatchObject({ DEV_DB_USER: 'ddd3h', DEV_DB_AUTH: 'trust' });
  });
  it('ユーザーやパスワードが空でも既定を使う', () => {
    expect(composeEnv({ port: 5432, user: '', password: '', database: 'x' }, {} as NodeJS.ProcessEnv)).toMatchObject({ DEV_DB_USER: 'webmail', DEV_DB_PASSWORD: 'webmail' });
  });
});

describe('loopbackUrl', () => {
  it('localhost を 127.0.0.1 にする（IPv6 の ::1 に別のDBが居ても影響されない）', () => {
    expect(loopbackUrl('postgresql://u:p@localhost:5432/db?schema=public')).toBe('postgresql://u:p@127.0.0.1:5432/db?schema=public');
    expect(loopbackUrl('postgresql://u:p%40x@localhost/db')).toContain('p%40x@127.0.0.1');
  });
  it('それ以外はそのまま', () => {
    expect(loopbackUrl('postgresql://u:p@db.example.com:5432/db')).toBe('postgresql://u:p@db.example.com:5432/db');
    expect(loopbackUrl('not a url')).toBe('not a url');
  });
});
