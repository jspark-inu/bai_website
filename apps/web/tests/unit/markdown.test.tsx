import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownBody } from '@/components/MarkdownBody';

describe('MarkdownBody', () => {
  it('renders markdown structure instead of escaped plain text', () => {
    const body = `# Mission 00

## Do

- First agent

> Check`;
    const html = renderToStaticMarkup(<MarkdownBody body={body} />);
    expect(html).toContain('<h1>Mission 00</h1>');
    expect(html).toContain('<h2>Do</h2>');
    expect(html).toContain('<li>First agent</li>');
    expect(html).toContain('<blockquote>');
  });

  it('does not render raw script tags', () => {
    const body = '# Safe\n\n<' + 'script>alert(1)</' + 'script>';
    const html = renderToStaticMarkup(<MarkdownBody body={body} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });
});
