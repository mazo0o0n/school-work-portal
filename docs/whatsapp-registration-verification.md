# التحقق من رقم الجوال عبر WhatsApp

هذه الوثيقة تصف أساس التحقق من رقم جوال مسؤول تسجيل المدرسة عبر WhatsApp Cloud API. الميزة اختيارية، وتبقى معطلة ما لم تكن قيمة `PHONE_VERIFICATION_REQUIRED` مساوية حرفيًا لـ`true` في البيئة المقصودة.

لا يجوز اعتبار الاختبارات بالمحاكاة اختبارًا حقيقيًا، ولا يجوز إرسال OTP فعلي أو تفعيل الميزة في الإنتاج دون موافقة صريحة من مالك المشروع.

## تدفق التحقق

1. تقرأ صفحة التسجيل `GET /api/register/verification-config`.
2. عند تعطيل الميزة، تُخفى واجهة OTP ويستمر التسجيل التقليدي دون استعلام جدول `phone_verifications`.
3. عند تفعيلها، يرسل العميل الرقم إلى `POST /api/register/send-whatsapp-code`.
4. يطبّع الخادم رقم الجوال السعودي، ويولّد OTP عشوائيًا من ستة أرقام.
5. يُخزن HMAC للرمز فقط مع مدة صلاحية عشر دقائق وحد أقصى خمس محاولات وفاصل إعادة إرسال قدره 60 ثانية.
6. يرسل محول Meta قالب WhatsApp المعتمد. عند فشل المزود أو انتهاء المهلة يُبطل الرمز المحجوز ولا يُتجاوز التحقق.
7. يرسل العميل الرمز إلى `POST /api/register/verify-whatsapp-code`.
8. عند نجاح التحقق يُصدر الخادم token عشوائيًا قصير العمر، ويخزن hash فقط، ويُبطل OTP فورًا.
9. يُستخدم token مرة واحدة أثناء إنشاء المدرسة، ويُستهلك مع إدراج المدرسة داخل دفعة D1 واحدة.

## الإعدادات والأسرار

### أسرار

- `PHONE_VERIFICATION_SECRET`: قيمة عشوائية قوية لتوقيع OTP؛ تُنشأ محليًا ولا تأتي من Meta.
- `WHATSAPP_ACCESS_TOKEN`: access token من Meta بصلاحيات WhatsApp اللازمة.
- `WHATSAPP_TEST_ALLOWED_PHONES`: قائمة أرقام اختبار معتمدة، مفصولة بفواصل أو أسطر. تُعامل كبيانات خاصة بالبيئة ولا توضع في Git.
- `RATE_LIMIT_SALT`: السر الحالي المستخدم لمفاتيح rate limiting.
- `ADMIN_API_TOKEN`: رمز مستقل للوصول إلى لوحة الإدارة في Preview.

### إعدادات غير سرية

- `PHONE_VERIFICATION_REQUIRED`: يفعّل التحقق فقط عند القيمة `true`.
- `WHATSAPP_GRAPH_API_VERSION`: إصدار Graph API بصيغة مثل `vNN.N`، ويُختار من الإصدارات التي تدعمها Meta وقت الإعداد.
- `WHATSAPP_PHONE_NUMBER_ID`: معرّف رقم الإرسال في WhatsApp Cloud API.
- `WHATSAPP_OTP_TEMPLATE_NAME`: اسم قالب OTP المعتمد.
- `WHATSAPP_TEMPLATE_LANGUAGE`: رمز لغة القالب المعتمد.
- `WHATSAPP_TEST_MODE`: يفعّل قائمة السماح الخاصة ببيئة الاختبار فقط عند القيمة `true`.

لا توضع الأسرار في `wrangler.toml` أو HTML أو JavaScript العام. تُضاف تفاعليًا عبر Wrangler بعد إنشاء البيئة المقصودة، ولا تُنسخ قيمها إلى المحادثات أو السجلات.

## إعداد Meta يدويًا

1. تجهيز Meta Business Portfolio وتطبيق يدعم WhatsApp Cloud API.
2. تجهيز WhatsApp Business Account ورقم إرسال للاختبار.
3. الحصول من صفحة WhatsApp API Setup على Phone Number ID.
4. إنشاء قالب Authentication أو قالب مناسب للـOTP واعتماده في WhatsApp Manager.
5. تسجيل اسم القالب ورمز لغته كما اعتمدتهما Meta تمامًا.
6. إنشاء access token مناسب لبيئة الاختبار وبأقل صلاحيات لازمة.
7. مطابقة مكونات payload في `buildWhatsAppOtpTemplatePayload` مع القالب المعتمد قبل أول إرسال حقيقي.

المحول الحالي يرسل معامل نص واحدًا داخل `body`. لا يفترض وجود زر نسخ الرمز أو Autofill؛ إذا احتوى القالب المعتمد على مكونات إضافية، تُراجع وتُختبر قبل تعديل payload.

## سياسة البيانات الحساسة

- لا يُخزن OTP كنص صريح.
- لا يُخزن verification token الصريح في D1.
- لا تُسجل أرقام الجوال كاملة أو OTP أو tokens أو hashes أو access tokens.
- لا تُعاد تفاصيل أخطاء Meta للمستخدم.
- لا تظهر بيانات التحقق الحساسة في API الإدارة أو واجهتها.
- token الصريح يُعاد فقط بعد تحقق ناجح لإكمال طلب التسجيل، ولا يُحفظ في `localStorage`.

## الاختبار المحلي بالمحاكاة

الاختبارات المحلية تستخدم `WHATSAPP_OTP_SENDER` أو محول `fetch` اختباريًا، ولا تتصل بـMeta. وهي تغطي:

- توليد الرابط الإصدارّي وpayload القالب الحالي.
- المهلة وأخطاء الشبكة وHTTP.
- إبطال OTP عند فشل الإرسال.
- الصلاحية والمحاولات وإعادة الإرسال ومنع إعادة استخدام OTP وtoken.
- قائمة السماح في وضع الاختبار.
- حدود JSON والردود الآمنة الموحدة.
- استمرار التسجيل التقليدي عند تعطيل الميزة.

هذه الاختبارات تثبت سلوك الكود فقط، ولا تثبت قبول القالب أو وصول رسالة WhatsApp.

## البيئات الثلاث

- **Local:** تشغيل واختبار على الجهاز فقط. يستخدم الاختبار التكاملي Worker الحقيقي وSQLite مؤقتة مطبقة عليها migrations المنصة، ويحاكي مزود Meta عند حد الإرسال فقط.
- **Preview:** بيئة Cloudflare مستقبلية معزولة باسم `snowy-mud-6e88-preview` وقاعدة `school-platform-db-whatsapp-preview`. لا تملك custom domain ولا تستخدم قاعدة الإنتاج.
- **Production:** Worker الإنتاج وbindings الحالية دون تغيير. يبقى WhatsApp معطلًا ما لم تكن قيمة `PHONE_VERIFICATION_REQUIRED` مساوية حرفيًا لـ`true`.

بيئة `preview` معرفة في `wrangler.toml` بالميزة معطلة وبوضع الاختبار مفعّل، لكن `database_id` غير موجود حتى إنشاء D1 بعد موافقة مستقلة. لا تحتوي البيئة على AI أو Vectorize أو قاعدة الأسئلة غير المجابة، لتجنب أي اتصال بعيد غير لازم أثناء اختبار التسجيل.

### تصميم Preview

- Worker: `snowy-mud-6e88-preview` عبر `workers.dev` دون route إنتاجي.
- Static Assets: binding باسم `ASSETS`.
- D1: binding باسم `PLATFORM_DB` وقاعدة مستقلة باسم `school-platform-db-whatsapp-preview`.
- Rate limiting: bindings منفصلة للاختبار عن namespaces الإنتاج.
- `PHONE_VERIFICATION_REQUIRED=false` في أول نشر.
- `WHATSAPP_TEST_MODE=true` حتى لا يقبل الإرسال إلا أرقام قائمة السماح السرية.
- حقول Meta غير السرية فارغة حتى اعتماد القالب والرقم والإصدار.
- يحتوي `[env.preview.secrets]` على أسماء الأسرار المطلوبة فقط، وفق مخطط Wrangler 4 المحلي، دون أي قيم. القيم تضاف تفاعليًا ولا توضع في Git.

## التشغيل المحلي الآمن

يتطلب تشغيل أوامر Wrangler توفر Wrangler 4 محليًا. تستخدم scripts الخيار `--no-install` حتى لا تثبت حزمًا أو تتصل بالشبكة ضمن الفحص:

```powershell
npm run d1:whatsapp-preview:local:migrate
npm run dev:whatsapp-preview:local
npm run test:whatsapp-integration
```

الأمر الأول يطبق migrations على D1 المحلية فقط، والثاني يشغل Worker محليًا على المنفذ `8788`. اختبار التكامل لا يحتفظ ببيانات: ينشئ SQLite داخل الذاكرة، يطبق migrations الخمس، ثم يغلقها بعد كل حالة.

## إنشاء Preview مستقبلًا — لا تنفذ دون موافقة

الأوامر التالية خطة تشغيلية فقط، ولم تُنفذ أثناء إعداد هذه الوثيقة:

```powershell
npx wrangler d1 create school-platform-db-whatsapp-preview
# أضف database_id الناتج إلى [[env.preview.d1_databases]] بعد مراجعته.

npx wrangler secret put PHONE_VERIFICATION_SECRET --env preview
npx wrangler secret put WHATSAPP_ACCESS_TOKEN --env preview
npx wrangler secret put WHATSAPP_TEST_ALLOWED_PHONES --env preview
npx wrangler secret put RATE_LIMIT_SALT --env preview
npx wrangler secret put ADMIN_API_TOKEN --env preview

npx wrangler d1 migrations apply PLATFORM_DB --env preview --remote
npx wrangler deploy --env preview
```

قبل أول نشر، تبقى حقول Meta غير السرية فارغة والميزة معطلة. بعد الحصول على حساب Meta وقالب معتمد ورقم إرسال، تُحدّث فقط قيم Preview التالية ثم تراجع قبل نشر جديد:

- `WHATSAPP_GRAPH_API_VERSION`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_OTP_TEMPLATE_NAME`
- `WHATSAPP_TEMPLATE_LANGUAGE`

بعد نجاح النشر المعطل، تُفعّل `PHONE_VERIFICATION_REQUIRED=true` في Preview وحده، ويضاف رقم الاختبار تفاعليًا إلى `WHATSAPP_TEST_ALLOWED_PHONES`. لا يُطلب إدخال أي سر في المحادثة أو في سطر أوامر ظاهر.

## التفعيل والتراجع

### التفعيل

1. نجاح الاختبارات المحلية وQA.
2. اعتماد قالب Meta ومطابقة payload معه.
3. إنشاء Preview معزول وإضافة أسراره دون كشفها.
4. تجربة رقم يملكه صاحب المشروع بعد موافقته الصريحة.
5. اختبار التسجيل حتى ظهور المدرسة في لوحة الإدارة دون تسريب بيانات تحقق.
6. طلب موافقة جديدة قبل أي تفعيل إنتاجي.

### التراجع

1. ضبط `PHONE_VERIFICATION_REQUIRED=false` أو إزالة المتغير من البيئة المتأثرة.
2. التحقق من عودة التسجيل التقليدي دون استعلام `phone_verifications`.
3. إلغاء access token الخاص ببيئة الاختبار عند إنهائها.
4. إزالة Worker وقاعدة وموارد Preview فقط بعد التأكد من عدم الحاجة إلى بياناتها.

بعد موافقة مستقلة والتأكد من عدم وجود بيانات مطلوبة، تكون أوامر إزالة موارد الاختبار المستقبلية:

```powershell
npx wrangler delete --name snowy-mud-6e88-preview
npx wrangler d1 delete school-platform-db-whatsapp-preview
```

## ما لا يعد اختبارًا حقيقيًا

- نجاح mock sender.
- نجاح اختبار payload دون طلب Meta.
- نجاح إنشاء OTP وتخزين hash محليًا.
- نجاح E2E مع اعتراض endpoints داخل المتصفح.

الاختبار الحقيقي يبدأ فقط بعد إرسال رسالة من Preview المعزول إلى رقم اختبار معتمد، ثم إتمام التحقق والتسجيل ومراجعة المدرسة في لوحة الإدارة.

## حالة الأيام 6–10

مكتمل برمجيًا: توليد OTP آمن، تخزين hash، حدود الصلاحية والمحاولات، token أحادي الاستخدام، إبطال الرمز بعد فشل المزود، timeout، Graph API version، التحقق من إعدادات القالب، قائمة السماح، Feature Flag، حدود body، والاختبارات المحلية ذات SQL الفعلي.

غير مكتمل تشغيليًا: إنشاء موارد Preview البعيدة، إضافة أسرارها، اعتماد قالب Meta، إضافة رقم الإرسال، إرسال رسالة حقيقية، والتحقق من وصولها. لذلك لا تعد الأيام 6–10 مغلقة تشغيليًا قبل هذا الاختبار الحقيقي والموافقة الصريحة.
