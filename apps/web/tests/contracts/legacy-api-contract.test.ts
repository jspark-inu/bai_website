import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import sharedLegacyApiFixtures from './legacy-api-fixtures.json';

import {
  legacyApiContractFixtures,
  legacyApiManifest,
} from './legacy-api-manifest';

const backendAppPath = fileURLToPath(
  new URL('../../../../backend/app.py', import.meta.url),
);

interface ExtractedRoute {
  method: string;
  path: string;
}

function normalizeFlaskPath(path: string): string {
  return path.replace(/<(?:[^:>]+:)?([^>]+)>/g, ':$1');
}

function extractFlaskApiRoutes(sourcePath = backendAppPath): ExtractedRoute[] {
  const extractor = String.raw`
import ast
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
tree = ast.parse(source, filename=sys.argv[1])
routes = []
shortcut_methods = {
    "get": "GET",
    "post": "POST",
    "delete": "DELETE",
    "put": "PUT",
    "patch": "PATCH",
}
route_decorators = {"route", *shortcut_methods}


def fail(message, decorator):
    line = getattr(decorator, "lineno", "unknown")
    print(f"Unsupported Flask route declaration at {sys.argv[1]}:{line}: {message}", file=sys.stderr)
    sys.exit(1)


for node in ast.walk(tree):
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
    for decorator in node.decorator_list:
        decorator_func = decorator.func if isinstance(decorator, ast.Call) else decorator
        if not (
            isinstance(decorator_func, ast.Attribute)
            and decorator_func.attr in route_decorators
        ):
            continue
        if not isinstance(decorator, ast.Call):
            fail("expected a called decorator with a literal string path", decorator)

        path_node = decorator.args[0] if decorator.args else None
        if path_node is None:
            rule_keywords = [keyword for keyword in decorator.keywords if keyword.arg == "rule"]
            if len(rule_keywords) == 1:
                path_node = rule_keywords[0].value
        if not (
            isinstance(path_node, ast.Constant)
            and isinstance(path_node.value, str)
        ):
            fail("expected a literal string path", decorator)
        path = path_node.value

        if any(keyword.arg is None for keyword in decorator.keywords):
            fail("expanded keyword options are unsupported because they may hide methods", decorator)

        if decorator_func.attr == "route":
            methods = ["GET"]
            method_keywords = [
                keyword for keyword in decorator.keywords if keyword.arg == "methods"
            ]
            if len(method_keywords) > 1:
                fail("expected at most one methods option", decorator)
            if method_keywords:
                methods_node = method_keywords[0].value
                if not isinstance(methods_node, (ast.List, ast.Tuple)) or not all(
                    isinstance(item, ast.Constant) and isinstance(item.value, str)
                    for item in methods_node.elts
                ):
                    fail("methods must be a literal list or tuple of literal strings", decorator)
                methods = [item.value for item in methods_node.elts]
        else:
            if any(keyword.arg == "methods" for keyword in decorator.keywords):
                fail("shortcut decorators do not support a methods option", decorator)
            methods = [shortcut_methods[decorator_func.attr]]

        if not path.startswith("/api/"):
            continue
        for method in methods:
            if method.upper() not in {"HEAD", "OPTIONS"}:
                routes.append({"method": method.upper(), "path": path})
print(json.dumps(routes))
`;

  const routes = JSON.parse(
    execFileSync('python3', ['-c', extractor, sourcePath], {
      encoding: 'utf8',
    }),
  ) as ExtractedRoute[];

  return routes.map((route) => ({
    method: route.method,
    path: normalizeFlaskPath(route.path),
  }));
}

function withTemporaryPythonSource<T>(source: string, run: (sourcePath: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'bai-flask-routes-'));
  const sourcePath = join(directory, 'app.py');

  try {
    writeFileSync(sourcePath, source, 'utf8');
    return run(sourcePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function routeKey(route: ExtractedRoute): string {
  return `${route.method} ${route.path}`;
}

function manifestRouteForFixture(method: string, concretePath: string) {
  return legacyApiManifest.find((route) => {
    const pathPattern = route.path
      .split('/')
      .map((part) => part.startsWith(':') ? '[^/]+' : part)
      .join('/');
    return route.method === method && new RegExp(`^${pathPattern}$`).test(concretePath);
  });
}

describe('legacy Flask API manifest', () => {
  it('extracts Flask GET shortcut decorators', () => {
    withTemporaryPythonSource(`
@app.get('/api/future')
def future():
    pass
`, (sourcePath) => {
      expect(extractFlaskApiRoutes(sourcePath)).toEqual([
        { method: 'GET', path: '/api/future' },
      ]);
    });
  });

  it('extracts Flask POST shortcut decorators', () => {
    withTemporaryPythonSource(`
@app.post('/api/future')
def future():
    pass
`, (sourcePath) => {
      expect(extractFlaskApiRoutes(sourcePath)).toEqual([
        { method: 'POST', path: '/api/future' },
      ]);
    });
  });

  it('fails closed when a route path is not a literal string', () => {
    withTemporaryPythonSource(`
future_path = '/api/future'

@app.route(future_path)
def future():
    pass
`, (sourcePath) => {
      expect(() => extractFlaskApiRoutes(sourcePath)).toThrow(/literal string path/i);
    });
  });

  it('fails closed when route methods are computed', () => {
    withTemporaryPythonSource(`
future_methods = ['POST']

@app.route('/api/future', methods=future_methods)
def future():
    pass
`, (sourcePath) => {
      expect(() => extractFlaskApiRoutes(sourcePath)).toThrow(
        /literal list or tuple of literal strings/i,
      );
    });
  });

  it('extracts actual decorators with implicit GET, aliases, and canonical dynamic paths', () => {
    const routes = extractFlaskApiRoutes();

    expect(routes).toContainEqual({ method: 'GET', path: '/api/healthz' });
    expect(routes).toContainEqual({ method: 'GET', path: '/api/account/api-key' });
    expect(routes).toContainEqual({ method: 'POST', path: '/api/post' });
    expect(routes).toContainEqual({ method: 'GET', path: '/api/post/:pid' });
    expect(routes.some(({ method }) => method === 'HEAD' || method === 'OPTIONS')).toBe(false);
  });

  it('covers every explicit Flask /api route and method exactly once', () => {
    const extractedKeys = extractFlaskApiRoutes().map(routeKey).sort();
    const manifestKeys = legacyApiManifest.map(routeKey).sort();

    expect(new Set(manifestKeys).size).toBe(manifestKeys.length);
    expect(manifestKeys).toEqual(extractedKeys);
  });

  it('freezes method, authorization, request, response, and status metadata for every route', () => {
    for (const route of legacyApiManifest) {
      expect(route.method).toMatch(/^(GET|POST|DELETE)$/);
      expect(route.path).toMatch(/^\/api\//);
      expect(route.authorization.scheme).toMatch(/^(none|session|api-key)$/);
      expect(route.authorization.roles.length).toBeGreaterThan(0);
      expect(route.request).toEqual(expect.objectContaining({
        headers: expect.any(Array),
        path: expect.any(Array),
        query: expect.any(Array),
        json: expect.any(Array),
      }));
      expect(route.response.success).toEqual(expect.any(String));
      expect(Object.keys(route.response.statuses)).toContain(String(route.response.successStatus));
    }
  });

  it('freezes every exact manifest metadata value', () => {
    const digest = createHash('sha256').update(JSON.stringify(legacyApiManifest)).digest('hex');
    expect(digest).toBe('4ebbbf279b274309d3e2398e084f3bb9395b26a53a4f1a1821ed05c64b992f18');
  });

  it('loads the shared executable success, 401, 403, and 404 fixtures', () => {
    expect(legacyApiContractFixtures).toEqual(sharedLegacyApiFixtures);
    expect(legacyApiContractFixtures.map(({ response }) => response.status).sort()).toEqual([
      200, 401, 403, 404,
    ]);

    for (const fixture of legacyApiContractFixtures) {
      const route = manifestRouteForFixture(fixture.request.method, fixture.request.path);
      expect(route, fixture.name).toBeDefined();
      expect(route?.response.statuses, fixture.name).toHaveProperty(String(fixture.response.status));
    }

    const goodbai = legacyApiContractFixtures.find(({ name }) => name === 'goodbai-invalid-api-key');
    const goodbaiRoute = legacyApiManifest.find(
      ({ method, path }) => method === goodbai?.request.method && path === goodbai.request.path,
    );
    expect(goodbaiRoute?.authorization.scheme).toBe('api-key');
    expect(goodbaiRoute?.request.headers).toContain('X-API-Key');
    expect(goodbai?.request.headers).toHaveProperty('X-API-Key');
  });
});
