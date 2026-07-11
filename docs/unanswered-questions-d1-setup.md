# حفظ الأسئلة غير المجابة عبر Cloudflare D1

## إنشاء قاعدة D1

```bash
npx wrangler d1 create school-unanswered-questions
```

بعد إنشاء القاعدة، ستظهر قيمة `database_id`. لا تضفها إلا بعد التأكد من القاعدة الصحيحة.

## تطبيق Migration

محليًا:

```bash
npx wrangler d1 migrations apply school-unanswered-questions --local
```

على Cloudflare عند الجاهزية:

```bash
npx wrangler d1 migrations apply school-unanswered-questions --remote
```

## Binding المطلوب لاحقًا

يُضاف لاحقًا إلى `wrangler.toml` بعد معرفة `database_id` الحقيقي:

```toml
[[d1_databases]]
binding = "UNANSWERED_DB"
database_name = "school-unanswered-questions"
database_id = "PUT_REAL_DATABASE_ID_HERE"
```

## طريقة الاختبار

1. شغّل المشروع محليًا مع binding D1 مضبوط.
2. أرسل سؤالًا لا توجد له إجابة مؤكدة في معرفة المنصة.
3. تحقق من جدول `unanswered_questions`:

```bash
npx wrangler d1 execute school-unanswered-questions --local --command "SELECT question, reason, status, repeat_count, created_at FROM unanswered_questions ORDER BY updated_at DESC LIMIT 10;"
```

4. كرر السؤال نفسه وتأكد أن `repeat_count` يزيد بدل إنشاء صف جديد.

## تنبيه خصوصية

التسجيل مخصص لتحسين قاعدة معرفة مساعد المنصة فقط. لا يتم حفظ IP أو بيانات شخصية حساسة. البيانات المحفوظة تقتصر على السؤال، صيغته المطبعة، سبب عدم الإجابة، مسار الصفحة إن توفر، وحالة المراجعة.
