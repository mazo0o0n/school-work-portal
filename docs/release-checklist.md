# قائمة فحص ما قبل الإصدار

تُراجع هذه القائمة قبل أي `push` أو `deploy`. لا تنفّذ أوامر الرفع أو النشر دون موافقة صريحة.

## 1. حالة Git

```powershell
git status --short
git diff --check
git diff --cached --name-only
```

## 2. البحث عن مؤشرات الأسرار

يعرض الأمر أسماء الملفات المطابقة فقط. راجع النتائج دون طباعة محتوى الأسرار:

```powershell
git --no-pager grep -I -l -E "API_KEY|apiKey|TOKEN|token|SECRET|secret|PASSWORD|password|PRIVATE KEY|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|ADMIN_API_TOKEN|TELEGRAM|BOT_TOKEN|\.env"
```

## 3. الملفات الحساسة المتتبعة

```powershell
git --no-pager ls-files | Select-String -Pattern "\.env|\.wrangler|knowledge-files/extracted|\.key|\.pem|id_rsa|secret|token"
```

أي نتيجة تحتاج تحققًا قبل المتابعة. لا تفتح ملفات الأسرار أو تعرض محتواها.

## 4. فحص JavaScript عند الحاجة

```powershell
node --check assets/js/ai-assistant.js
node --check assets/js/admin-unanswered.js
node --check assets/js/assistant-status.js
```

## 5. فحص المعرفة عند تعديلها

```powershell
node tools/check-knowledge.js
node tools/ingest-knowledge.js --export-vectors
(Get-Content ".\tmp\knowledge-vectors.ndjson" | Measure-Object -Line).Lines
```

يجب مطابقة عدد سطور ملف vectors مع عدد مقاطع `preview` قبل أي `upsert`.

## 6. إضافة الملفات بأمان

- ممنوع استخدام `git add .`.
- استخدم `git add` مع المسارات المحددة فقط.
- راجع `git diff --cached --name-only` قبل أي commit.

## 7. الموافقة النهائية

لا تنفّذ `commit` أو `push` أو `deploy` إلا بعد مراجعة المستخدم وموافقته الصريحة.
