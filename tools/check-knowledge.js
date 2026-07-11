const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function runNodeCommand(label, scriptPath, args = []){
  console.log(`\n[فحص المعرفة] ${label}`);

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  if(result.error){
    console.error(`\nفشل ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if(result.status !== 0){
    console.error(`\nفشل ${label} برمز خروج ${result.status ?? 'غير معروف'}. تم إيقاف الفحص.`);
    process.exit(result.status || 1);
  }
}

runNodeCommand(
  'تحديث عداد المعرفة...',
  path.join(projectRoot, 'tools', 'update-knowledge-stats.js')
);

runNodeCommand(
  'تشغيل معاينة المعرفة...',
  path.join(projectRoot, 'tools', 'ingest-knowledge.js'),
  ['--preview']
);

console.log('\nتم تحديث عداد المعرفة وتشغيل المعاينة بنجاح.');
console.log('راجع نتائج preview قبل رفع المعرفة إلى Vectorize.');
