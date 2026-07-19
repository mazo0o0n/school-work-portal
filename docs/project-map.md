# خريطة المشروع المختصرة

## نظرة عامة

منصة عربية RTL تجمع موارد التنظيم المدرسي، الروابط التعليمية، الأدلة، الأدوات، ومساعدًا يعتمد على معرفة المنصة.

## أهم الصفحات

| الملف | الغرض |
|---|---|
| `index.html` | الصفحة الرئيسية |
| `register.html` | تسجيل بيانات المدرسة محليًا |
| `1.html` | صانع التقارير |
| `2.html` | بوابة أعمال الاختبارات |
| `3.html` | تحليل النتائج |
| `10.html` | أداة داخلية إضافية |
| `assistant-test.html` | اختبار يدوي داخلي للمساعد، noindex |
| `assistant-status.html` | حالة معرفة المساعد للمطور |
| `knowledge-status.html` | لوحة داخلية لحالة المعرفة وإحصاءات ملف stats وروابط الإدارة |
| `admin-unanswered.html` | إدارة الأسئلة غير المجابة |

### صفحات عامة

- `index.html`
- `about.html`
- `guide.html`
- `privacy.html`

### صفحات داخلية وإدارية

- `assistant-test.html`
- `assistant-status.html`
- `knowledge-status.html`
- `admin-unanswered.html`

## مجلد assets

- `assets/css`: تنسيقات الواجهات.
- `assets/js`: منطق واجهات المتصفح.
- `assets/images`: الصور والشعارات والأيقونات.
- `assets/knowledge-images`: صور مرتبطة بمقاطع المعرفة؛ لا تُعدّل أثناء مهمة معرفة جارية.
- `assets/css/knowledge-status.css`: تنسيق صفحة حالة المعرفة في الوضعين الفاتح والداكن.
- `assets/js/knowledge-status.js`: تحميل إحصاءات المعرفة والعدد الإداري الاختياري دون حفظ التوكن.

## المعرفة

- `knowledge.md`: ملف المعرفة الرئيسي.
- `knowledge-files/approved`: ملفات معرفة معتمدة.
- `knowledge-files/extracted`: محتوى خام؛ ممنوع إضافته إلى Git.
- `knowledge-import`: مواد خام مؤقتة للاستيراد؛ لا تدخل Git ولا تُعامل كمعرفة معتمدة.

## Backend

- `src/index.js`: منطق الخادم؛ لا يُلمس إلا بطلب صريح.

## أدوات المعرفة

- `tools/check-knowledge.js`: تحديث العداد وتشغيل preview بأمان.
- `tools/ingest-knowledge.js`: preview/export/upload حسب الخيار المصرح.
- `tools/update-knowledge-stats.js`: تحديث إحصاءات المعرفة.
- `tools/test-chat.ps1`: تشغيل اختبارات smoke على `/api/chat` لعنوان يحدده المطور.

## الاختبارات

- `tests/chat-smoke-tests.json`: حالات أساسية لاختبار المعرفة وfallback والصور.

## docs

توثيق سير العمل، الإصدار، الأمن، الاختبارات، الروابط، والأداء.

- `docs/knowledge-file-standard.md`: معيار تنسيق ومراجعة ملفات المعرفة.
- `docs/knowledge-update-workflow.md`: دورة تحديث المعرفة من السؤال غير المجاب حتى الاختبار والاعتماد.

## قواعد مهمة

- لا تستخدم `git add .`.
- لا deploy دون موافقة صريحة.
- لا تعدل RAG دون طلب صريح.
- لا تعدل `src/index.js` أو `wrangler.toml` أو ملفات المعرفة أو الأدوات أثناء مراجعات الواجهة والتوثيق.
- لا تعرض أسرارًا أو بيانات اعتماد.
