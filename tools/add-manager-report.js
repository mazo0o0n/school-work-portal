'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const reportsDataPath = path.join(projectRoot, 'assets', 'data', 'manager-reports.json');
const templatesDirectory = path.join(
  projectRoot,
  'assets',
  'report-templates',
  'manager-reports'
);

const optionNames = new Set([
  'file',
  'title',
  'category',
  'slug',
  'description',
  'status',
  'tags',
  'required-fields',
  'optional-fields',
  'notes'
]);

function printHelp(){
  console.log(`
إضافة تقرير جديد إلى مكتبة تقارير المدير

الاستخدام:
  node tools/add-manager-report.js --file "C:\\path\\report.docx" --title "اسم التقرير" --category "اللجان" --slug "committee-report"

الخيارات المطلوبة:
  --file             مسار ملف DOCX المصدر
  --title            اسم التقرير الظاهر
  --category         تصنيف التقرير
  --slug             معرّف إنجليزي آمن واسم الملف الجديد

الخيارات الاختيارية:
  --description      وصف التقرير
  --status           الحالة، والقيمة الافتراضية "تجريبي"
  --tags             وسوم مفصولة بفواصل
  --required-fields  حقول مطلوبة مفصولة بفواصل
  --optional-fields  حقول اختيارية مفصولة بفواصل
  --notes            ملاحظات داخلية
  --dry-run          معاينة العملية دون نسخ أو تعديل
  --help             عرض هذه المساعدة
`);
}

function parseArguments(argv){
  const options = {dryRun:false, help:false};
  for(let index = 0; index < argv.length; index += 1){
    const argument = argv[index];
    if(argument === '--dry-run'){
      options.dryRun = true;
      continue;
    }
    if(argument === '--help' || argument === '-h'){
      options.help = true;
      continue;
    }
    if(!argument.startsWith('--')) throw new Error(`خيار غير معروف: ${argument}`);

    const name = argument.slice(2);
    if(!optionNames.has(name)) throw new Error(`خيار غير معروف: --${name}`);
    const value = argv[index + 1];
    if(!value || value.startsWith('--')) throw new Error(`القيمة مطلوبة للخيار --${name}`);
    options[name] = value.trim();
    index += 1;
  }
  return options;
}

function parseList(value){
  return String(value || '')
    .split(',')
    .map(item=>item.trim())
    .filter(Boolean);
}

function readReports(){
  const parsed = JSON.parse(fs.readFileSync(reportsDataPath, 'utf8'));
  if(!Array.isArray(parsed)) throw new Error('ملف بيانات التقارير يجب أن يحتوي على مصفوفة.');
  return parsed;
}

function validateOptions(options){
  const missing = ['file', 'title', 'category', 'slug'].filter(name=>!options[name]);
  if(missing.length) throw new Error(`خيارات مطلوبة مفقودة: ${missing.map(name=>`--${name}`).join(', ')}`);

  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)){
    throw new Error('يجب أن يحتوي --slug على أحرف إنجليزية صغيرة وأرقام وشرطات فقط.');
  }

  const sourcePath = path.resolve(options.file);
  if(path.extname(sourcePath).toLowerCase() !== '.docx') throw new Error('الملف المصدر يجب أن يكون DOCX.');
  if(!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()){
    throw new Error(`ملف المصدر غير موجود: ${sourcePath}`);
  }
  const signature = Buffer.alloc(2);
  const sourceHandle = fs.openSync(sourcePath, 'r');
  try{
    fs.readSync(sourceHandle, signature, 0, signature.length, 0);
  }finally{
    fs.closeSync(sourceHandle);
  }
  if(signature[0] !== 0x50 || signature[1] !== 0x4b){
    throw new Error('الملف لا يحمل بنية DOCX صالحة (حاوية ZIP).');
  }
  return sourcePath;
}

function buildReport(options){
  const requiredFields = parseList(options['required-fields']);
  const optionalFields = parseList(options['optional-fields']);
  return {
    id:options.slug,
    title:options.title,
    description:options.description || '',
    category:options.category,
    status:options.status || 'تجريبي',
    sectionId:'managerReports',
    templatePath:`assets/report-templates/manager-reports/${options.slug}.docx`,
    outputFileName:`${options.title} - {{schoolDisplayName}}.docx`,
    tags:parseList(options.tags),
    fields:[...new Set([...requiredFields, ...optionalFields])],
    requiredFields,
    optionalFields,
    customFields:[],
    notes:options.notes || ''
  };
}

function main(){
  const options = parseArguments(process.argv.slice(2));
  if(options.help){
    printHelp();
    return;
  }

  const sourcePath = validateOptions(options);
  const reports = readReports();
  const report = buildReport(options);
  const destinationPath = path.join(templatesDirectory, `${options.slug}.docx`);

  if(reports.some(item=>item.id === report.id)) throw new Error(`معرّف التقرير مستخدم مسبقًا: ${report.id}`);
  if(reports.some(item=>item.templatePath === report.templatePath)){
    throw new Error(`مسار القالب مستخدم مسبقًا: ${report.templatePath}`);
  }
  if(fs.existsSync(destinationPath)) throw new Error(`ملف القالب الهدف موجود مسبقًا: ${destinationPath}`);

  console.log(`المصدر: ${sourcePath}`);
  console.log(`القالب الجديد: ${destinationPath}`);
  console.log(`معرّف التقرير: ${report.id}`);
  console.log(`اسم التقرير: ${report.title}`);
  console.log(`التصنيف: ${report.category}`);

  if(options.dryRun){
    console.log('DRY_RUN=true — لم تُنسخ ملفات ولم يتغير ملف البيانات.');
    return;
  }

  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  reports.push(report);
  fs.writeFileSync(reportsDataPath, `${JSON.stringify(reports, null, 2)}\n`, 'utf8');
  console.log('تمت إضافة التقرير محليًا. شغّل أداة الفحص قبل المراجعة والنشر.');
}

try{
  main();
}catch(error){
  console.error(`خطأ: ${error.message}`);
  process.exitCode = 1;
}
