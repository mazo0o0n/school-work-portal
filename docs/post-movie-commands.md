# أوامر الاعتماد بعد الرجوع

هذه أوامر مقترحة للمراجعة والاعتماد فقط، ولم تُنفذ أثناء إعداد هذا الملف.

## فحص عام

```powershell
git status --short
node --check src/index.js
node --check assets/js/index.js
node --check assets/js/ai-assistant.js
git diff --check
```

## اعتماد حزمة التقويم فقط

```powershell
git add -- src/index.js assets/js/ai-assistant.js assets/css/index.css assets/knowledge-images/academic-calendar-1448-1449-2026-2027.jpg knowledge-files/approved/academic-calendar-1448-1449-faq.md assets/data/knowledge-stats.json
```

## اعتماد حزمة الجوال فقط

```powershell
git add -- index.html assets/css/index.css assets/js/index.js
```

## اعتماد حزمة الرد المخصص فقط

```powershell
git add -- src/index.js assets/js/ai-assistant.js assets/css/index.css
```

## اعتماد حزمة QA فقط

```powershell
git add -- admin-unanswered.html assets/js/admin-unanswered.js assets/css/admin-unanswered.css assistant-test.html assets/js/assistant-test.js assets/css/assistant-test.css docs/current-work-status.md docs/post-movie-commands.md
```

## تحذيرات

- لا تستخدم `git add .`.
- لا تضف `knowledge-import/`.
- راجع `git diff --cached` قبل أي commit لأن بعض الملفات مشتركة بين أكثر من حزمة.
- لا تنفذ commit أو push أو deploy أو upload إلا بعد موافقة صريحة.
