# ملاحظات المطور

## بطاقات المنصات

- تضاف البطاقة الظاهرة حاليًا داخل قسم `#academy-platforms` في `index.html`.
- استخدم صورة محلية داخل `assets/images/`، ورابطًا خارجيًا مع `target="_blank"` و`rel="noopener noreferrer"`.
- لا تكرر البطاقة في الأقسام القديمة غير النشطة.

## بطاقات ركن الدعم

- تضاف البطاقة الظاهرة داخل قسم `#academy-news` في `index.html`.
- بطاقة «ملفات وسجلات المدير» يجب أن تبقى مرتبطة بالمودال عبر `data-manager-reports-entry`.
- لا تعرض بطاقة غير جاهزة كرابط قابل للنقر.

## تقارير المدير

- بيانات القوالب موجودة في `assets/js/report-word-generator.js`.
- قوالب DOCX موجودة في `assets/report-templates/manager-reports/`.
- صور المعاينة، عند توفرها، توضع داخل `assets/report-previews/` ويشار إليها بحقل `previewImage` في metadata.
- لا تعدّل قالب Word الأصلي دون مراجعة بصرية مستقلة.

## تحديث المعرفة

1. استخدم مصادر معتمدة فقط.
2. شغّل `node tools/check-knowledge.js`.
3. راجع العداد ونتيجة preview.
4. لا تشغّل upload أو Vectorize upsert دون موافقة صريحة.
5. راجع `docs/knowledge-update-workflow.md`.

## فحص الروابط

```powershell
node tools/check-links.js
```

يفحص السكربت ملفات HTML في جذر المشروع محليًا دون الاتصال بالإنترنت. يمكن تحديد ملفات بعينها:

```powershell
node tools/check-links.js index.html about.html privacy.html
```

- لا تستخدم `href="#"` للملفات أو الخدمات المؤجلة؛ اترك العنصر بلا `href` مع `aria-disabled="true"` و`tabindex="-1"`.
- صفحة `10.html` أرشيفية فقط، وتبقى خارج الصفحة الرئيسية و`sitemap.html` مع `noindex, nofollow`.

## معرفة تقارير المدير

- الأسئلة المعتمدة موجودة في `knowledge-files/approved/manager-reports-faq.md`.
- نجاح `node tools/check-knowledge.js` يحدّث الإحصاءات المحلية فقط؛ لا تصبح الأسئلة متاحة لمساعد الإنتاج قبل ingest وVectorize بموافقة صريحة.

## فحص الجوال

- استخدم `docs/mobile-qa-checklist.md` للمقاسات 390×844 و414×896 و768×1024.
- لا تسجّل أي بند كمجتاز قبل تنفيذه يدويًا على المتصفح أو الجهاز.

## أمان Git والأسرار

- ممنوع استخدام `git add .`.
- لا تضف `.env` أو `.wrangler` أو tokens أو ملفات أسرار.
- لا تنفذ commit أو push أو deploy دون موافقة صريحة.

## ملاحظات الإصدار المحلي v1.5.1

- الإصدار `v1.5.1` قيد التجهيز محليًا وغير منشور، والمنشور الحالي هو `v1.5.0`.
- البنود التالية توثق قرارات تقنية مستمرة من النسخة السابقة.

- أُبقيت قوالب DOCX في `assets/report-templates/manager-reports/` ضمن Static Assets بواسطة استثناء `.assetsignore` الحالي.
- استُبعدت مجلدات التطوير والتشخيص والتقارير المحلية من Static Assets.
- `2.html` يعرض البنود بلا ملف كعناصر معطلة، و`10.html` يحمل تنبيهًا أرشيفيًا ولا يرتبط بالواجهة العامة.
- `feedback.html` لا يحتوي نموذجًا أو وجهة إرسال إلى أن تعتمد قناة البلاغات.
- بعد اعتماد النسخة: اختبرها مع ثلاثة مستخدمين، ونفّذ قائمة فحص الجوال، واعتمد وجهة البلاغات، وجهّز صور معاينة التقارير.
