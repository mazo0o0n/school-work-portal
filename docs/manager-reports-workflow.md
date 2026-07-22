# سير عمل إضافة تقارير المدير

هذا المسار مخصص لإدارة مكتبة تقارير المدير محليًا بطريقة منظمة. لا يرفع التقارير إلى الموقع ولا ينفذ `commit` أو `push` أو `deploy` تلقائيًا.

## مواقع الملفات

- بيانات المكتبة: `assets/data/manager-reports.json`
- قوالب Word: `assets/report-templates/manager-reports/`
- أداة الإضافة: `tools/add-manager-report.js`
- أداة الفحص: `tools/check-manager-reports.js`

لا تعدّل قالبًا منشورًا لمجرد إضافة تقرير جديد. استخدم ملف DOCX مستقلًا واسم `slug` إنجليزيًا واضحًا وفريدًا.

## معاينة إضافة تقرير

ابدأ دائمًا بـ `--dry-run` حتى تتأكد من اسم الملف والمسار والبيانات قبل الكتابة:

```powershell
node tools/add-manager-report.js --dry-run --file "C:\path\report.docx" --title "اسم التقرير" --category "اللجان" --slug "committee-report"
```

يعرض الأمر ما سيفعله فقط، ولا ينسخ القالب ولا يعدّل ملف JSON.

لعرض جميع الخيارات:

```powershell
node tools/add-manager-report.js --help
```

يمكن تمرير بيانات اختيارية مثل:

```powershell
node tools/add-manager-report.js --file "C:\path\report.docx" --title "اسم التقرير" --category "اللجان" --slug "committee-report" --description "وصف مختصر" --status "تجريبي" --tags "لجنة,متابعة" --optional-fields "educationDepartment,schoolDisplayName,principalName"
```

عند التنفيذ الفعلي تنسخ الأداة القالب إلى مجلد تقارير المدير وتضيف سجلًا جديدًا إلى ملف البيانات. تمنع الأداة تكرار `id` أو `templatePath` أو الكتابة فوق قالب موجود.

## فحص مكتبة التقارير

شغّل:

```powershell
node tools/check-manager-reports.js
```

يتحقق الفحص من الحقول الأساسية، وامتداد DOCX، ووجود كل قالب، وعدم تكرار المعرّفات أو مسارات القوالب. يعيد رمز خروج غير صفري عند وجود مشكلة.

## فحوص ما قبل النشر

بعد إضافة التقرير وقبل أي مراجعة للنشر شغّل:

```powershell
node --check assets/js/report-word-generator.js
node --check tools/add-manager-report.js
node --check tools/check-manager-reports.js
node tools/check-manager-reports.js
node tools/check-links.js
npm run qa
git --no-pager diff --check
git status --short
```

اختبر يدويًا ظهور التقرير والبحث والتصفية والتخصيص وتنزيل Word على سطح المكتب والجوال. لا تظهر الإضافة في الإنتاج إلا بعد مراجعة الملفات ثم تنفيذ خطوات `commit` و`push` و`deploy` المصرح بها بصورة منفصلة.

## ملاحظة عن إتاحة القوالب

قوالب DOCX داخل `assets/report-templates/manager-reports/` أصول عامة لمن يعرف رابطها، وهذا هو السلوك الحالي للمشروع. يجب ألا تحتوي القوالب على أسرار أو بيانات شخصية ثابتة.

نظام رفع وإدارة التقارير من لوحة الإدارة باستخدام R2 أو D1 مؤجل إلى مرحلة SaaS، وليس جزءًا من سير العمل المحلي الحالي.
