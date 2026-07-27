const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const failures = [];

function report(ok, label, detail = ''){
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${suffix}`);
  if(!ok) failures.push(label);
}

function projectPath(relativePath){
  return path.join(projectRoot, ...relativePath.split('/'));
}

const requiredFiles = [
  'index.html',
  'register.html',
  'admin-schools.html',
  'package.json',
  '.assetsignore',
  'assets/js/admin-schools.js',
  'assets/data/manager-reports.json',
  'tools/check-links.js',
  'tools/check-manager-reports.js'
];

for(const relativePath of requiredFiles){
  report(existsSync(projectPath(relativePath)), `وجود ${relativePath}`);
}

const packageJson = JSON.parse(readFileSync(projectPath('package.json'), 'utf8'));
const syntaxCommand = String(packageJson.scripts?.['check:syntax'] || '');
const syntaxPaths = [...syntaxCommand.matchAll(/node --check\s+([^\s&]+)/g)]
  .map((match) => match[1].replace(/^['"]|['"]$/g, ''));
const missingSyntaxPaths = syntaxPaths.filter((relativePath) => !existsSync(projectPath(relativePath)));
report(
  syntaxPaths.length > 0 && missingSyntaxPaths.length === 0,
  'مراجع check:syntax',
  missingSyntaxPaths.length ? `ملفات مفقودة: ${missingSyntaxPaths.join(', ')}` : `${syntaxPaths.length} ملفًا موجودًا`
);

const assetsIgnore = readFileSync(projectPath('.assetsignore'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const requiredIgnoreRules = [
  '/tools/',
  '/docs/',
  '/tests/',
  '/src/',
  '/migrations/',
  '/package.json'
];
const missingIgnoreRules = requiredIgnoreRules.filter((rule) => !assetsIgnore.includes(rule));
report(
  missingIgnoreRules.length === 0,
  'حجب الملفات الداخلية في .assetsignore',
  missingIgnoreRules.length ? `قواعد مفقودة: ${missingIgnoreRules.join(', ')}` : 'القواعد الأساسية موجودة'
);

for(const scriptPath of ['tools/check-links.js', 'tools/check-manager-reports.js']){
  const result = spawnSync(process.execPath, [projectPath(scriptPath)], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  const detail = result.status === 0
    ? 'اكتمل دون أخطاء'
    : String(result.stderr || result.stdout || `exit ${result.status}`).trim().split(/\r?\n/).at(-1);
  report(result.status === 0, `تشغيل ${scriptPath}`, detail);
}

if(failures.length){
  console.error(`فشل فحص الجاهزية في ${failures.length} بند.`);
  process.exitCode = 1;
}else{
  console.log('Project readiness checks passed.');
}
