import { describe, it, expect } from 'vitest';
import { normalizeSubject } from '@/lib/subject';

describe('subject normalization', () => {
  it('removes reply prefixes and normalizes', () => {
    expect(normalizeSubject('Re: Re:  Hello  World ')).toBe('hello world');
    expect(normalizeSubject('Fwd: Something')).toBe('something');
  });
});

