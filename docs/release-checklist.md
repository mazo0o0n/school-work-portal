# قائمة فحص الإصدار

## قبل التعديل

- حدّد الملفات المسموحة ولا تفحص المشروع كاملًا.
- راجع حالة العمل دون لمس تغييرات المستخدم:

```powershell
git status --short
git --no-pager diff --name-only
```

## بعد التعديل

```powershell
git diff --check
git --no-pager diff --name-only
```

- شغّل فحوص syntax المرتبطة بالملفات المعدلة فقط.
- راجع الصفحة على الجوال وسطح المكتب عند تعديل الواجهة.

## قبل commit

```powershell
git status --short
git diff --check
git diff --cached --name-only
```

- ممنوع `git add .`.
- استخدم `git add path/to/file` للمسارات المقصودة فقط.
- لا تنفذ commit دون موافقة صريحة.

## قبل push

- راجع أسماء الملفات داخل آخر commit.
- تأكد من عدم وجود أسرار أو ملفات مؤقتة أو extracted.
- لا تنفذ push دون موافقة صريحة.

## بعد push

- تحقق من الفرع والـ commit المنشورين.
- راقب فحوص CI إن وجدت.
- لا تنفذ deploy تلقائيًا.

## عند تعديل المعرفة

```powershell
node tools/check-knowledge.js
```

- طابق عدد preview chunks مع vectors قبل أي upsert.
- لا تشغّل upload أو Vectorize upsert إلا بطلب صريح.

## قبل أي تحديث معرفة كبير

1. شغّل `node tools/check-knowledge.js`.
2. اقرأ عداد الأسئلة والإجابات.
3. اقرأ عدد Preview chunks وسجله.
4. بعد الموافقة، شغّل `node tools/ingest-knowledge.js --export-vectors`.
5. تحقق من عدد أسطر `tmp/knowledge-vectors.ndjson` ومطابقته للمقاطع.
6. إذا كان `CLOUDFLARE_API_TOKEN` الحالي مخصصًا لـWorkers AI ولا يملك صلاحية Vectorize، أزله من جلسة الطرفية فقط دون طباعته، ثم استخدم جلسة Wrangler المصرح بها.
7. بعد موافقة صريحة فقط، نفّذ `npx wrangler@latest vectorize upsert school_knowledge_index --file ".\tmp\knowledge-vectors.ndjson" --batch-size 500`.
8. اختبر الموقع والأسئلة المستهدفة.
9. استخدم `git add` للملفات المحددة فقط، ولا تستخدم `git add .`.
10. نفّذ commit وpush بعد نجاح الاختبار والموافقة فقط.

> تحذير: لا تضف `knowledge-import` إلى Git؛ فهو مصدر خام مؤقت وليس معرفة معتمدة.

## عند تعديل المساعد

```powershell
node --check assets/js/ai-assistant.js
node --check assets/js/assistant-test.js
```

- اختبر الإرسال، Enter، chips، الاستعادة، المسح، التحميل، والجوال.

## عند تعديل SEO

- راجع title وdescription وcanonical وOpen Graph.
- تحقق أن الصفحات العامة فقط موجودة في sitemap.
- تحقق أن الصفحات الداخلية تحمل noindex أو محجوبة في robots حسب الحاجة.

## فحص الجوال

- اختبر 390×844 وعدم وجود تمرير أفقي.
- اختبر مناطق اللمس، لوحة المفاتيح، RTL، والوضعين الداكن والفاتح.

## فحص الأمان

```powershell
git --no-pager grep -I -l -E "API_KEY|apiKey|TOKEN|token|SECRET|secret|PASSWORD|password|PRIVATE KEY|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|ADMIN_API_TOKEN|BOT_TOKEN|\.env"
git --no-pager ls-files | Select-String -Pattern "\.env|\.wrangler|knowledge-files/extracted|\.key|\.pem|id_rsa|secret|token"
```

راجع أسماء الملفات الناتجة دون طباعة محتوى حساس. كل نتيجة غير مؤكدة تحتاج تحققًا.
