import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readProjectFile(relativePath){
  return readFile(new globalThis.URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('keeps package metadata on the published version', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const packageLock = JSON.parse(await readProjectFile('package-lock.json'));
  const publishedVersion = packageJson.version;

  assert.equal(packageLock.version, publishedVersion);
  assert.equal(packageLock.packages[''].version, publishedVersion);
});

test('matches package metadata to the latest release tag', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const latestTag = execFileSync(
    'git',
    ['describe', '--tags', '--abbrev=0'],
    { encoding: 'utf8' }
  ).trim();

  assert.equal(latestTag, `v${packageJson.version}`);
});

test('documents the current version as published', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const publishedVersion = packageJson.version;
  const files = [
    'index.html',
    'updates.html',
    'README.md',
    'docs/version-history.md',
    'docs/project-status.md',
    'docs/developer-notes.md',
    'docs/release-checklist.md'
  ];

  for(const file of files){
    const content = await readProjectFile(file);
    assert.match(content, new RegExp(`v${publishedVersion.replaceAll('.', '\\.')}`));
    assert.doesNotMatch(content, /قيد التجهيز|غير منشور/);
  }
});
