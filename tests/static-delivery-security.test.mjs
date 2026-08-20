import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsIgnorePath = path.join(projectRoot, '.assetsignore');

const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

function getAssetIgnoreDecision(relativePath) {
  const result = spawnSync(
    'git',
    [
      '-c',
      `core.excludesFile=${assetsIgnorePath}`,
      'check-ignore',
      '--no-index',
      '--verbose',
      '--',
      relativePath,
    ],
    { cwd: projectRoot, encoding: 'utf8', windowsHide: true },
  );

  assert.ifError(result.error);
  const output = result.stdout.trim();
  if (!output) return { excluded: false, pattern: null };

  const descriptor = output.split(/\r?\n/).at(-1).split('\t')[0];
  const match = descriptor.match(/:\d+:([^\t]+)$/);
  assert.ok(match, `Unable to parse gitignore decision for ${relativePath}: ${descriptor}`);

  return {
    excluded: !match[1].startsWith('!'),
    pattern: match[1],
  };
}

function parseHeaderRules(source) {
  const rules = [];
  let currentRule = null;

  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;

    if (!/^\s/.test(rawLine)) {
      currentRule = { pattern: rawLine.trim(), operations: [] };
      rules.push(currentRule);
      continue;
    }

    assert.ok(currentRule, `Header operation found before a route: ${rawLine}`);
    const operation = rawLine.trim();
    if (operation.startsWith('! ')) {
      currentRule.operations.push({ type: 'remove', name: operation.slice(2).toLowerCase() });
      continue;
    }

    const separator = operation.indexOf(':');
    assert.ok(separator > 0, `Invalid header operation: ${operation}`);
    currentRule.operations.push({
      type: 'add',
      name: operation.slice(0, separator).toLowerCase(),
      value: operation.slice(separator + 1).trim(),
    });
  }

  return rules;
}

function routeMatches(pattern, requestPath) {
  if (pattern === '/*') return true;
  if (pattern.endsWith('/*')) return requestPath.startsWith(pattern.slice(0, -1));
  return pattern === requestPath;
}

function getEffectiveHeaders(rules, requestPath) {
  const headers = new Map();

  for (const rule of rules.filter(({ pattern }) => routeMatches(pattern, requestPath))) {
    for (const operation of rule.operations) {
      if (operation.type === 'remove') {
        headers.delete(operation.name);
      } else {
        headers.set(operation.name, [...(headers.get(operation.name) ?? []), operation.value]);
      }
    }
  }

  return headers;
}

function parseCsp(value) {
  const directives = new Map();
  for (const part of value.split(';').map((item) => item.trim()).filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/);
    assert.ok(!directives.has(name), `Duplicate CSP directive: ${name}`);
    directives.set(name, sources);
  }
  return directives;
}

test('development metadata is excluded while critical runtime assets remain publishable', () => {
  const excludedFiles = [
    '.assetsignore',
    '.gitignore',
    '.stylelintrc.json',
    'eslint.config.cjs',
    'package.json',
    'package-lock.json',
    'playwright.config.cjs',
    'src/index.js',
    'tests/static-delivery-security.test.mjs',
    'tools/check-links.js',
  ];
  const runtimeFiles = [
    '_headers',
    'index.html',
    'register.html',
    'robots.txt',
    'sitemap.xml',
    'assets/js/index.js',
    'assets/css/index.css',
    'assets/images/favicon-32x32.png',
    'assets/data/manager-reports.json',
    'assets/report-templates/manager-reports/meeting-template-test.docx',
  ];

  for (const file of excludedFiles) {
    assert.equal(getAssetIgnoreDecision(file).excluded, true, `${file} must be excluded`);
  }
  for (const file of runtimeFiles) {
    assert.equal(getAssetIgnoreDecision(file).excluded, false, `${file} must remain publishable`);
  }
});

test('CSP is unique, restrictive, and retains only proven runtime origins', async () => {
  const source = await readProjectFile('_headers');
  const rules = parseHeaderRules(source);
  const representativePaths = [
    '/index.html',
    '/register',
    '/login',
    '/privacy',
    '/admin-schools',
    '/1',
    '/3',
  ];

  for (const requestPath of representativePaths) {
    const values = getEffectiveHeaders(rules, requestPath).get('content-security-policy') ?? [];
    assert.equal(values.length, 1, `${requestPath} must have one effective CSP`);
    const directives = parseCsp(values[0]);

    assert.deepEqual(directives.get('object-src'), ["'none'"]);
    assert.deepEqual(directives.get('base-uri'), ["'self'"]);
    assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(directives.get('frame-src'), ["'none'"]);
    assert.deepEqual(directives.get('form-action'), ["'self'"]);
    assert.ok(directives.get('style-src').includes('https://fonts.googleapis.com'));
    assert.ok(directives.get('font-src').includes('https://fonts.gstatic.com'));
    assert.ok(directives.get('img-src').includes("'self'"));
    assert.ok(directives.get('connect-src').includes("'self'"));
  }

  const mainCsp = getEffectiveHeaders(rules, '/index.html').get('content-security-policy')[0];
  const mainDirectives = parseCsp(mainCsp);
  assert.ok(!mainDirectives.get('script-src').includes("'unsafe-eval'"));
  assert.deepEqual(mainDirectives.get('connect-src'), ["'self'"]);
  assert.deepEqual(mainDirectives.get('frame-src'), ["'none'"]);
  assert.ok(!mainDirectives.get('img-src').includes('https:'));
  assert.doesNotMatch(mainCsp, /firebaseapp|firebasestorage|www\.gstatic/);

  const reportCsp = getEffectiveHeaders(rules, '/1').get('content-security-policy')[0];
  assert.match(reportCsp, /script-src[^;]*'unsafe-eval'[^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(reportCsp, /worker-src 'self' blob:/);

  const analysisCsp = getEffectiveHeaders(rules, '/3').get('content-security-policy')[0];
  assert.match(analysisCsp, /script-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(analysisCsp, /unsafe-eval/);
  assert.doesNotMatch(source, /Content-Type:|Location:/i);
});

test('cache rules are conservative, non-conflicting, and never immutable', async () => {
  const source = await readProjectFile('_headers');
  const rules = parseHeaderRules(source);
  const expectedPolicies = new Map([
    ['/assets/js/index.js', 'public, max-age=3600, must-revalidate'],
    ['/assets/css/index.css', 'public, max-age=3600, must-revalidate'],
    ['/assets/images/site-logo-mark.webp', 'public, max-age=604800, must-revalidate'],
    ['/assets/knowledge-images/example.png', 'public, max-age=604800, must-revalidate'],
    ['/assets/vendor/docxtemplater-3.69.0.js', 'public, max-age=86400, must-revalidate'],
    ['/assets/data/manager-reports.json', 'public, max-age=300, must-revalidate'],
    ['/assets/report-templates/manager-reports/meeting-template-test.docx', 'public, max-age=3600, must-revalidate'],
    ['/favicon.ico', 'public, max-age=604800, must-revalidate'],
    ['/sitemap.xml', 'public, max-age=300, must-revalidate'],
    ['/robots.txt', 'public, max-age=300, must-revalidate'],
  ]);

  for (const [requestPath, expected] of expectedPolicies) {
    const values = getEffectiveHeaders(rules, requestPath).get('cache-control') ?? [];
    assert.deepEqual(values, [expected], `${requestPath} must have one safe cache policy`);
  }

  assert.equal(getEffectiveHeaders(rules, '/index.html').has('cache-control'), false);
  assert.equal(getEffectiveHeaders(rules, '/privacy').has('cache-control'), false);
  assert.deepEqual(
    getEffectiveHeaders(rules, '/admin-schools').get('cache-control'),
    ['no-store, no-cache, must-revalidate'],
  );
  const cachePolicies = rules
    .flatMap(({ operations }) => operations)
    .filter(({ type, name }) => type === 'add' && name === 'cache-control')
    .map(({ value }) => value)
    .join('\n');
  assert.doesNotMatch(cachePolicies, /immutable|max-age=31536000/i);
});

test('header configuration stays within Cloudflare limits and avoids duplicate effective values', async () => {
  const source = await readProjectFile('_headers');
  const rules = parseHeaderRules(source);

  assert.ok(rules.length <= 100);
  for (const line of source.split(/\r?\n/)) assert.ok(line.length <= 2000);

  for (const requestPath of [
    '/index.html',
    '/admin-schools',
    '/assets/js/index.js',
    '/assets/data/knowledge-stats.json',
    '/1',
    '/3',
  ]) {
    for (const [name, values] of getEffectiveHeaders(rules, requestPath)) {
      assert.equal(values.length, 1, `${requestPath} has conflicting ${name} values`);
    }
  }
});
