'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const requestedFiles = process.argv.slice(2);
const htmlFiles = requestedFiles.length
  ? requestedFiles.map((file) => path.resolve(rootDir, file))
  : fs.readdirSync(rootDir)
      .filter((file) => file.toLowerCase().endsWith('.html'))
      .map((file) => path.join(rootDir, file));

const issues = [];
let linksChecked = 0;

function report(file, type, href, detail) {
  issues.push({
    file: path.relative(rootDir, file),
    type,
    href,
    detail
  });
}

function getAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? match[2].trim() : '';
}

function isExternal(href) {
  return /^https?:\/\//i.test(href);
}

function localTargetExists(file, href) {
  const cleanHref = href.split('#')[0].split('?')[0];
  if (!cleanHref) return true;

  let decodedHref;
  try {
    decodedHref = decodeURIComponent(cleanHref);
  } catch (_) {
    return false;
  }

  const target = path.resolve(path.dirname(file), decodedHref);
  return fs.existsSync(target);
}

for (const file of htmlFiles) {
  if (!fs.existsSync(file)) {
    report(file, 'missing-html-file', '', 'ملف HTML المحدد غير موجود.');
    continue;
  }

  const html = fs.readFileSync(file, 'utf8');
  const anchorPattern = /<a\b([^>]*?)>/gi;
  let match;

  while ((match = anchorPattern.exec(html))) {
    const attributes = match[1];
    const href = getAttribute(attributes, 'href');
    linksChecked += 1;

    if (attributes.includes('${') || attributes.includes("'+") || attributes.includes('"+')) continue;

    if (!href) {
      report(file, 'empty-href', '', 'رابط بدون href صالح.');
      continue;
    }

    if (href === '#') {
      const disabled = getAttribute(attributes, 'aria-disabled') === 'true';
      report(
        file,
        disabled ? 'disabled-placeholder' : 'placeholder-href',
        href,
        disabled
          ? 'رابط مؤجل معطل بوضوح.'
          : 'رابط وهمي يحتاج تعطيلًا واضحًا أو وجهة فعلية.'
      );
      continue;
    }

    if (isExternal(href)) {
      const target = getAttribute(attributes, 'target');
      const rel = getAttribute(attributes, 'rel').toLowerCase().split(/\s+/);
      if (target !== '_blank' || !rel.includes('noopener') || !rel.includes('noreferrer')) {
        report(file, 'unsafe-external-link', href, 'الرابط الخارجي يحتاج target="_blank" وrel="noopener noreferrer".');
      }
      continue;
    }

    if (/^(mailto:|tel:|data:|javascript:)/i.test(href) || href.startsWith('#')) continue;

    if (!localTargetExists(file, href)) {
      report(file, 'missing-local-target', href, 'الملف أو المسار الداخلي غير موجود.');
    }
  }
}

console.log(`تم فحص ${htmlFiles.length} ملف HTML و${linksChecked} رابطًا.`);

if (!issues.length) {
  console.log('لم تُكتشف مشكلات روابط ضمن الفحص المحلي.');
} else {
  console.log(`تم اكتشاف ${issues.length} ملاحظة:`);
  issues.forEach((issue) => {
    console.log(`- [${issue.type}] ${issue.file}: ${issue.href || '(فارغ)'} — ${issue.detail}`);
  });
}

process.exitCode = issues.some((issue) => issue.type === 'missing-html-file') ? 1 : 0;
