# منصة التنظيم المدرسي والموارد التعليمية

موقع ثابت HTML/CSS/JavaScript يجمع روابط المنصات التعليمية، الأدلة والأنظمة، أدوات مساندة، وركن الدعم المدرسي في واجهة عربية مخصصة للمدارس.

## هيكل المشروع

```text
index.html
register.html
assets/
  css/
  js/
  images/
```

توجد صفحات HTML إضافية في الجذر لملفات أو صفحات الأدلة المرتبطة بالموقع.

## التشغيل محليا

يمكن فتح `index.html` مباشرة من المتصفح، أو تشغيل خادم محلي بسيط من مجلد المشروع:

```bash
python -m http.server 4173 --bind 127.0.0.1
```

ثم فتح:

```text
http://127.0.0.1:4173/index.html
```

## النشر على Cloudflare Pages

الإعدادات المقترحة:

- Framework preset: `None`
- Build command: `exit 0`
- Build output directory: `/`
- Production branch: `main`

لا يحتاج المشروع إلى Vite أو React أو Node.js لأنه موقع ثابت.
