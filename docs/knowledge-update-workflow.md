# سير عمل تحديث معرفة مساعد المنصة

يوضح هذا الدليل الخطوات العملية لمراجعة الأسئلة غير المجابة وإضافة المعرفة المعتمدة بأمان.

## دورة العمل

1. افتح [صفحة إدارة الأسئلة غير المجابة](https://mazen.zb-store.com/admin-unanswered.html).
2. أدخل **Admin Token** يدويًا. لا تحفظه في `localStorage`، ولا تشاركه أو تصوّره.
3. راجع الأسئلة الجديدة وحدد السؤال الذي يحتاج إلى إضافة معرفة.
4. استخدم زر **نسخ كقالب معرفة**.
5. الصق القالب في ملف المعرفة المناسب:
   - `knowledge.md`
   - أو أحد ملفات `knowledge-files/approved/*.md`
6. اكتب الإجابة اعتمادًا على مصدر معتمد فقط:
   - لا تخمّن ولا تضف إجابات غير موثقة.
   - لا تضف ملفات من `knowledge-files/extracted`.
   - لا تضف ملفات PDF إلى Git.
7. حدّث عداد المعرفة:

   ```powershell
   node tools/update-knowledge-stats.js
   ```

8. عاين المعرفة قبل الرفع:

   ```powershell
   node tools/ingest-knowledge.js --preview
   ```

9. بعد مراجعة المعاينة والتأكد من صحة المحتوى، ارفع المعرفة إلى Vectorize:

   ```powershell
   node tools/ingest-knowledge.js --upload
   ```

10. إذا فشل الرفع بسبب مشكلة في المسار العربي على Windows، استخدم:

    ```powershell
    npx wrangler@latest vectorize upsert school_knowledge_index --file ".\tmp\knowledge-vectors.ndjson" --batch-size 500
    ```

11. اختبر المساعد محليًا أو على الرابط المنشور، وتحقق من الإجابة الجديدة.
12. بعد التأكد، ارجع إلى صفحة الإدارة وغيّر حالة السؤال إلى **أضيف للمعرفة**.
13. عند استخدام Git:
    - يُمنع استخدام `git add .`.
    - استخدم `git add` للملفات المحددة فقط.
    - لا تنفّذ `commit` أو `push` أو `deploy` إلا بموافقة صريحة.

## أوامر مختصرة

```powershell
cd "$env:USERPROFILE\Documents\منصة التنظيم المدرسي"
node tools/check-knowledge.js
node tools/update-knowledge-stats.js
node tools/ingest-knowledge.js --preview
node tools/ingest-knowledge.js --upload
git status --short
```

الأمر `node tools/check-knowledge.js` بديل محلي آمن يجمع تحديث العداد عبر `update-knowledge-stats` ومعاينة المعرفة عبر `ingest-knowledge --preview`. لا ينفّذ رفعًا، لذلك لا يغني عن أمر `--upload` عند الرغبة في رفع المعرفة إلى Vectorize.

## أشياء ممنوعة

- لا تعرض `ADMIN_API_TOKEN`.
- لا تضف `.env`.
- لا تضف `.wrangler`.
- لا تضف `knowledge-files/extracted`.
- لا تستخدم `git add .`.
- لا تعدّل `src/index.js` إلا للضرورة وبموافقة.
- لا تعدّل `wrangler.toml` إلا للضرورة وبموافقة.
