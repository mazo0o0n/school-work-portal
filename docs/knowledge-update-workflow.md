# سير عمل تحديث معرفة مساعد المنصة

يوضح هذا الدليل الخطوات العملية لمراجعة الأسئلة غير المجابة وإضافة المعرفة المعتمدة بأمان.

## دورة العمل المعتمدة

1. اجمع الأسئلة غير المجابة من صفحة `admin-unanswered.html` بعد إدخال **Admin Token** يدويًا. لا تحفظ الرمز في المتصفح، ولا تشاركه أو تصوّره.
2. رتّب الأسئلة حسب الأعلى تكرارًا، واختر ما يحتاج إلى معرفة موثقة.
3. استخدم زر **تجهيز إجابة للمعرفة** لنسخ قالب المراجعة.
4. راجع الإجابة من مصدر رسمي أو موثوق، دون تخمين.
5. أضف السؤال إلى ملف `approved` المناسب:
   - `knowledge.md`
   - أو أحد ملفات `knowledge-files/approved/*.md`
6. شغّل الفحص المحلي الآمن، الذي يحدّث العداد ويشغّل preview:

   ```powershell
   node tools/check-knowledge.js
   ```

7. إذا كانت المعاينة سليمة وبعد الموافقة على تجهيز vectors، شغّل:

   ```powershell
   node tools/ingest-knowledge.js --export-vectors
   ```

8. تحقّق من عدد سطور الملف ومطابقته لعدد مقاطع preview:

   ```powershell
   (Get-Content ".\tmp\knowledge-vectors.ndjson" | Measure-Object -Line).Lines
   ```

9. نفّذ Vectorize upsert يدويًا فقط بعد موافقة صريحة:

    ```powershell
    npx wrangler@latest vectorize upsert school_knowledge_index --file ".\tmp\knowledge-vectors.ndjson" --batch-size 500
    ```

10. اختبر الأسئلة في `assistant-test.html`.
11. شغّل `tools/test-chat.ps1` على بيئة تحتوي `/api/chat` عند الجاهزية.
12. بعد نجاح الاختبار غيّر حالة السؤال إلى **أضيف للمعرفة**.
13. نفّذ commit للملفات المحددة فقط بعد الموافقة، ولا تستخدم `git add .`.

## أوامر مختصرة

```powershell
cd "$env:USERPROFILE\Documents\منصة التنظيم المدرسي"
node tools/check-knowledge.js
node tools/update-knowledge-stats.js
node tools/ingest-knowledge.js --preview
node tools/ingest-knowledge.js --export-vectors
node tools/ingest-knowledge.js --upload
pwsh -File tools/test-chat.ps1 -BaseUrl http://127.0.0.1:4173
git status --short
```

الأمر `node tools/check-knowledge.js` بديل محلي آمن يجمع تحديث العداد عبر `update-knowledge-stats` ومعاينة المعرفة عبر `ingest-knowledge --preview`. لا ينفّذ رفعًا، لذلك لا يغني عن أمر `--upload` عند الرغبة في رفع المعرفة إلى Vectorize.

## التحقق بعد تعديل المعرفة

بعد أي تعديل معرفة، شغّل `node tools/check-knowledge.js`. لا تشغّل `--export-vectors` إلا بعد مراجعة preview والموافقة، ثم تحقّق من أن عدد سطور `tmp/knowledge-vectors.ndjson` يطابق عدد المقاطع. اختبر عبر `assistant-test.html` و`tools/test-chat.ps1` قبل أي اعتماد أو رفع.

## أشياء ممنوعة

- لا تعرض `ADMIN_API_TOKEN`.
- لا تضف `.env`.
- لا تضف `.wrangler`.
- لا تضف `knowledge-files/extracted`.
- لا تستخدم `git add .`.
- لا تعدّل `src/index.js` إلا للضرورة وبموافقة.
- لا تعدّل `wrangler.toml` إلا للضرورة وبموافقة.
