import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { legacyApiManifest } from '../contracts/legacy-api-manifest';

const WEB_ROOT = path.resolve(process.cwd());
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..');
const API_ROOT = path.join(WEB_ROOT, 'src', 'app', 'api');
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function routeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) return routeFiles(candidate);
    return entry.isFile() && entry.name === 'route.ts' ? [candidate] : [];
  });
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(candidate);
    return entry.isFile() && /\.(?:ts|tsx|mjs|json|sh)$/.test(entry.name) ? [candidate] : [];
  });
}

function nextPathFor(file: string) {
  const relative = path.relative(API_ROOT, path.dirname(file)).split(path.sep);
  return `/api/${relative.map((part) => part.replace(/^\[\.\.\.([^\]]+)\]$/, ':$1').replace(/^\[([^\]]+)\]$/, ':$1')).join('/')}`;
}

function exportedMethods(source: string) {
  return HTTP_METHODS.filter((method) => [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`),
    new RegExp(`export\\s+const\\s+${method}\\s*=`),
    new RegExp(`export\\s*\\{[^}]*\\bas\\s+${method}\\b[^}]*\\}`),
  ].some((pattern) => pattern.test(source)));
}

describe('Next-only runtime boundary', () => {
  it('owns every former Flask API method through an explicit Next route', () => {
    const explicit = new Set(routeFiles(API_ROOT).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const routePath = nextPathFor(file);
      if (routePath.includes(':path')) return [];
      return exportedMethods(source).map((method) => `${method} ${routePath}`);
    }));
    const missing = legacyApiManifest
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !explicit.has(key));

    expect(missing).toEqual([]);
  });

  it('has no catch-all API route or legacy proxy module', () => {
    expect(existsSync(path.join(API_ROOT, '[...path]', 'route.ts'))).toBe(false);
    expect(existsSync(path.join(WEB_ROOT, 'src', 'lib', 'legacy-api-proxy.ts'))).toBe(false);
  });

  it('removes the Flask origin, port, proxy, and Python invocation from production paths', () => {
    const runtimeEntryFiles = [
      path.join(WEB_ROOT, 'package.json'),
      path.join(REPO_ROOT, 'scripts', 'deploy-react-to-live.sh'),
      path.join(REPO_ROOT, 'scripts', 'autodeploy-main.sh'),
    ].filter(existsSync);
    const productionFiles = [
      path.join(REPO_ROOT, '.env.example'),
      ...runtimeEntryFiles,
      ...sourceFiles(path.join(WEB_ROOT, 'src')),
    ].filter(existsSync);
    const legacyOffenders = productionFiles.filter((file) => /BAI_API_ORIGIN|(?:127\.0\.0\.1:)?5066|proxyLegacyApi|legacy-api-proxy/.test(readFileSync(file, 'utf8')));
    const pythonRuntimeOffenders = runtimeEntryFiles.filter((file) => /\bpython(?:[0-9.]*)?\b|backup_db\.py|repo_dir\/backend/.test(readFileSync(file, 'utf8')));

    expect(legacyOffenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
    expect(pythonRuntimeOffenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });
});
