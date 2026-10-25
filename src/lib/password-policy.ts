// Rules for choosing a new password (not applied at login, so existing passwords keep working).
export const MIN_PASSWORD_LENGTH = 10;
const COMMON = ['password', 'passw0rd', 'p@ssw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'changeme', 'iloveyou', 'abc123', '123456', '111111', 'monkey', 'dragon', 'login'];

/** A reason (Japanese, shown to the person) when the password is not acceptable, otherwise null. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`;
  if (password.length > 200) return 'パスワードが長すぎます';
  const lower = password.toLowerCase();
  if (new Set(lower).size < 5) return '同じ文字の繰り返しが多すぎます';
  if (COMMON.some(w => lower.includes(w)) && password.length < 16) return 'よく使われるパスワードは使えません';
  const local = (context.email ?? '').split('@')[0].toLowerCase();
  if (local.length >= 3 && lower.includes(local)) return 'メールアドレスを含むパスワードは使えません';
  const squeeze = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const name = squeeze(context.name ?? '');
  if (name.length >= 3 && squeeze(password).includes(name)) return '名前を含むパスワードは使えません';
  return null;
}
