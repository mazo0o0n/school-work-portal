import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const ORIGIN = 'https://mazen.zb-store.com';
const canonicalPages = new Map([
  ['index.html', '/'],
  ['register.html', '/register'],
  ['login.html', '/login'],
  ['about.html', '/about'],
  ['guide.html', '/guide'],
  ['how-to-use.html', '/how-to-use'],
  ['privacy.html', '/privacy'],
  ['usage-policy.html', '/usage-policy'],
  ['updates.html', '/updates'],
  ['feedback.html', '/feedback'],
  ['sitemap.html', '/sitemap'],
  ['1.html', '/1'],
  ['2.html', '/2'],
  ['3.html', '/3'],
]);
const sitemapPages = new Map([...canonicalPages].filter(([file]) => file !== 'login.html'));

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const countMatches = (value, pattern) => [...value.matchAll(pattern)].length;

test('public pages use one clean, absolute production canonical', async () => {
  for (const [file, path] of canonicalPages) {
    const html = await readProjectFile(file);
    const canonicals = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)];

    assert.equal(canonicals.length, 1, `${file} must contain exactly one canonical`);
    assert.equal(canonicals[0][1], `${ORIGIN}${path}`);
    assert.doesNotMatch(canonicals[0][1], /\.html(?:$|[?#])/);
  }
});

test('sitemap contains unique clean public URLs only', async () => {
  const xml = await readProjectFile('sitemap.xml');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const expected = [...sitemapPages.values()].map((path) => `${ORIGIN}${path}`);

  assert.deepEqual(urls, expected);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every((url) => url.startsWith(`${ORIGIN}/`)));
  assert.ok(urls.every((url) => !url.includes('.html')));
  assert.ok(urls.every((url) => !/(?:admin|assistant-status|assistant-test|knowledge-status)/.test(url)));
  assert.ok(!urls.includes(`${ORIGIN}/login`));
  assert.ok(!urls.includes(`${ORIGIN}/10`));
  assert.doesNotMatch(xml, /<lastmod>/);
});

test('login page keeps its clean canonical while remaining noindex', async () => {
  const html = await readProjectFile('login.html');

  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, new RegExp(`<link\\s+rel="canonical"\\s+href="${ORIGIN}/login">`));
});

test('robots rules do not block intended public clean paths', async () => {
  const robots = await readProjectFile('robots.txt');
  const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gim)].map((match) => match[1]);

  for (const path of [...sitemapPages.values()].filter((value) => value !== '/')) {
    assert.ok(!disallowed.some((rule) => path.startsWith(rule)), `${path} is blocked by ${disallowed.join(', ')}`);
  }
});

test('privacy text distinguishes browser storage from server-side processing', async () => {
  const html = await readProjectFile('privacy.html');

  assert.doesNotMatch(html, /تبقى بيانات المدرسة المسجلة محليًا في جهاز المستخدم ولا ترسلها واجهة التسجيل/);
  assert.match(html, /التخزين المحلي وتخزين الجلسة في المتصفح/);
  assert.match(html, /المعالجة والتخزين على الخادم/);
  assert.match(html, /تسجيل المدرسة وبيانات التواصل/);
  assert.match(html, /إلى خوادم المنصة لمعالجة الطلب وحفظه/);
  assert.doesNotMatch(html, /نلتزم|امتثال|مشفرة|لا نشارك مطلقًا|جميع البيانات.*محلي/);
});

test('registration required fields have visible markers without marking optional contact name', async () => {
  const html = await readProjectFile('register.html');
  const requiredIds = [
    'schoolName',
    'schoolStage',
    'educationDepartment',
    'registrationContactPhone',
    'registrationConsent',
  ];

  for (const id of requiredIds) {
    assert.match(html, new RegExp(`<[^>]+id="${id}"[^>]+required`), `${id} must remain required`);
    const labelPattern = id === 'registrationConsent'
      ? /<label[^>]+for="registrationConsent"[\s\S]*?<span class="required-label" aria-label="مطلوب">\*<\/span>[\s\S]*?<\/label>/
      : new RegExp(`<label[^>]+for="${id}"[^>]*>[\\s\\S]*?<span class="required-label" aria-label="مطلوب">\\*<\\/span>[\\s\\S]*?<\\/label>`);
    assert.match(html, labelPattern, `${id} must have one visible required marker`);
  }

  const contactNameLabel = html.match(/<label[^>]+for="registrationContactName"[^>]*>([\s\S]*?)<\/label>/)?.[1] ?? '';
  assert.match(contactNameLabel, /اختياري/);
  assert.doesNotMatch(contactNameLabel, /required-label/);
  assert.doesNotMatch(html, /required-label[^>]*>\*\*<\/span>/);
  assert.match(html, /<html lang="ar" dir="rtl">/);
});

test('grade analysis required inputs retain their existing visible indicators', async () => {
  const html = await readProjectFile('3.html');
  const requiredIds = ['inEdu', 'inSchool', 'inPrincipal', 'inTeacher', 'inSubject', 'inStage', 'file'];

  for (const id of requiredIds) {
    assert.match(
      html,
      new RegExp(`<label[^>]+for="${id}"[^>]*>[\\s\\S]*?<span class="req">\\*<\\/span>[\\s\\S]*?<\\/label>`),
    );
  }
});

test('report image upload keeps four inputs and constraints with guidance shown once', async () => {
  const html = await readProjectFile('1.html');
  const gallery = html.match(/<div class="gallery" id="gallery">([\s\S]*?)<\/div>\s*<!-- التواقيع -->/)?.[1];

  assert.ok(gallery, 'gallery markup must exist');
  assert.equal(countMatches(gallery, /<input type="file" accept="image\/\*,\.heic,\.heif"/g), 4);
  assert.equal(countMatches(gallery, /class="hint"/g), 4);
  assert.equal(countMatches(gallery, /JPG \/ JPEG/g), 1);
  assert.equal(countMatches(gallery, /<strong>10MB<\/strong>/g), 1);
  assert.match(html, /const MAX_IMAGE_SIZE_MB = 10;/);
  assert.match(html, /if\(!checkImageSizeLimit\(rawFile\)\) return;/);
  assert.doesNotMatch(gallery, /undefined|null/i);
  assert.match(html, /<html lang="ar" dir="rtl">/);
});
