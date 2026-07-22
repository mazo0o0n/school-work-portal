'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const reportsDataPath = path.join(projectRoot, 'assets', 'data', 'manager-reports.json');
const requiredProperties = ['id', 'title', 'category', 'templatePath'];

function addDuplicateIssues(reports, property, issues){
  const seen = new Set();
  reports.forEach((report, index)=>{
    const value = String(report[property] || '').trim();
    if(!value) return;
    if(seen.has(value)){
      issues.push(`القيمة مكررة في ${property}: ${value} (السجل ${index + 1})`);
    }
    seen.add(value);
  });
}

function main(){
  const issues = [];
  if(!fs.existsSync(reportsDataPath)){
    throw new Error(`ملف بيانات التقارير غير موجود: ${reportsDataPath}`);
  }

  let reports;
  try{
    reports = JSON.parse(fs.readFileSync(reportsDataPath, 'utf8'));
  }catch(error){
    throw new Error(`تعذر قراءة JSON: ${error.message}`, {cause:error});
  }
  if(!Array.isArray(reports)) throw new Error('يجب أن يحتوي ملف البيانات على مصفوفة تقارير.');

  reports.forEach((report, index)=>{
    requiredProperties.forEach(property=>{
      if(!String(report[property] || '').trim()){
        issues.push(`السجل ${index + 1} لا يحتوي على ${property}.`);
      }
    });

    const templatePath = String(report.templatePath || '').trim();
    if(!templatePath) return;
    if(path.extname(templatePath).toLowerCase() !== '.docx'){
      issues.push(`قالب التقرير ${report.id || index + 1} ليس ملف DOCX: ${templatePath}`);
      return;
    }
    const absoluteTemplatePath = path.resolve(projectRoot, templatePath);
    if(!fs.existsSync(absoluteTemplatePath) || !fs.statSync(absoluteTemplatePath).isFile()){
      issues.push(`قالب مفقود للتقرير ${report.id || index + 1}: ${templatePath}`);
    }
  });

  addDuplicateIssues(reports, 'id', issues);
  addDuplicateIssues(reports, 'templatePath', issues);

  const categories = [...new Set(reports.map(report=>String(report.category || '').trim()).filter(Boolean))];
  console.log(`عدد التقارير: ${reports.length}`);
  console.log(`التصنيفات (${categories.length}): ${categories.join('، ') || 'لا يوجد'}`);

  if(issues.length){
    console.error(`تم العثور على ${issues.length} مشكلة:`);
    issues.forEach(issue=>console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }

  console.log('جميع بيانات التقارير والقوالب المرتبطة بها سليمة.');
}

try{
  main();
}catch(error){
  console.error(`خطأ: ${error.message}`);
  process.exitCode = 1;
}
