import { describe, expect, it } from 'vitest';
import { safeMaterialUrl } from '@/lib/url';

describe('safeMaterialUrl', () => {
  it('keeps relative and https urls', () => {
    expect(safeMaterialUrl('/static/example.html')).toBe('/static/example.html');
    expect(safeMaterialUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it('drops unsafe protocols', () => {
    expect(safeMaterialUrl('javascript:alert(1)')).toBe('');
    expect(safeMaterialUrl('data:text/html,hi')).toBe('');
  });
});
