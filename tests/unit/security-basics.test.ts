import { describe, it, expect } from 'vitest';
import { ipMatches, isValidRule, matchesAny, normalizeIp, parseRules } from '@/lib/cidr';
import { clientIpFrom, sameNetwork } from '@/lib/client-ip';
import { describeDevice, deviceFingerprint, looksAutomated } from '@/lib/device';
import { passwordProblem } from '@/lib/password-policy';
import { parsePolicy } from '@/lib/security-settings';

describe('IPアドレスのルール', () => {
  it('単一のアドレスと IPv4 の範囲（CIDR）に一致する', () => {
    expect(ipMatches('203.0.113.7', '203.0.113.7')).toBe(true);
    expect(ipMatches('203.0.113.8', '203.0.113.7')).toBe(false);
    expect(ipMatches('203.0.113.200', '203.0.113.0/24')).toBe(true);
    expect(ipMatches('203.0.114.1', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipMatches('8.8.8.8', '0.0.0.0/0')).toBe(true);
    expect(ipMatches('203.0.113.1', '203.0.113.1/32')).toBe(true);
    expect(ipMatches('203.0.113.2', '203.0.113.1/32')).toBe(false);
  });
  it('IPv4 を IPv6 形式で受けても同じように一致する', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipMatches('::ffff:203.0.113.7', '203.0.113.0/24')).toBe(true);
  });
  it('IPv6 は完全一致だけ', () => {
    expect(ipMatches('2001:db8::1', '2001:db8::1')).toBe(true);
    expect(ipMatches('2001:db8::2', '2001:db8::1')).toBe(false);
    expect(ipMatches('2001:db8::1', '203.0.113.0/24')).toBe(false);
  });
  it('ルールの書式チェック', () => {
    for (const ok of ['1.2.3.4', '1.2.3.0/24', '0.0.0.0/0', '2001:db8::1']) expect(isValidRule(ok), ok).toBe(true);
    for (const bad of ['', 'abc', '1.2.3.4/33', '1.2.3/24', '1.2.3.4/', '1.2.3.4/24/1', '256.1.1.1', '1.2.3.4/-1']) expect(isValidRule(bad), bad).toBe(false);
  });
  it('複数行・カンマ区切り・コメントを読める', () => {
    expect(parseRules('1.1.1.1  # 本社\n\n2.2.2.0/24, 3.3.3.3')).toEqual(['1.1.1.1', '2.2.2.0/24', '3.3.3.3']);
    expect(matchesAny('2.2.2.9', parseRules('1.1.1.1\n2.2.2.0/24'))).toBe(true);
  });
});

describe('接続元IPの決め方（X-Forwarded-For は偽装できる）', () => {
  const h = (xff?: string, real?: string) => (n: string) => (n === 'x-forwarded-for' ? xff : n === 'x-real-ip' ? real : null);
  it('プロキシ1台なら、右端（自分のプロキシが追記した値）を使う。左端に偽の値を書かれても無視', () => {
    expect(clientIpFrom(h('1.1.1.1, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientIpFrom(h('6.6.6.6, 6.6.6.7, 203.0.113.9'), 1)).toBe('203.0.113.9');
  });
  it('プロキシ2台なら右から2番目', () => expect(clientIpFrom(h('6.6.6.6, 203.0.113.9, 10.0.0.2'), 2)).toBe('203.0.113.9'));
  it('ヘッダが短ければ先頭を使う（台数より少ない場合）', () => expect(clientIpFrom(h('203.0.113.9'), 2)).toBe('203.0.113.9'));
  it('プロキシなし（0）なら、ヘッダは信用せず unknown', () => expect(clientIpFrom(h('6.6.6.6', '7.7.7.7'), 0)).toBe('unknown'));
  it('ヘッダがない・IPでない値は unknown。x-real-ip に頼ることもある', () => {
    expect(clientIpFrom(h(undefined), 1)).toBe('unknown');
    expect(clientIpFrom(h('not-an-ip'), 1)).toBe('unknown');
    expect(clientIpFrom(h(undefined, '203.0.113.5'), 1)).toBe('203.0.113.5');
  });
  it('::ffff: 形式の IPv4 は通常の形に直す', () => expect(clientIpFrom(h('::ffff:203.0.113.9'), 1)).toBe('203.0.113.9'));
});

describe('端末の判別', () => {
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const safariIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  it('ブラウザとOSを答える', () => {
    expect(describeDevice(chromeWin)).toEqual({ browser: 'Chrome', os: 'Windows' });
    expect(describeDevice(safariIphone)).toEqual({ browser: 'Safari', os: 'iOS' });
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Edg/126.0')).toEqual({ browser: 'Edge', os: 'Windows' });
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0')).toEqual({ browser: 'Firefox', os: 'Linux' });
    expect(describeDevice(null)).toEqual({ browser: '不明なブラウザ', os: '不明なOS' });
  });
  it('指紋はバージョンが変わっても同じで、端末が変われば違う', () => {
    expect(deviceFingerprint(chromeWin)).toBe(deviceFingerprint(chromeWin.replace('126.0.0.0', '131.0.0.0')));
    expect(deviceFingerprint(chromeWin)).not.toBe(deviceFingerprint(safariIphone));
  });
  it('スクリプトやスキャナは自己申告で見分けられる', () => {
    for (const ua of ['curl/8.0', 'python-requests/2.31', 'Go-http-client/1.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'HeadlessChrome/120', '']) expect(looksAutomated(ua), ua).toBe(true);
    expect(looksAutomated(chromeWin)).toBe(false);
  });
});

describe('パスワードのルール', () => {
  it('10文字未満は不可', () => expect(passwordProblem('Abcdef1!x')).toContain('10文字以上'));
  it('よく使われる語・同じ文字の繰り返し・メールや名前を含むものは不可', () => {
    expect(passwordProblem('Password12345')).toContain('よく使われる');
    expect(passwordProblem('aaaaaaaaaaaa')).toContain('繰り返し');
    expect(passwordProblem('taro.yamada-2026!', { email: 'taro.yamada@example.com' })).toContain('メールアドレス');
    expect(passwordProblem('Yamada-Taro-2026', { name: 'Yamada Taro' })).toContain('名前');
  });
  it('長い文章のようなパスワードは、よくある語を含んでいても使える', () => expect(passwordProblem('correct-horse-battery-welcome-staple')).toBeNull());
  it('普通のパスワードは通る', () => {
    expect(passwordProblem('Tr0ub4dor&3-xyz')).toBeNull();
    expect(passwordProblem('E2e-Tr0ub4dor-Pw')).toBeNull();
  });
  it('200文字を超えると不可', () => expect(passwordProblem('aB1!'.repeat(60))).not.toBeNull());
});

describe('セキュリティ設定の読み込み', () => {
  it('空なら制限なし・セッション14日・新しい端末の通知あり', () => {
    expect(parsePolicy({ cidrs: null, countries: null, days: null, alert: null })).toEqual({ allowedRules: [], allowedCountries: [], sessionMaxDays: 14, newDeviceAlert: true, deviceBinding: true, require2fa: true, blockBots: true, rememberDays: 30, mfaTrustDays: 30 });
  });
  it('不正なルールは捨て、範囲外の日数は既定に戻す', () => {
    const p = parsePolicy({ cidrs: '1.2.3.4\nbad\n10.0.0.0/8', countries: 'Japan, United States', days: '500', alert: 'off' });
    expect(p).toEqual({ allowedRules: ['1.2.3.4', '10.0.0.0/8'], allowedCountries: ['Japan', 'United States'], sessionMaxDays: 14, newDeviceAlert: false, deviceBinding: true, require2fa: true, blockBots: true, rememberDays: 30, mfaTrustDays: 30 });
    expect(parsePolicy({ cidrs: null, countries: null, days: '7', alert: 'on' }).sessionMaxDays).toBe(7);
    expect(parsePolicy({ cidrs: null, countries: null, days: null, alert: null, binding: 'off' }).deviceBinding).toBe(false);
    expect(parsePolicy({ cidrs: null, countries: null, days: null, alert: null, twofa: 'off' }).require2fa).toBe(false);
    expect(parsePolicy({ cidrs: null, countries: null, days: null, alert: null, trust: '0' }).mfaTrustDays).toBe(0);
    expect(parsePolicy({ cidrs: null, countries: null, days: null, alert: null, trust: '999' }).mfaTrustDays).toBe(30);
    expect(parsePolicy({ cidrs: null, countries: null, days: null, alert: null, bots: 'off' }).blockBots).toBe(false);
  });
});

import { budgetFor, isRecordPath } from '@/lib/api-budget';
import { originProblem } from '@/lib/origin-check';
import { judgeAuthenticated, judgeUnauthenticated, SWEEP } from '@/lib/sweep-guard';
import { noteAccountTried, LIMITS } from '@/lib/login-guard';

describe('APIの利用上限', () => {
  it('重要なエンドポイントほど厳しい', () => {
    expect(budgetFor('/api/payments/export')).toMatchObject({ group: 'export', perMinute: 10 });
    expect(budgetFor('/api/bank-accounts')).toMatchObject({ group: 'bank-accounts' });
    expect(budgetFor('/api/bank-accounts/u1/verify').group).toBe('bank-accounts');
    expect(budgetFor('/api/expenses').group).toBe('api');
    expect(budgetFor('/api/payments/exports-not').group).toBe('api'); // a longer name is not the same endpoint
    expect(budgetFor('/api/admin/users').group).toBe('admin');
  });
  it('レコードのURL（cuid / uuid）を見分ける', () => {
    expect(isRecordPath('/api/evaluations/cm2xk3l9a0000abcdefghijkl')).toBe(true);
    expect(isRecordPath('/api/expenses/3f2c9a1e-1111-4222-8333-444455556666/review')).toBe(true);
    expect(isRecordPath('/api/evaluations/cycles')).toBe(false);
    expect(isRecordPath('/api/expenses')).toBe(false);
  });
});

describe('Originの確認（CSRF対策）', () => {
  const own = ['app.example.com', 'localhost:3100'];
  it('他のサイトからの更新リクエストは拒否する', () => {
    expect(originProblem('POST', 'https://evil.example', own)).toBe(true);
    expect(originProblem('DELETE', 'null', own)).toBe(true);
    expect(originProblem('PUT', 'not a url', own)).toBe(true);
  });
  it('自分のサイトからは通す。読み取り(GET)・Originなし（スクリプト）は対象外', () => {
    expect(originProblem('POST', 'https://app.example.com', own)).toBe(false);
    expect(originProblem('POST', 'http://localhost:3100', own)).toBe(false);
    expect(originProblem('GET', 'https://evil.example', own)).toBe(false);
    expect(originProblem('POST', null, own)).toBe(false);
  });
  it('ホスト名の大文字小文字は区別しない', () => expect(originProblem('POST', 'https://APP.example.com', own)).toBe(false));
});

describe('スイープ（総当たりの探索）の検知', () => {
  it('ログインなしで多数の別パスを探ると、スキャンとして扱う', () => {
    const ip = '198.51.100.1', now = Date.now();
    for (let i = 0; i < SWEEP.distinctPathsUnauth; i++) expect(judgeUnauthenticated(ip, `/page-${i}`, now).ok).toBe(true);
    const v = judgeUnauthenticated(ip, '/wp-admin', now);
    expect(v).toMatchObject({ ok: false, sweep: true, reason: 'unauthenticated_path_scan' });
  });
  it('同じパスを繰り返しても、パスの種類が増えなければスキャンではない', () => {
    for (let i = 0; i < 10; i++) expect(judgeUnauthenticated('198.51.100.2', '/login').ok).toBe(true);
  });
  it('接続元が不明なら判定しない（全員を同じ扱いにしてしまわないため）', () => {
    for (let i = 0; i < 100; i++) expect(judgeUnauthenticated('unknown', `/p${i}`).ok).toBe(true);
  });
  it('ログイン済みでも、レコードを次々に読むとスイープ', () => {
    const now = Date.now();
    for (let i = 0; i < SWEEP.distinctRecordsPerMinute; i++) expect(judgeAuthenticated('u-sweeper', `/api/evaluations/c${String(i).padStart(24, 'a')}`, now).ok).toBe(true);
    expect(judgeAuthenticated('u-sweeper', `/api/evaluations/c${'z'.repeat(24)}`, now)).toMatchObject({ ok: false, sweep: true, reason: 'record_sweep' });
  });
  it('重要エンドポイントは上限を超えると429', () => {
    let last: any;
    for (let i = 0; i < 11; i++) last = judgeAuthenticated('u-exporter', '/api/payments/export');
    expect(last).toMatchObject({ ok: false, status: 429, reason: 'budget_export' });
    expect(judgeAuthenticated('u-other', '/api/payments/export').ok).toBe(true); // others are unaffected
  });
  it('1つのIPが多数のアカウントを試すとスイープ（ログイン）', () => {
    const ip = '198.51.100.3', now = Date.now();
    let n = 0;
    for (let i = 0; i < LIMITS.distinctEmails; i++) n = noteAccountTried(ip, `user${i}@example.com`, now);
    expect(n).toBe(LIMITS.distinctEmails);
    expect(noteAccountTried(ip, 'another@example.com', now)).toBe(LIMITS.distinctEmails + 1);
    expect(noteAccountTried(ip, 'another@example.com', now)).toBe(LIMITS.distinctEmails + 1); // the same account again is not new
    expect(noteAccountTried(ip, 'x@example.com', now + 11 * 60_000)).toBe(1); // the window ended
  });
});

import { base32Decode, base32Encode, codeForStep, generateRecoveryCode, generateSecret, looksLikeRecoveryCode, normalizeRecoveryCode, otpauthUri, stepAt, verifyCode } from '@/lib/totp';

describe('TOTP（認証アプリのワンタイムパスワード）', () => {
  const rfcSecret = Buffer.from('12345678901234567890'); // the test key of RFC 6238
  it('RFC 6238 の公式テストベクタと一致する（8桁の値の下6桁）', () => {
    const vectors: [number, string][] = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']];
    for (const [seconds, code] of vectors) expect(codeForStep(rfcSecret, stepAt(seconds * 1000)), String(seconds)).toBe(code);
  });
  it('Base32の変換が往復できる', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI')!.toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi')!.toString()).toBe('foobar');
    for (const bad of ['', '1', 'abc!', 'MZXW6YTB0I']) expect(base32Decode(bad), bad).toBeNull();
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s)!)).toBe(s);
  });
  const secret = base32Encode(rfcSecret);
  const now = 1_700_000_000_000;
  const at = (offset: number) => codeForStep(rfcSecret, stepAt(now) + offset);
  it('今の30秒の前後1つまで受け付ける（時計のずれ）が、それ以上は拒否', () => {
    expect(verifyCode(secret, at(0), { now })).toBe(stepAt(now));
    expect(verifyCode(secret, at(-1), { now })).toBe(stepAt(now) - 1);
    expect(verifyCode(secret, at(1), { now })).toBe(stepAt(now) + 1);
    expect(verifyCode(secret, at(-2), { now })).toBeNull();
    expect(verifyCode(secret, at(2), { now })).toBeNull();
  });
  it('一度使った30秒（やそれ以前）のコードは再利用できない', () => {
    const step = stepAt(now);
    expect(verifyCode(secret, at(0), { now, lastStep: step })).toBeNull();
    expect(verifyCode(secret, at(-1), { now, lastStep: step })).toBeNull();
    expect(verifyCode(secret, at(1), { now, lastStep: step })).toBe(step + 1);
    expect(verifyCode(secret, at(0), { now, lastStep: step - 1 })).toBe(step);
  });
  it('空白入りは許し、6桁の数字でないもの・壊れた秘密鍵は拒否', () => {
    expect(verifyCode(secret, `${at(0).slice(0, 3)} ${at(0).slice(3)}`, { now })).toBe(stepAt(now));
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34', '１２３４５６']) expect(verifyCode(secret, bad, { now }), bad).toBeNull();
    expect(verifyCode('not base32!', at(0), { now })).toBeNull();
  });
  it('QRコードに入るURIに、鍵・発行元・アカウント・桁数・周期が入る', () => {
    const uri = otpauthUri({ secret: 'ABCDEF234567', account: 'taro@example.com', issuer: '共有メールワークスペース' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=ABCDEF234567');
    expect(uri).toContain(`issuer=${encodeURIComponent('共有メールワークスペース')}`);
    expect(uri).toContain(encodeURIComponent('taro@example.com'));
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
  it('回復コードは「xxxxx-xxxxx」形式で、見間違えやすい文字を含まず、毎回違う', () => {
    const codes = new Set(Array.from({ length: 200 }, generateRecoveryCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });
  it('回復コードの入力は、大文字・空白・ダッシュの有無を問わない', () => {
    expect(normalizeRecoveryCode(' ABCDE-fghjk ')).toBe('abcdefghjk');
    expect(looksLikeRecoveryCode('abcde fghjk')).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});

describe('sameNetwork（ログイン中のIPアドレス確認）', () => {
  it('IPv4は完全一致だけ同じ', () => {
    expect(sameNetwork('203.0.113.5', '203.0.113.5')).toBe(true);
    expect(sameNetwork('203.0.113.5', '203.0.113.6')).toBe(false);
    expect(sameNetwork('::ffff:203.0.113.5', '203.0.113.5')).toBe(true);
  });
  it('IPv6は先頭64ビット（同じ回線）が同じなら同じ。省略表記も同じ扱い', () => {
    expect(sameNetwork('2001:db8:1:2:aaaa::1', '2001:db8:1:2:bbbb::2')).toBe(true);
    expect(sameNetwork('2001:db8:1:3::1', '2001:db8:1:2::1')).toBe(false);
    expect(sameNetwork('2001:0db8:0001:0002::1', '2001:db8:1:2::9')).toBe(true);
    expect(sameNetwork('2001:db8::1', '2001:db8:0:1::1')).toBe(false);
    expect(sameNetwork('2001:db8::1', '203.0.113.5')).toBe(false);
  });
  it('このマシン自身（::1 と 127.0.0.1）は同じ', () => {
    expect(sameNetwork('::1', '127.0.0.1')).toBe(true);
    expect(sameNetwork('::1', '203.0.113.5')).toBe(false);
  });
  it('分からないアドレスは、何とも同じにならない（unknown同士でも）', () => {
    expect(sameNetwork('unknown', 'unknown')).toBe(false);
    expect(sameNetwork('unknown', '203.0.113.5')).toBe(false);
  });
});
