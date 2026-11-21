import { describe, expect, it } from 'vitest';
import { safeLinkUrl } from '../src/lib/ask';

describe('links from documents', () => {
  it('opens web, mail, phone and FTP addresses', () => {
    expect(safeLinkUrl('https://example.com/a?b=(c)')).toBe('https://example.com/a?b=(c)');
    expect(safeLinkUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    expect(safeLinkUrl('tel:+49123')).toBe('tel:+49123');
    expect(safeLinkUrl('www.example.com')).toBe('https://www.example.com/');
  });

  it('refuses scripts, data, files and anything it cannot parse', () => {
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'vbscript:x', 'blob:https://x/1', '', undefined, 'not a url']) {
      expect(safeLinkUrl(bad)).toBeUndefined();
    }
  });
});
