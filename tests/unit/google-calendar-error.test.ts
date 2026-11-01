import { describe, it, expect } from 'vitest';
import { classifyGoogleError } from '@/lib/google-calendar';

describe('Googleカレンダーの一覧が読めない理由', () => {
  it('Calendar API が有効になっていない（一番多い原因）', () => {
    const body = { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Google Calendar API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }], details: [{ reason: 'SERVICE_DISABLED' }] } };
    expect(classifyGoogleError(403, body)).toBe('api_disabled');
    expect(classifyGoogleError(403, { error: { message: 'Calendar API has not been used in project 9 before or it is disabled' } })).toBe('api_disabled');
  });
  it('確認画面でカレンダーの権限にチェックが入っていない', () => {
    expect(classifyGoogleError(403, { error: { status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }], details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } })).toBe('insufficient_scope');
  });
  it('トークンが無効（401）は連携の切れ。それ以外は一般の失敗', () => {
    expect(classifyGoogleError(401, { error: { status: 'UNAUTHENTICATED' } })).toBe('token_expired');
    expect(classifyGoogleError(500, { error: { message: 'Backend Error' } })).toBe('google_api_failed');
    expect(classifyGoogleError(503, null)).toBe('google_api_failed');
  });
});
