import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModernLoginPage } from '@/components/ModernPages';

describe('modern React UI shell', () => {
  it('does not keep routing through legacy wrapper components', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const appDir = path.join(process.cwd(), 'src/app');
    const files: string[] = [];
    async function walk(dir: string) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(fullPath);
        if (entry.isFile() && entry.name.endsWith('.tsx')) files.push(fullPath);
      }
    }
    await walk(appDir);
    const sources = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));

    expect(sources.join('\n')).not.toMatch(/Legacy(Feed|Login|Cockpit|PI)Page|LegacyPages/);
  });

  it('renders the upgraded login page with the existing login contract preserved', () => {
    const html = renderToStaticMarkup(<ModernLoginPage />);

    expect(html).toContain('data-ui-version="react-modern-v1"');
    expect(html).toContain('BAI 멤버의 진행 공유 공간');
    expect(html).toContain('id="name"');
    expect(html).toContain('id="pw"');
    expect(html).toContain('로그인');
  });
});
