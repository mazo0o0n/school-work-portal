import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assistantPath = path.join(rootDir, 'assets', 'js', 'ai-assistant.js');
const indexPath = path.join(rootDir, 'index.html');

function read(filePath){
  return fs.readFileSync(filePath, 'utf8');
}

test('keeps personal contact routes out of first-party public files', () => {
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf8'
  }).split('\0').filter(Boolean);
  const publicFiles = trackedFiles.filter((file) =>
    file.endsWith('.html') ||
    file.startsWith('assets/js/') && file.endsWith('.js')
  ).filter((file) => !file.startsWith('assets/vendor/'));
  const personalPhone = /(?<!\d)(?:(?:\+|00)?966[\s-]?|0)?5(?:[\s-]?\d){8}(?!\d)/;
  const personalMessagingLink =
    /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i;

  for(const file of publicFiles){
    const content = read(path.join(rootDir, file));
    assert.doesNotMatch(content, personalPhone, `${file} contains a personal phone value`);
    assert.doesNotMatch(
      content,
      personalMessagingLink,
      `${file} contains a personal messaging link`
    );
  }
});

test('keeps assistant DOM references aligned with index.html', () => {
  const assistantSource = read(assistantPath);
  const indexSource = read(indexPath);
  const referencedIds = [...assistantSource.matchAll(
    /document\.getElementById\(['"]([^'"]+)['"]\)/g
  )].map((match) => match[1]);
  const existingIds = new Set(
    [...indexSource.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1])
  );

  assert.ok(referencedIds.length > 0);
  assert.deepEqual(
    referencedIds.filter((id) => !existingIds.has(id)),
    []
  );
});

test('keeps session storage while removing the obsolete local review flow', () => {
  const assistantSource = read(assistantPath);

  assert.match(assistantSource, /\bsessionStorage\.(?:getItem|setItem|removeItem)\(/);
  assert.doesNotMatch(assistantSource, /\blocalStorage\./);
  assert.doesNotMatch(assistantSource, /ai(?:Review|SendQuestions|ExportQuestions)/);
});
