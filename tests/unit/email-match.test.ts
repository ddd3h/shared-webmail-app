import { describe, it, expect } from 'vitest';
import { escapeLike, sameEmail, emailEquals } from '@/lib/email-match';
describe('email-match', () => {
  it('escapes ILIKE wildcards', () => {
    expect(escapeLike('%')).toBe('\\%');
    expect(escapeLike('a_b%c\\')).toBe('a\\_b\\%c\\\\');
    expect(emailEquals('%').equals).toBe('\\%');
  });
  it('sameEmail is exact, case-insensitive', () => {
    expect(sameEmail('A@x.com', 'a@X.com')).toBe(true);
    expect(sameEmail('a@x.com', '%')).toBe(false);
    expect(sameEmail('a@x.com', '_@x.com')).toBe(false);
    expect(sameEmail(null, 'a')).toBe(false);
  });
});
