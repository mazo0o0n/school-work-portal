import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const targetVersion = '1.5.1';
const publishedVersion = '1.5.0';

async function readProjectFile(relativePath){
  return readFile(new globalThis.URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('keeps package metadata on the local target version', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const packageLock = JSON.parse(await readProjectFile('package-lock.json'));

  assert.equal(packageJson.version, targetVersion);
  assert.equal(packageLock.version, targetVersion);
  assert.equal(packageLock.packages[''].version, targetVersion);
});

test('distinguishes the local target from the published version', async () => {
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
    assert.match(content, new RegExp(`v${targetVersion.replaceAll('.', '\\.')}`));
    assert.match(content, new RegExp(`v${publishedVersion.replaceAll('.', '\\.')}`));
  }
});
