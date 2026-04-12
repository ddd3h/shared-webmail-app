export function normalizeSubject(subject: string): string {
  if (!subject) return '';
  let s = subject.trim();
  // Remove common reply/forward prefixes
  s = s.replace(/^((re|fw|fwd)\s*:\s*)+/i, '');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLowerCase();
}

