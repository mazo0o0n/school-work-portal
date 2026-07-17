/* عناوين الأقسام وترتيبها */
const GROUP_TITLES={
  grading:"التقويم والدرجات",
  exams:"الاختبارات",
  attendance:"الحضور والدوام",
  facilities:"المرافق والتشغيل",
  quality:"التميز والجودة",
  conduct:"السلوك والمواظبة والمهني",
  policies:"الأدلّة والتنظيمات التربوية والإدارية",
  staff:"شاغلو الوظائف التعليمية",
  platformsOps:"منصات التشغيل والمعاملات",
  uniform:"المظهر والزي",
  forms:"نماذج وزيارات",
  inclusive:"التعليم الشامل والدعم الطلابي",
  safety:"الأمن والسلامة المدرسية",
  elearn:"التعلّم الإلكتروني والمحتوى الرقمي",
  counseling:"التوجيه الطلابي والرعاية النفسية",
  kg:"الطفولة المبكرة",
  interactive:"التقويم المدرسي",
  guides:"المسؤولية المجتمعية و التطوع"
};
const ORDER=[
  "grading","exams","attendance","facilities","quality","conduct","policies","staff",
  "platformsOps","uniform","forms","inclusive","safety","elearn","counseling","kg",
  "interactive","guides"
];
// ✅ محلّل تاريخ آمن يقبل: YYYY-M-D أو YYYY-MM-DD (بدون تأثير الوقت)
function parseYMD(dateStr){
  if(!dateStr) return null;
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(!m) return null;
  const y  = Number(m[1]);
  const mo = Number(m[2]);
  const d  = Number(m[3]);
  return new Date(y, mo - 1, d); // تاريخ محلي بدون وقت
}
/* حساب "جديد" لآخر N أيام (تقويميًا بدون تأثير الساعات) */
function خلالأيام(dateStr, days=2){
  if(!dateStr) return false;

  // تثبيت اليوم عند منتصف الليل
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // تثبيت تاريخ العنصر عند منتصف الليل
  const d0 = parseYMD(dateStr);
if(!d0) return false;
  const dateMid = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());

  const diffDays = Math.floor((todayMid - dateMid) / (1000*60*60*24));
  return diffDays >= 0 && diffDays <= days;
}


/* أدوات مساعدة */
function esc(s){
  return String(s ?? "").replace(/[&<>"'`]/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"
  }[c]));
}
function isValidUrl(u){
  try{
    const url = new URL(String(u||"").trim());
    return url.protocol === "https:";
  }catch(_){
    return false;
  }
}
function driveId(u){
  const s = String(u||"");
  let m = s.match(/\/file\/d\/([^/]+)\//);
  if(m) return m[1];
  m = s.match(/[?&]id=([^&]+)/);
  return m ? m[1] : "";
}
function toDirect(u){
  const id = driveId(u);
  return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : u;
}

/* "جديد" الآن مرتبط فقط بالتاريخ الحديث (آخر يومين) */
function isLatest(item){
  if(!item) return false;
  if(item.isNew === true) return true;          // ✅ جديد يدوي
  if(item.addedAt) return خلالأيام(item.addedAt,2); // ✅ جديد تلقائي آخر يومين
  return false;
}

/* الكتالوج المصنّف */
const CATALOG = {
 grading: [
  {title:"خطة التقويم الفصلي والجاهزية للتقويم الخارجي – ف2 1447هـ",desc:"تعليم القصيم.",kind:"خطة",url:"https://drive.google.com/file/d/1A3wVyGjk9c1-ZdB3X5lKjJzftIbP5pYM/view?usp=sharing",src:"تعليم القصيم",addedAt:"2026-03-02"},
 {title:"توزيع درجات المواد الدراسية_2025_للائحة_المحدثة",desc:"إدارة تقويم الأداء المعرفي والمهاري نجران.",kind:"لائحة",url:"https://drive.google.com/file/d/1FB7bDXAWutT_FH1fvK1T53P0o0ZEFd29/view?usp=sharing",src:"تعليم نجران  "},
  {title:"أهم مستجدات لائحة تقويم الطالب في المرحلة الابتدائية 2025م",desc:"مستجدات وتحديثات مرتبطة بتطبيق لائحة تقويم الطالب للمرحلة الابتدائية.",kind:"مستجدات",url:"https://drive.google.com/file/d/1HCgjtGboL6stBjtbpzcs6-A4SkWsQpEv/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-12-17"},
  {title:"لائحة تقويم الطالب 2025م",desc:"سياسة التقييم وأدوات القياس.",kind:"لائحة",url:"https://drive.google.com/file/d/1jMcFdltw6SomgRAGyFQFOecvJOqF4m8-/view",src:"وزارة التعليم"},
  {title:"دليل توزيع الدرجات لجميع المراحل الدراسية ٢٠٢٥",desc:" نِسَب عناصر التقويم.",kind:"دليل",url:"https://drive.google.com/file/d/1WE62DFBgeCrHf1noqxvechwULBDYi58Y/view?usp=sharing",src:" تعليم المدينه"},
  {title:"الإجراءات التنفيذية للائحة تقويم الطالب 2025م",desc:"آليات تطبيق اللائحة داخل المدرسة.",kind:"دليل",url:"https://drive.google.com/file/d/1L5GiafAgPY0vBSQdea_obk9vKcE-t7JR/view",src:"وزارة التعليم"},
  {title:"توزيع درجات الطلاب 2025م",desc:"نِسَب عناصر التقويم.",kind:"دليل",url:"https://drive.google.com/file/d/1aJfnmDnFuvE5STTsZ6PIGeMJLfYG0Xcl/view",src:"وزارة التعليم"}
],
 exams: [
  {title:"دليل الاختبارات 2025م",desc:"أسس تنفيذ الاختبارات وتنظيمها.",kind:"دليل",url:"https://drive.google.com/file/d/1igqY7tNeqoEPX7YV6VqTw0GnGUWDzBNf/view",src:"وزارة التعليم"},
  {title:"إطار الاختبارات المركزية في إدارات التعليم العامة 1446",desc:"تنظيم وآليات الاختبارات المركزية.",kind:"إطار",url:"https://drive.google.com/file/d/1tHeew76-antAa3jRdJx2gjKE9OSbSyER/view?usp=sharing",src:"وزارة التعليم"},
  {title:"الدليل الإرشادي للمدرسة في تطبيق الاختبارات المركزية",desc:"إجراءات وتوجيهات تطبيق الاختبارات المركزية قبل وأثناء وبعد الاختبار.",kind:"دليل",url:"https://drive.google.com/file/d/1Lfws8mL4bro2xAg40t_OrawtSDu7SYaQ/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-06-22"},
  {title:"الملف التفاعلي للاختبارات المعيارية PIRLS 2026",desc:"حزمة تفاعلية استعدادًا لـ PIRLS.",kind:"ملف تفاعلي",url:"https://drive.google.com/file/d/1QjNwCRRyh3_WJhmI2Qd7rctqyjc8MOBV/view?usp=sharing",src:"وزارة التعليم"},
  {title:"دليل الاختبارات — الأسس الفنية والعمليات الإجرائية 2025م",desc:"مرجع تفصيلي للأسس الفنية والعمليات الإجرائية للاختبارات.",kind:"دليل",url:"https://drive.google.com/file/d/1uN5yrqVOspCGz75rcZNi-mYIq7cjz8F4/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"},
  {title:"خطوات إعداد اللجان في نظام نور",desc:"إرشادات عملية لإعداد لجان الاختبارات في نظام نور.",kind:"خطوات",url:"https://drive.google.com/file/d/1E-cgxV72_E2mvUTCmOGoqelaDTQeaC2n/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"},
  {title:"مذكرة زمن الاختبارات للمواد",desc:"تنظيم الأوقات الزمنية لاختبارات المواد الدراسية.",kind:"مذكرة",url:"https://drive.google.com/file/d/1vU7Wa-8-A0RM2CqWLPFp7Dbtaxb_NvOX/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"}
],
  attendance: [
  {title:"الدليل الإجرائي الجديدالموارد البشرية   (٢٠٢٥)",desc:"مجموعة إجراءات إدارة الموارد البشرية .",kind:"دليل",url:"https://drive.google.com/file/d/19I9brGKTYLPqmknTYNGUCDW_qYpny9ro/view?usp=sharing",src:"الموارد البشرية "},
  {title:"دليل المستخدم لتطبيق حضوري (الموظفين)",desc:"تسجيل الحضور والانصراف.",kind:"دليل",url:"https://drive.google.com/file/d/17LYzCksGBqvzgS_8iedKaF1zYBBxeqGy/view",src:"وزارة التعليم"},
  {title:"لوحة تحكم حضوري (مدير)",desc:"إدارة حضور منسوبي المدرسة.",kind:"دليل",url:"https://drive.google.com/file/d/1BC6s9RyFiImAWYcELrwZyb9-WvhOmFPa/view",src:"وزارة التعليم"}
],
  facilities: [
    {title:"الدليل الإرشادي لإدارة وتشغيل المرافق",desc:"تشغيل مرافق المدرسة بكفاءة.",kind:"دليل",url:"https://drive.google.com/file/d/1uuz81m2i23EBpmmSuWUnqHhySKv_5Rpn/view",src:"وزارة التعليم"},
    {title:"الدليل الإجرائي لمدارس التعليم العام",desc:"خطوات العمل والإجراءات التفصيلية للمهام المدرسية.",kind:"دليل",url:"https://drive.google.com/file/d/18rVycmGYJ3vNrUq2hsAbZiDGv9WaZULR/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل الجدول المدرسي",desc:"إعداد وإدارة الجداول المدرسية إلكترونيًا.",kind:"دليل",url:"https://drive.google.com/file/d/1hNbB4ckJylnknHWPtQeKJit1t_MM-9DV/view?usp=sharing",src:"وزارة التعليم"}
  ],
  quality: [
    {title:"الدليل الاسترشادي لمشرف دعم التميز",desc:"تمكين المشرف من دعم التميز والجودة.",kind:"دليل",url:"https://drive.google.com/file/d/17l_qlhdWdUBRWEbDcFKT0iCkUh2gifu4/view",src:"وزارة التعليم"},
    {title:"التطوير المهني للمدرسة (التطوير الموجّه ذاتيًا)",desc:"إطار التحسين المستمر.",kind:"دليل",url:"https://drive.google.com/file/d/1DXr6D6B57noKsxmb35WPcqd9rQK9IVfk/view",src:"وزارة التعليم"},
    {title:"إضاءات حول آلية تنفيذ خطط الأنشطة الطلابية",desc:"تيسير تنفيذ الخطط والأنشطة.",kind:"إضاءات",url:"https://drive.google.com/file/d/1sfjuD1oWpum1_5UsRrjNSLg63tH6q7eT/view",src:"وزارة التعليم"},
    {title:"النموذج الإشرافي في ضوء تمكين المدرسة 1446",desc:"إطار إشرافي داعم لتمكين المدرسة.",kind:"وثيقة",url:"https://drive.google.com/file/d/1h7dle7BDjH8T8GC0Pf5EurGE1C9OJCMm/view?usp=sharing",src:"وزارة التعليم"},
    {title:"النموذج الإشرافي في ضوء تمكين المدرسة الاصدار الثاني ٢٠٢٥",desc:"إطار إشرافي داعم لتمكين المدرسة.",kind:"وثيقة",url:"https://drive.google.com/file/d/1iMhT5abtE12HQKMwJXgJ_z3JT6RSQHLW/view?usp=sharing",src:"وزارة التعليم"},
    {title:"أدوات دعم تطبيق النموذج الإشرافي في ضوء تمكين المدرسة",desc:"حزمة أدوات تنفيذية لدعم النموذج الإشرافي.",kind:"أدوات",url:"https://drive.google.com/file/d/1RPomx_X-2Beg2hYa8YBZqCVR68FhTQH1/view?usp=sharing",src:"وزارة التعليم"},
    {title:"تحسين التدريس: مبادئ ومفاهيم ومهارات أساسية",desc:"مرتكزات أساسية لتحسين التدريس.",kind:"دليل",url:"https://drive.google.com/file/d/1D2Phzqd8wJ-pIjGA5433v_-T9xzu9Vly/view?usp=sharing",src:"وزارة التعليم"},
    {title:"إجراءات تطبيق إطار تحسين التدريس (بإدارات التعليم)",desc:"إجراءات عملية للتطبيق على مستوى الإدارة.",kind:"إجراءات",url:"https://drive.google.com/file/d/1yEDdr66qvPNtl8C0nz7gyKgloS9_34fh/view?usp=sharing",src:"وزارة التعليم"},
    {title:"إطار تحسين التدريس — نموذج تطبيقي",desc:"نموذج تطبيقي لإطار تحسين التدريس.",kind:"نموذج",url:"https://drive.google.com/file/d/1aAzw1XUo7ZAkUeM5dSUkZ9av2rkU_XU7/view?usp=sharing",src:"وزارة التعليم"},
    {title:"أدوات دعم تطبيق إطار تحسين مجال التدريس",desc:"أدوات مساندة لتفعيل إطار تحسين التدريس.",kind:"أدوات",url:"https://drive.google.com/file/d/1aWElL4f0-KhDcHH4nfGP9e3REviu2XuI/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الخطط الدراسية للأنشطة الطلابية",desc:"أطر وخطط أنشطة طلابية معتمدة.",kind:"خطط",url:"https://drive.google.com/file/d/18BSL4doQo6Z72Ih8-HEN1KD9inPOZrvp/view?usp=sharing",src:"وزارة التعليم"},
    {title:"التطوير المهني للمدرسة (التطوير الموجّه ذاتيًا) — نسخة",desc:"مرجع داعم للتطوير الذاتي على مستوى المدرسة.",kind:"دليل",url:"https://drive.google.com/file/d/1FyCJXw_RJDc-X-qSzWz94boyo3NnONYm/view",src:"وزارة التعليم"},
    {title:"دليل المبادرات",desc:"مرجع لتنظيم وتصميم المبادرات التعليمية والمدرسية.",kind:"دليل",url:"https://drive.google.com/file/d/1YdT4vmNrkFqXp8y3TcldiSFTo-vBXjsy/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"},
    {title:"إضاءات في طريق التميز المدرسي",desc:"إضاءات داعمة لمسار التميز والجودة المدرسية.",kind:"إضاءات",url:"https://drive.google.com/file/d/1triSCffklFvhC9DAYxiizxkzdtfIVKuA/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"}
  ],
  conduct: [
    {title:"قواعد السلوك والمواظبة 1447هـ",desc:"حقوق الطالب وإجراءات الانضباط.",kind:"قواعد",url:"https://drive.google.com/file/d/1RYIYPFlAcT9Ya-RnPw3bnpQASVQIz0FX/view",src:"وزارة التعليم"},
    {title:"دليل السلوك المهني لموظفي وزارة التعليم 2025",desc:"معايير السلوك المهني.",kind:"دليل",url:"https://drive.google.com/file/d/1FP2_l_4vTqbuBK7k03YktLX92TVdqDcy/view",src:"وزارة التعليم"},
    {title:"مدونة السلوك الوظيفي وأخلاقيات الوظيفة العامة",desc:"قواعد السلوك الوظيفي بالقطاع الحكومي.",kind:"مدونة",url:"https://www.hrsd.gov.sa/sites/default/files/2022-10/08102022.pdf",src:"الموارد البشرية والتنمية الاجتماعية"},
    {title:"دليل استخدام الهواتف والأجهزة المحمولة",desc:"سياسات وضوابط استخدام الأجهزة.",kind:"دليل",url:"https://drive.google.com/file/d/1lIlgSYa-iGNNjNXlKoPHHecAUL5znDsD/view?usp=sharing",src:"وزارة التعليم"},
    {title:"ميثاق أخلاقيات مهنة التعليم",desc:"مبادئ وقيم مهنة التعليم وسلوكياتها المهنية.",kind:"ميثاق",url:"https://drive.google.com/file/d/11VzU583QOvvP10DJ6Y9CfDsFI2hqUzSF/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"},
    {title:"الخطة الإجرائية لتعزيز الانضباط المدرسي",desc:"خطة عملية لتعزيز الانضباط المدرسي ومتابعته.",kind:"خطة إجرائية",url:"https://drive.google.com/file/d/1hA28lIXMq9D3e1PF8ilYnUEhmGb6jxAp/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"},
    {title:"خطة الانضباط التعليمي في شهر رمضان المبارك 1447هـ",desc:"خطة إجرائية لتعزيز الانضباط المدرسي وضبط الحضور والسلوك خلال شهر رمضان المبارك.",kind:"خطة إجرائية استرشادية",url:"https://drive.google.com/file/d/1Kp9Kx44vPzaZn9UdqSU4EXSdfTRYiYFa/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"},
  ],
  policies: [
    {title:"الدليل التنظيمي لمدارس التعليم العام",desc:"مهام وصلاحيات المدرسة وهيكلها.",kind:"دليل",url:"https://drive.google.com/file/d/1E604s0Wni9ht-UnfaB4ywlN55YyjW9Wj/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل إرشادي للحفاظ على الوثائق والاتصالات",desc:"حفظ الملفات والمراسلات وفق الضوابط.",kind:"دليل",url:"https://drive.google.com/file/d/1T4DbU8mJDQyC1c9yvvjeKoC8MKZBr420/view",src:"وزارة التعليم"},
    {title:"أطر العمل التنظيمية للائحة التنفيذية للموارد البشرية",desc:"أطر تنظيمية للائحة التنفيذية.",kind:"أطر",url:"https://drive.google.com/file/d/1StNX-WFOAAd03qd1pEqKsST0oKEh4qQ5/view?usp=sharing",src:"الموارد البشرية والتنمية الاجتماعية"},
    {title:"الدليل الإجرائي للائحة فحوصات اللياقة المهنية والأمراض غير المعدية",desc:"دليل تنظيمي وإجرائي لفحوصات اللياقة المهنية والأمراض غير المعدية.",kind:"دليل",url:"https://drive.google.com/file/d/1h15thG914RxWAbSu_ZcNDas2EYXV8IHK/view?usp=sharing",src:"وزارة الموارد البشرية والتنمية الاجتماعية",addedAt:"2026-06-22"},
    {title:"لائحة الوظائف التعليمية 1446",desc:"اللائحة المنظمة لشاغلي الوظائف التعليمية.",kind:"لائحة",url:"https://drive.google.com/file/d/1RnBsFXcZEuIXzdBW-rcSgsjbrxXtTN5U/view?usp=sharing",src:"وزارة التعليم"},
    {title:"نظام العمل",desc:"النظام المنظم لعلاقات العمل.",kind:"نظام",url:"https://drive.google.com/file/d/14virdwgj48hZPSqNtLhlR8Qdt_xjKgWz/view?usp=sharing",src:"الموارد البشرية والتنمية الاجتماعية"},
    {title:"الدليل الإرشادي لإدارة الأداء الوظيفي لشاغلي الوظائف التعليمية (الإصدار الثاني) 1447هـ–2025م",desc:"منهجية إدارة الأداء لشاغلي الوظائف التعليمية.",kind:"دليل",url:"https://drive.google.com/file/d/11jh2Bm5oEMiiSHy-prjZ0CxxMMeCJC2s/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الدليل الإرشادي للجدارات",desc:"إطار مرجعي للجدارات المهنية والتعليمية.",kind:"دليل",url:"https://drive.google.com/file/d/1dr09uQ7u5hdlghwrtpLGFsjR35XTZfP/view?usp=sharing",src:"وزارة التعليم"},
    {title:"المركز الوطني للمناهج — دليل الوثيقة التعريفية لمرحلة الثانوية العامة",desc:"تعريف بوثيقة المرحلة الثانوية ومساراتها.",kind:"دليل",url:"https://drive.google.com/file/d/1eX_OGdyNl7fMb_xapBDSzdvrBeZBr5BT/view?usp=sharing",src:"المركز الوطني للمناهج"},
    {title:"دليل التحول إلى نموذج الخدمات المركزي",desc:"مرجع لتحول إدارات التعليم إلى نموذج الخدمات المركزي.",kind:"دليل",url:"https://drive.google.com/file/d/1vYJlzeQXbxQI5Au-Q8wiNruc9XCxSzoS/view?usp=sharing",src:"وزارة التعليم"},
    {title:"منح مديري ومديرات المدارس الصلاحيات",desc:"ضوابط تنظيم ومنح الصلاحيات لقادة المدارس.",kind:"تعميم",url:"https://drive.google.com/file/d/166h6cj6lRPBMSro_HRNoltRQPj8LLxPq/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"},
    {title:"الدليل التنظيمي لوزارة التعليم - (اصدار ثاني محدث) - للعام (1447 هـ - 2025 م)",desc:"دليل الاهداف والمهام محدث اصدار ثاني.",kind:"دليل",url:"https://drive.google.com/file/d/1Jv5CHtfmXV3UDERZdjTXr7Q6msWQiL1c/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-1-20"}
],
  staff: [
    {title:"وثيقة التشكيلات الإشرافية والمدرسية لشاغلي الوظائف التعليمية (وكالة الموارد البشرية) 1445هـ–2024م",desc:"تنظيم الهياكل والتشكيلات الإشرافية والمدرسية.",kind:"وثيقة",url:"https://drive.google.com/file/d/1aXEQ1jJRA_Sa-w-Cv436B2DTY1PNpnn/view?usp=sharing",src:"وكالة الموارد البشرية — وزارة التعليم"},
    {title:"دليل الاستثمار الأمثل لشاغلي الوظائف التعليمية",desc:"تعظيم الاستفادة من الكفاءات التعليمية.",kind:"دليل",url:"https://drive.google.com/file/d/1MlINioNLhRXmIzhRQzt-eSMpuRkXhPVh/view?usp=sharing",src:"وزارة التعليم"},
    {title:"آلية تنفيذ مرحلة التهيئة لبرنامج تطوير القيادات المدرسية 2026م",desc:"خطوات تهيئة قادة المدارس ضمن برنامج التطوير المهني 2026.",kind:"دليل",url:"https://drive.google.com/file/d/14mPpdnqQdvNj5ipa4AS-lTjz309o1Gpl/view?usp=sharing",src:"وزارة التعليم"},
    {title:"القواعد التنظيمية لنقل وتكليف شاغلي الوظائف التعليمية ذوي الظروف الخاصة",desc:"ضوابط وإجراءات النقل والتكليف للحالات ذات الظروف الخاصة.",kind:"قواعد",url:"https://drive.google.com/file/d/1z968r5Psl7-TO4gIG1ZbBwDAi0AQrGTd/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الأسئلة الشائعة للقواعد التنظيمية لنقل وتكليف ذوي الظروف الخاصة",desc:"توضيحات وإجابات لأبرز الاستفسارات حول القواعد التنظيمية.",kind:"أسئلة شائعة",url:"https://drive.google.com/file/d/1U9YsPQFjwtzFc7UY1AffT6B1kXna2mZy/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الأسئلة الشائعة: تسكين الموظفين في الهيكل التنظيمي بنظام فارس",desc:"توضيحات حول آلية تسكين الموظفين ضمن الهيكل التنظيمي عبر نظام فارس.",kind:"أسئلة شائعة",url:"https://drive.google.com/file/d/1OXlh4F_HOZMhaCsVlXLsnkavv2HqHZ52/view?usp=sharing",src:"وزارة التعليم — نظام فارس"},
    {title:"القواعد التنظيمية لشاغلي الوظائف التعليمية",desc:"الصلاحيات والواجبات المهنية.",kind:"قواعد",url:"https://drive.google.com/file/d/17HJEFDY0lCkio24cY6dAN7xD0N8bt_AI/view",src:"وزارة التعليم"},
    {title:"الدليل المبسّط لتقييم أداء شاغلي الوظائف التعليمية",desc:"خطوات عملية لتقويم الأداء.",kind:"دليل",url:"https://drive.google.com/file/d/1nI-G3DRY1MhK0t9PLu-P8PcouAY22G5f/view?usp=sharing",src:"وزارة التعليم"},
    {title:"نماذج تقييم أداء شاغلي الوظائف التعليمية",desc:"نماذج معتمدة لتوثيق الأداء.",kind:"نماذج",url:"https://drive.google.com/file/d/16PvCHjoi_SvgdrNFbdT0H5vMJvSzYn7/view",src:"وزارة التعليم"},
    {title:"تهيئة الموظف الجديد على نظام فارس (دليل مستخدم)",desc:"خطوات التهيئة واستخدام فارس.",kind:"دليل",url:"https://drive.google.com/file/d/15idPnrerHN3eJT7Pu_xePZduJZKL7hd/view",src:"وزارة التعليم"},
    {title:"دليل تخطيط شاغلي الوظائف التعليمية في إدارات التعليم",desc:"تخطيط الموارد البشرية التعليمية.",kind:"دليل",url:"https://drive.google.com/file/d/14x89e8QNvMwJrfrzN5U1FzWeOlp-Czyk/view",src:"وزارة التعليم"},
    {title:"إسناد تدريس المواد التي ليس لها تخصص",desc:"تنظيم الإسناد وضوابطه.",kind:"ضوابط",url:"https://drive.google.com/file/d/153qd1HGE5B3N7bxYGxG9mUCYKqwh_Srd/view",src:"وزارة التعليم"},
    {title:"دليل المخاطبات والتحرير الإداري (الإصدار الثالث) 1447هـ – 2025م",desc:"ضوابط وصيغ المخاطبات الرسمية والتحرير الإداري.",kind:"دليل",url:"https://drive.google.com/file/d/1GKyy4xmMqaRa-5qLRx4w2YwkCKXlWXoZ/view?usp=drive_link",src:"وزارة التعليم"},
    {title:"الدليل الإرشادي لإدارة الأداء الوظيفي لشاغلي الوظائف التعليمية (الإصدار الثاني) 1447هـ – 2025م",desc:"منهجية إدارة الأداء لشاغلي الوظائف التعليمية.",kind:"دليل",url:"https://drive.google.com/file/d/1h76lUCBP4lO2qeFLkqbCDDVlJY_IPm7o/view?usp=drive_link",src:"وزارة التعليم"},
    {title:"دليل برنامج مجتمعات تبادل المعرفة للمعلم الجديد",desc:"تهيئة ودعم المعلم الجديد عبر مجتمعات تبادل المعرفة.",kind:"دليل",url:"https://drive.google.com/file/d/1kYuJMSiDySnXGVWbS7TOFmf-45YmWkUK/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الأسئلة الشائعة لبرنامج الابتعاث الخارجي لدراسة الماجستير",desc:"إجابات لأبرز الاستفسارات الخاصة بالابتعاث للماجستير.",kind:"أسئلة شائعة",url:"https://drive.google.com/file/d/11amN1u-XWVSOOouJv5WN-YIc7jFiacRc/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل برنامج الابتعاث الخارجي لدراسة الماجستير لشاغلي الوظائف التعليمية",desc:"الإطار والضوابط والإجراءات للابتعاث للماجستير.",kind:"دليل",url:"https://drive.google.com/file/d/1aP7ZOTMthNui6TYbGTtY3cgU1aLtC85q/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الأسئلة الشائعة لدليل القواعد التنظيمية لنقل وتكليف شاغلي الوظائف التعليمية",desc:"أسئلة متكررة مكملة للقواعد التنظيمية.",kind:"أسئلة شائعة",url:"https://drive.google.com/file/d/1EtkF6qQ2CcYppSA6ZOSiIDNzL7PD2V6-/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل القواعد التنظيمية لنقل وتكليف شاغلي الوظائف التعليمية",desc:"دليل تطبيقي لإجراءات النقل والتكليف.",kind:"دليل",url:"https://drive.google.com/file/d/1SXdP30upA59pQnarX9lG8lWu4clhGcOh/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل القواعد التنظيمية لبرنامج فرص",desc:"ضوابط وآليات برنامج فرص لشاغلي الوظائف التعليمية.",kind:"دليل",url:"https://drive.google.com/file/d/1_wR6GRu61SmD57Id-UqVBQSFifB-ioz3/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الأسئلة الشائعة لبرنامج فرص",desc:"توضيحات حول برنامج فرص وإجراءاته.",kind:"أسئلة شائعة",url:"https://drive.google.com/file/d/1uhMKoVU8e589y_FUeFJuFychUg926qlf/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل اعتماد وتنفيذ أنشطة (التطوير المهني التعليمي)",desc:"إجراءات اعتماد وتنفيذ أنشطة التطوير المهني التعليمي لشاغلي الوظائف التعليمية.",kind:"دليل",url:"https://drive.google.com/file/d/1MWtVAXOgDjrJL3BBKtuawuazd_7fbByD/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل احتساب نقاط التطوير المهني للترقية في لائحة الوظائف التعليمية",desc:"آلية احتساب نقاط التطوير المهني لأغراض الترقية.",kind:"دليل",url:"https://drive.google.com/file/d/1Nc4aNIWmMRSZfLtz_8Aq5dUYhRuIPyhh/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-1-20"}
  ],
 platformsOps: [
  {title:"دليل الأسئلة الشائعة لخدمات بوابة التعليم",desc:"إجابات لأبرز الاستفسارات حول استخدام بوابة التعليم وخدماتها التعليمية والإدارية والدعم.",kind:"أسئلة شائعة",url:"https://drive.google.com/file/d/1BKaetYAiud8SdKwYZQ7Xdhz6JWjyBJ2q/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-04-27"},
  {title:"الدليل المبسّط لنظام نور",desc:"خطوات سريعة في نور.",kind:"دليل",url:"https://noor.moe.gov.sa/userguides/",src:"وزارة التعليم"},
  {title:"عمليات القبول في المدارس",desc:"إجراءات القبول والتسجيل.",kind:"دليل",url:"https://drive.google.com/file/d/1F_avKmTOrN9SfCB7J3BJUF_q9NCJQBHP/view?usp=sharing",src:"وزارة التعليم"},
  {title:"خدمة متابعة حالات الطلبة في نظام نور",desc:"متابعة تحصيلية وسلوكية.",kind:"دليل",url:"https://drive.google.com/file/d/15t7S2de_uzWuQvjQAIl60C1_Nkf_DhHS/view",src:"وزارة التعليم"},
  {title:"دليل الخطط الدراسية",desc:"بناء وتخطيط الخطط الدراسية.",kind:"دليل",url:"https://drive.google.com/file/d/1jLtxUE_wF9-as7GhUEFmCTBcNTBQ2Kue/view?usp=sharing",src:"وزارة التعليم"},
  {title:"دليل الخطط الدراسية (نسخة)",desc:"نسخة إضافية للدليل المعتمد.",kind:"دليل",url:"https://drive.google.com/file/d/1lU6gJxY13GfrIHK7Md6T5xELZqSjEMx8/view?usp=sharing",src:"وزارة التعليم"},
  {title:"دليل المجال الاختياري",desc:"إرشادات رصد وتقويم المجال الاختياري.",kind:"دليل",url:"https://drive.google.com/file/d/1-hDzrrpMvQirRzZj342ghp0KKfFrzf4/view",src:"وزارة التعليم"},
  {title:"دليل المستخدم لخدمة معادلة الشهادات",desc:"طريقة استخدام خدمة معادلة الشهادات عبر المنصات الرسمية.",kind:"دليل مستخدم",url:"https://drive.google.com/file/d/1o1ogm37x2FMAuh2hoOax9SqHaQyDix7m/view?usp=sharing",src:"وزارة التعليم"}
],
  uniform: [
    {title:"دليل الزي المدرسي والرياضي لطلبة التعليم العام",desc:"المواصفات المعتمدة للزي.",kind:"دليل",url:"https://drive.google.com/file/d/1dJaj5cH6sUOpUh2shay36xH7FctVxZXh/view?usp=sharing",src:"وزارة التعليم"}
  ],
  forms: [
    {title:"استمارة الزيارة الفني لمشرف الإدارة المدرسية",desc:"معايير ومؤشرات وتوصيات.",kind:"نموذج",url:"https://drive.google.com/file/d/1Q2SnbnnteJCIgyz8WZCESV01Jk_3rPMh/view",src:"وزارة التعليم"},
    {title:"نموذج الحصص الأسبوعية في الفصلين",desc:"توزيع الحصص للأسبوع الدراسي.",kind:"نموذج",url:"https://drive.google.com/file/d/157rFurVpjSpxV6o7pRfMTZInLGMv5rjx/view",src:"وزارة التعليم"},
    {title:"نموذج الحصص الأسبوعية في الفصلين — نسخة",desc:"نسخة إضافية للنموذج المعتمد.",kind:"نموذج",url:"https://drive.google.com/file/d/198fELpFFSTf2DC08w0T44SUrAO4ZhOX9/view?usp=sharing",src:"وزارة التعليم"},
    {title:"نموذج استرشادي للحصص الدراسية خلال 36 أسبوعًا",desc:"تخطيط زمني للحصص على مدار العام.",kind:"نموذج",url:"https://drive.google.com/file/d/1zFVc-Qod32G-Q3eGwBDlfg7elOP-SNWY/view?usp=sharing",src:"وزارة التعليم"},
    {title:"نموذج حجز موعد / استدعاء ولي الأمر",desc:"نموذج رسمي للتواصل مع ولي الأمر.",kind:"نموذج",url:"https://drive.google.com/file/d/1ynR-bkrzI7RHWOg-j8FQ1aNvp8LoY1dx/view?usp=sharing",src:"وزارة التعليم"},
    {title:"بطاقة زيارة مدرسة للمشرف التربوي",desc:"نموذج معتمد لتوثيق زيارة المشرف التربوي للمدرسة.",kind:"نموذج",url:"https://drive.google.com/file/d/1rGqq0tDOSZgGpqwearcAlvgdP637IcEu/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-1-20"}
  ],
  inclusive: [
    {title:"القواعد التنظيمية لفصول ومدارس الموهوبين",desc:"تنظيم البرامج والمسارات.",kind:"قواعد",url:"https://drive.google.com/file/d/15g8C3aVaStWcftLa4toBJQtP-2wP113O/view",src:"وزارة التعليم"},
    {title:"ضوابط تسريع انتقال الطلبة الموهوبين 1447هـ",desc:"آليات وإجراءات التسريع الأكاديمي.",kind:"ضوابط",url:"https://drive.google.com/file/d/15ekZaGwDQY2PJSk7yyAbctOvx0gZghsw/view",src:"وزارة التعليم"},
    {title:"مختصر حقيبة تفاعلية لنواتج تعلم أفضل (15-5-1447هـ)",desc:"ملخّص عملي لتحسين نواتج التعلم.",kind:"مختصر",url:"https://drive.google.com/file/d/1emdta_YyOhWk6a__fbe7Idx2GRszi8xd/view?usp=sharing",src:"وزارة التعليم"},
    {title:"إطار الاحتفاء والتكريم للطلاب والطالبات في المدارس",desc:"منهجية تكريم ذات أثر محفّز.",kind:"إطار",url:"https://drive.google.com/file/d/1eK1WzZ3rvtHorRF0pQiKtN39Ap_uuWpL/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل التدخلات التربوية",desc:"إرشادات التدخلات التربوية لدعم تعلم الطلبة.",kind:"دليل",url:"https://drive.google.com/file/d/1SFcTcKKBUGq2K-3JrTDp5Lh10rnE1sxe/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-1-20"}
  ],
  safety: [
    {title:"الدليل الإجرائي للموجّه الصحي في المدارس",desc:"إجراءات الصحة المدرسية والتثقيف الصحي.",kind:"دليل",url:"https://drive.google.com/file/d/13mFzGRLBmaJskESO_Ik3cmqWqfLHlHDR/view?usp=sharing",src:"وزارة التعليم"},
    {title:"دليل الإسعافات الأولية",desc:"مرشد للإسعافات الأولية في المدرسة.",kind:"دليل",url:"https://drive.google.com/file/d/1_Gx1fXlb6whQ_g9yr_q6b-07v6GrIIWP/view?usp=sharing",src:"وزارة التعليم"},
    {title:"المجلس الوطني للسلامة والصحة المهنية — دليل فحص اللياقة المهنية",desc:"متطلبات الفحص واللياقة المهنية.",kind:"دليل",url:"https://drive.google.com/file/d/1iwG07if-AoD6a-jy4dJpz1kVnWKkht9P/view?usp=sharing",src:"جهات وطنية"}
  ],
  elearn: [
    {title:"دليل مدير المدرسة - الإصدار الثاني",desc:"دليل إجرائي يوضح أدوار مدير المدرسة في التعليم الإلكتروني وآليات المتابعة والتنظيم.",kind:"دليل",url:"https://drive.google.com/file/d/12LCm-FQOUBnOpWC_DiLAs-i2HLU35N7B/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-04-22"},
    {title:"دليل المعلم - الإصدار الثاني",desc:"دليل يوضح مهام المعلم وإجراءات التنفيذ في التعليم الإلكتروني.",kind:"دليل",url:"https://drive.google.com/file/d/1_hULAniW2SSQRkG1ccn4Rpry9WFRuenQ/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-04-22"},
    {title:"دليل ولي الأمر - الإصدار الثاني",desc:"دليل يوضح دور ولي الأمر في دعم الطالب ومتابعته في التعليم الإلكتروني.",kind:"دليل",url:"https://drive.google.com/file/d/1d_TT8Jej4L0xeiLqDXpyuPC8AGdr5ZwU/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-04-22"},
    {title:"دليل الطالب - الإصدار الثاني",desc:"دليل إرشادي يوضح للطالب آليات الاستفادة من التعليم الإلكتروني ومتطلباته.",kind:"دليل",url:"https://drive.google.com/file/d/12LahYMM2DYSaiNtcND_UrjxqA4RKUe6_/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-04-22"},
    {title:"الدليل الإرشادي للانتقال من التعليم الحضوري إلى التعليم عن بعد",desc:"آليات التحول للتعلم عن بعد.",kind:"دليل",url:"https://drive.google.com/file/d/1t0soxVEaEm6BEwpeCaY3cRMUsNEdre6k/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-12-17"},
    {title:"دليل قواعد (التعليم الإلكتروني) لإدارات التعليم - (الإصدار الأول)",desc:"قواعد وضوابط تنظيم التعليم الإلكتروني على مستوى إدارات التعليم.",kind:"قواعد",url:"https://drive.google.com/file/d/15zvPyL1OCzqMfbE6uoKf-lasWjJzEIhg/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-12-17"},
    {title:"دليل السلوك الرقمي لمنصة مدرستي",desc:"استخدام آمن ومسؤول.",kind:"دليل",url:"https://drive.google.com/file/d/19ym1Uih9GbXyHhDRcpP1qlk-kbgGfjQ_/view",src:"وزارة التعليم"},
    {title:"دليل الانتقال من التعليم الحضوري إلى التعليم عن بعد",desc:"آليات التحول للتعلم عن بعد.",kind:"دليل",url:"https://drive.google.com/file/d/1s-rEuHph2XmZxm1sfy7en6ZD7HDRYXyO/view?usp=sharing",src:"وزارة التعليم"},
    {title:"سياسة الاستخدام والخصوصية لمنصة مدرستي",desc:"سياسة الاستخدام والخصوصية.",kind:"سياسة",url:"https://drive.google.com/file/d/1wF_m9vtZkBTAxbsHgoIm_rnjSQhNNvo0/view?usp=sharing",src:"وزارة التعليم"},
    {title:"القواعد التنفيذية للائحة التعليم الإلكتروني",desc:"قواعد تنفيذية لتنظيم التعليم الإلكتروني.",kind:"قواعد تنفيذية",url:"https://drive.google.com/file/d/1DOvnk2JgYQO0c1Dc8o20DRwPrDUYkrea/view?usp=sharing",src:"وزارة التعليم"}
  ],
  counseling: [
    {title:"خطة التوعية بمنصة قبول",desc:"خطة توعوية وإجرائية لدعم الطلاب وتهيئتهم لاستخدام منصة قبول.",kind:"خطة",url:"https://drive.google.com/file/d/1qfgnj7_AgbUq04bVzwr_5sZ4cRYT0PST/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-12-19"},
    {title:"تعزيز السلوك الإيجابي",desc:"برامج تعزيز السلوك.",kind:"دليل",url:"https://drive.google.com/file/d/1EA5oYQ4PtSxM_rLjbgm9c4iQJATDTEKq/view",src:"وزارة التعليم"},
    {title:"دليل التوجيه وقت الأزمات",desc:"أدوار وتدخلات أثناء الأزمات.",kind:"دليل",url:"https://drive.google.com/file/d/1Cr4LULa-HDsIo49UrFvMq80hZO1YLs9Q/view",src:"وزارة التعليم"},
    {title:"خطة برامج وخدمات التوجيه الطلابي",desc:"حزمة برامج وخدمات إرشادية.",kind:"خطة",url:"https://drive.google.com/file/d/1BNrzJ4mNuw4gumB0wN1o5Ih9vMNRcWrM/view",src:"وزارة التعليم"},
    {title:"الدليل الاسترشادي لأبرز الخدمات التقنية للتوجيه الطلابي في نظام نور",desc:"شرح الخدمات الرقمية الداعمة للتوجيه عبر نور.",kind:"دليل",url:"https://drive.google.com/file/d/1CSM9tTP6b5RrvmuajOOEFLJNKHzejfTW/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الدليل الاسترشادي لبرامج وخدمات التوجيه الطلابي — نسخة",desc:"نسخة إضافية للدليل المعتمد.",kind:"دليل",url:"https://drive.google.com/file/d/1ERsDW7c_ReFF0Sa2KhzZKB8wkDKKNjhU/view?usp=sharing",src:"وزارة التعليم"},
    {title:"التوجيه وقت الأزمات — دليل (نسخة)",desc:"نسخة أخرى من دليل التوجيه وقت الأزمات.",kind:"دليل",url:"https://drive.google.com/file/d/16-YjeHhz0d4Z8FnG6a88ipz30majKOWO/view?usp=sharing",src:"وزارة التعليم"},
    {title:"الدليل الإجرائي لمؤشرات التوجيه الطلابي في ضوء تمكين المدرسة",desc:"مؤشرات وإجراءات للتوجيه الطلابي.",kind:"دليل إجرائي",url:"https://drive.google.com/file/d/1KECIXVNAuGIfHgcr4cFZkTZ7RjDEDzNP/view?usp=sharing",src:"وزارة التعليم"},
    {title:"رصد السلوك الإيجابي في نظام نور",desc:"إرشادات رصد السلوك الإيجابي وتوثيقه عبر نظام نور.",kind:"دليل",url:"https://drive.google.com/file/d/17zltfHuIawEAJMFrk0DnZXM1gaXkk9TU/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-1-20"}
  ],
  kg: [
  {title:"اللائحة التنفيذية لحماية الطفل",desc:"اللائحة التنفيذية لحماية الطفل (وزارة الموارد البشرية والتنمية الاجتماعية).",kind:"لائحة",url:"https://drive.google.com/file/d/1ms8rn2IriD-Q9XK8-8tw5Hmm73hNsT9X/view?usp=sharing",src:"الموارد البشرية والتنمية الاجتماعية",addedAt:"2026-03-05"},
  {title:"دليل مدارس الطفولة المبكرة (الإصدار الأول 1440-1441هـ)",desc:"مرجع تنظيمي لمدارس الطفولة المبكرة (الإصدار الأول 1440-1441هـ).",kind:"دليل",url:"https://drive.google.com/file/d/1PtpKN11ixOTt3aLp1OV_wTa3yS60YBUm/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-03-05"},
  {title:"الدليل التنظيمي للحضانة ورياض الأطفال (1438-1439)",desc:"تنظيم العمل في رياض الأطفال.",kind:"دليل",url:"https://drive.google.com/file/d/1BzZtwzOQtO45A5A3SCq5j6XqbwEZOkDT/view",src:"وزارة التعليم"},
  {title:"الدليل التنظيمي لرياض الأطفال",desc:"الدليل التنظيمي لرياض الأطفال.",kind:"دليل",url:"https://drive.google.com/file/d/1B-2Z1yIt8g8xC0FA9pZgcyh61cmsbxN-/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-03-05"},
  {title:"الضوابط التنظيمية لمرحلة الحضانة",desc:"ضوابط تنظيمية لمرحلة الحضانة.",kind:"ضوابط",url:"https://drive.google.com/file/d/1Sn5IBMcre8pvDrduvXLYsbSEF37mi4Dw/view?usp=sharing",src:"وزارة التعليم"},
  {title:"الضوابط التنظيمية لمرحلة رياض الأطفال",desc:"ضوابط تنظيمية لرياض الأطفال.",kind:"ضوابط",url:"https://drive.google.com/file/d/1nGK7AoQKlHZasAmKwPv3OTRzSUU-V24h/view?usp=sharing",src:"وزارة التعليم"}
],
interactive: [
  {title:"الدليل الإجرائي للتقويم الذاتي",desc:"خطوات تنفيذ عمليات التقويم الذاتي في المدرسة.",kind:"دليل",url:"https://drive.google.com/file/d/1vR6oXWbYBwi7pqdX3V5ZCJlRsoyGrSzF/view?usp=sharing",src:"وزارة التعليم"},
  {title:"الدليل الاسترشادي لأخصائي التقويم المدرسي",desc:"إرشادات العمل والتنفيذ لأخصائي التقويم المدرسي.",kind:"دليل",url:"https://drive.google.com/file/d/1TZMiqOJCbYZlOwGZATyg5q9Nko_1KvHw/view?usp=sharing",src:"وزارة التعليم"},
  {title:"دليل الخدمات الإلكترونية للتقويم والاعتماد المدرسي (الإصدار الأول 2023)",desc:"منظومة الخدمات الإلكترونية للتقويم والاعتماد المدرسي.",kind:"دليل",url:"https://drive.google.com/file/d/11ZkLI5dxsivSW8KC-FX734As1jBfk3U_/view?usp=sharing",src:"وزارة التعليم"},
  {title:"قائمة الملفات والسجلات الأساسية",desc:"حصر السجلات والملفات الأساسية لعمل التقويم المدرسي.",kind:"قائمة",url:"https://drive.google.com/file/d/1dUGen3NJDbIfcCMwyFO9uvBEIkyifdH4/view?usp=sharing",src:"وزارة التعليم"},
  {title:"الدليل الإجرائي للتقويم الذاتي لمدارس الطفولة المبكرة ورياض الأطفال",desc:"آليات التقويم الذاتي لمدارس الطفولة المبكرة ورياض الأطفال.",kind:"دليل",url:"https://drive.google.com/file/d/1jKCt3ho7k47TTaVk0HPRhrZVbibPj_9s/view?usp=sharing",src:"وزارة التعليم"},
  {title:"خريطة نواتج التعلم",desc:"خريطة مرجعية لنواتج التعلم لتحسين التقويم والمتابعة.",kind:"خريطة",url:"https://drive.google.com/file/d/1Ht6HA3YXRkoKVM36w8fbIdXDsoHzR0dR/view?usp=sharing",src:"وزارة التعليم",addedAt:"2025-11-19"},
  {title:"معايير التقويم والاعتماد المدرسي لمدارس التعليم العام 2026م",desc:"مرجع معايير التقويم والاعتماد المدرسي (إدارة تعليم حائل).",kind:"معايير",url:"https://drive.google.com/file/d/1JRJaWiUaHIt8CGKXQ5Zz4D3B7fQj1S2c/view?usp=sharing",src:"إدارة تعليم حائل",addedAt:"2026-02-22"},
  {title:"الدليل الإجرائي للتقويم المدرسي الذاتي للتعليم العام (الإصدار الثالث 1447هـ - 2026م)",desc:"الإصدار الثالث من الدليل الإجرائي للتقويم المدرسي الذاتي للتعليم العام.",kind:"دليل",url:"https://drive.google.com/file/d/1q5_-s-kSVOuSukIAe5CkkshLALHURMtJ/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-03-30"},
],
 guides: [
  {title:"الدليل العام لمنصة العمل التطوعي",desc:"مرجع استخدام المنصة الوطنية للعمل التطوعي.",kind:"دليل",url:"https://drive.google.com/file/d/1K8YJKNgVFSsQXOMisTTHiUydE6qQOGF8/view?usp=sharing",src:"وزارة الموارد البشرية والتنمية الاجتماعية"},
  {title:"أدلة ونماذج العمل التطوعي والمسؤولية المجتمعية",desc:"حزمة أدلة ونماذج للتطوع والمسؤولية المجتمعية.",kind:"أدلة ونماذج",url:"https://drive.google.com/file/d/1NuA1Wsaq_yrmFyyN1kIg_SE8wE8SD4t2/view?usp=sharing",src:"جهات رسمية وتعليمية"},
  {title:"طريقة التسجيل في منصة التطوع",desc:"شرح خطوات التسجيل في المنصة الوطنية للتطوع.",kind:"إرشادات",url:"https://drive.google.com/file/d/1Rzlq0XJIZRvvrz7PsbxGS4Kt27iyum0C/view?usp=sharing",src:"وزارة الموارد البشرية والتنمية الاجتماعية"},
  {title:"حوكمة تصميم الفرص التطوعية",desc:"منهجية وضوابط تصميم فرص تطوعية ذات أثر.",kind:"حوكمة",url:"https://drive.google.com/file/d/1AoMuzLJrGY0u08l-35nQfYSmbZCYv-v1/view?usp=sharing",src:"جهات تنظيمية"},
  {title:"دليل إجراءات تفعيل الفرص التطوعية",desc:"خطوات عملية لتفعيل وتنفيذ الفرص.",kind:"دليل إجراءات",url:"https://drive.google.com/file/d/18TXQsp7uvAHCFF2RsPWka_AXRH7z-HLB/view?usp=sharing",src:"جهات تنظيمية"},
  {title:"دليل حوكمة الشراكات والاتفاقات",desc:"إطار حوكمة للشراكات والاتفاقات مع الجهات المختلفة.",kind:"دليل",url:"https://drive.google.com/file/d/1mJEedJWEmh46KaPb-pDcNTMwpWU4HF0l/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-1-20"},
  {title:"مسودة بنك الفرص التطوعية المدرسية ٢٠٢٥م ",desc:"الإدارة العامة للمسؤولية المجتمعية والعمل التطوعي.",kind:"مسودة",url:"https://drive.google.com/file/d/1d0dviIearUU8nY4EB0BAVj9LMWVCUmmN/view?usp=sharing",src:"وزارة التعليم",addedAt:"2026-2-22"}
],
};

const CUSTOM_DOCS = {
  grading: [
    /*
    {
      title: "عنوان الدليل",
      desc: "وصف مختصر",
      kind: "دليل",
      url: "رابط الملف",
      src: "المصدر",
      addedAt: "2026-06-29"
    }
    */
  ],
  exams: [
    /*
    {
      title: "عنوان دليل الاختبارات",
      desc: "وصف مختصر",
      kind: "دليل",
      url: "رابط الملف",
      src: "المصدر",
      addedAt: "2026-06-29"
    }
    */
  ],
  attendance: [],
  facilities: [],
  conduct: [],
  excellence: [],
  staff: [],
  rules: [],
  platformsOps: [],
  ministerial: [],
  inclusion: [],
  digital: [],
  safety: [],
  guides: [],
  kg: [],
  volunteer: [],
  interactive: []
};

function mergeCustomDocs(){
  Object.keys(CUSTOM_DOCS || {}).forEach(key=>{
    if(!Array.isArray(CUSTOM_DOCS[key]) || !CUSTOM_DOCS[key].length) return;
    if(!Array.isArray(CATALOG[key])) CATALOG[key]=[];
    CATALOG[key].push(...CUSTOM_DOCS[key]);
  });
  window.__docsCounts = Object.fromEntries(ORDER.map(key=>[key,(CATALOG[key]||[]).length]));
}

/* الرسم للأدلّة */
function renderDocs(){
  const host=document.getElementById('docsCols'); if(!host) return;
  host.innerHTML='';
  host.className='columns';
  let restoredNewCount=0;
  const restoredGroups = ORDER.map((key,i)=>{
    const items=(CATALOG[key]||[]).slice().sort((a,b)=>{
      const aL=isLatest(a), bL=isLatest(b);
      if(aL!==bL) return bL - aL;
      const aObj = a.addedAt ? parseYMD(a.addedAt) : null;
      const bObj = b.addedAt ? parseYMD(b.addedAt) : null;
      const aD = aObj ? aObj.getTime() : 0;
      const bD = bObj ? bObj.getTime() : 0;
      if(aD!==bD) return bD - aD;
      return a.title.localeCompare(b.title,'ar',{numeric:true});
    });

    items.forEach(d=>{ if(isLatest(d)) restoredNewCount++; });
    return {key,index:i+1,title:GROUP_TITLES[key]||'قسم',items};
  });
  const restoredTotal = restoredGroups.reduce((sum,g)=>sum+g.items.length,0);

  function restoredRowHTML(d){
    const ok = isValidUrl(d.url);
    const id = driveId(d.url);
    const canDl = ok && !!id;
    const dl = canDl ? toDirect(d.url) : "";
    const latest = isLatest(d);
    return `
      <div class="row">
        <div>
          <div class="title">${esc(d.title)}</div>
          ${d.desc?`<div class="desc">${esc(d.desc)}</div>`:''}
          <div>
            ${d.kind?`<span class="badge">${esc(d.kind)}</span>`:''}
            ${d.src?`<span class="badge">${esc(d.src)}</span>`:''}
            ${latest?'<span class="badge new">جديد</span>':''}
            ${ok?"":'<span class="badge warn">بحاجة لتحديث الرابط</span>'}
          </div>
        </div>
        <div class="actions">
          <a class="btn open" ${ok ? 'target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="'+esc(d.url)+'"' : 'aria-disabled="true" tabindex="-1"'}>فتح</a>
          <a class="btn download" ${canDl ? 'href="'+esc(dl)+'"' : 'aria-disabled="true"'}>تحميل</a>
        </div>
      </div>
    `;
  }

  restoredGroups.forEach(group=>{
    const det=document.createElement('details');
    det.className='group';
    det.dataset.i=group.index;
    det.open = false;
    det.innerHTML=`
      <summary>
        <span class="doc-folder">📁</span>
        <span class="gtitle">${esc(group.title)}</span>
        <span class="gcount">${group.items.length}</span>
      </summary>
      <div class="wrap">
        ${group.items.length ? group.items.map(restoredRowHTML).join('') : '<div class="search-empty">لا توجد روابط مضافة هنا بعد.</div>'}
      </div>
    `;
    host.appendChild(det);
  });

  const restoredAnnounce=document.getElementById('announce');
  if(restoredAnnounce){
    if(restoredNewCount>0){
      restoredAnnounce.style.display='flex';
      restoredAnnounce.querySelector('.txt').textContent = `تمت إضافة ${restoredNewCount} عنصر جديد خلال اليومين الماضيين.`;
      const restoredCloseBtn = restoredAnnounce.querySelector('.close');
      if(restoredCloseBtn) restoredCloseBtn.onclick = ()=>{ restoredAnnounce.style.display='none'; };
    }else{
      restoredAnnounce.style.display='none';
    }
  }

  const restoredCountEl = document.getElementById('docsCount');
  if(restoredCountEl) restoredCountEl.textContent = `(${restoredTotal} ملف/دليل)`;
  const academyFilesCountEl = document.getElementById('academyFilesCount');
  if(academyFilesCountEl) academyFilesCountEl.textContent = String(restoredTotal);
  return;
  let newCount=0;
  const groups = ORDER.map((key,i)=>{
    const items=(CATALOG[key]||[]).slice().sort((a,b)=>{
      const aL=isLatest(a), bL=isLatest(b);
      if(aL!==bL) return bL - aL;
      const aObj = a.addedAt ? parseYMD(a.addedAt) : null;
const bObj = b.addedAt ? parseYMD(b.addedAt) : null;
const aD = aObj ? aObj.getTime() : 0;
const bD = bObj ? bObj.getTime() : 0;

      if(aD!==bD) return bD - aD;
      return a.title.localeCompare(b.title,'ar',{numeric:true});
    });

    items.forEach(d=>{ if(isLatest(d)) newCount++; });
    return {key,index:i+1,title:GROUP_TITLES[key]||'قسم',items};
  });

  const total = groups.reduce((sum,g)=>sum+g.items.length,0);
  const activeDefault = groups.find(g=>g.items.length) || groups[0];
  host.className='docs-hub';
  host.innerHTML=`
    <div class="docs-hub-head">
      <div class="docs-hub-title">
        <strong>التصنيفات الرئيسية</strong>
        <span>اختر تصنيفًا لعرض الملفات المرتبطة به مباشرة.</span>
      </div>
      <div class="docs-total-pill">📚 ${total} ملف/دليل</div>
    </div>
    <div class="docs-category-grid" role="list"></div>
    <div class="docs-files-panel">
      <div class="docs-files-head">
        <h3></h3>
        <span></span>
      </div>
      <div class="docs-file-grid"></div>
    </div>
  `;

  const categoryGrid = host.querySelector('.docs-category-grid');
  const filesTitle = host.querySelector('.docs-files-head h3');
  const filesMeta = host.querySelector('.docs-files-head span');
  const fileGrid = host.querySelector('.docs-file-grid');
  const accents=['#0da9a6','#07a869','#3d7eb9','#d96b4c','#8e44ad','#15445a'];
  const icons=[
    '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 9h8M8 13h8M8 17h5"></path></svg>',
    '<svg viewBox="0 0 24 24"><path d="M5 20V8l7-4 7 4v12"></path><path d="M9 20v-7h6v7"></path></svg>',
    '<svg viewBox="0 0 24 24"><path d="M8 19h8"></path><path d="M8 15h8"></path><path d="M7 3h10l2 4v14H5V7z"></path></svg>',
    '<svg viewBox="0 0 24 24"><path d="M4 19V6a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2"></path><path d="M8 7h8"></path></svg>',
    '<svg viewBox="0 0 24 24"><path d="M12 4v16"></path><path d="M5 8h14"></path><path d="M7 20h10"></path></svg>',
    '<svg viewBox="0 0 24 24"><path d="M4 7h16"></path><path d="M7 7v13h10V7"></path><path d="M9 4h6"></path></svg>'
  ];

  function fileIcon(d){
    const hay = `${d.kind||''} ${d.title||''}`.toLowerCase();
    if(/رابط|link|url/.test(hay)) return ['link','رابط'];
    if(/عرض|بوربوينت|power|ppt/.test(hay)) return ['deck','P'];
    if(/نموذج|word|doc/.test(hay)) return ['word','W'];
    if(/جدول|excel|sheet|xls/.test(hay)) return ['sheet','X'];
    return ['pdf','PDF'];
  }

  function fileCardHTML(d){
    const ok = isValidUrl(d.url);
    const id = driveId(d.url);
    const canDl = ok && !!id;
    const dl = canDl ? toDirect(d.url) : "";
    const latest=isLatest(d);
    const [iconClass,iconText]=fileIcon(d);
    return `
      <article class="doc-file-card">
        <div class="doc-file-top">
          <div class="doc-file-icon ${iconClass}">${iconText}</div>
          <span class="doc-file-kind">${esc(d.kind||'دليل')}</span>
        </div>
        <div class="title">${esc(d.title)}</div>
        ${d.desc?`<div class="desc">${esc(d.desc)}</div>`:''}
        <div class="doc-file-meta">
          ${d.src?`<span class="badge">${esc(d.src)}</span>`:''}
          ${latest?'<span class="badge new">جديد</span>':''}
          ${ok?"":'<span class="badge warn">بحاجة لتحديث الرابط</span>'}
        </div>
        <div class="doc-file-actions">
          <a class="btn open" ${ok ? 'target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="'+esc(d.url)+'"' : 'aria-disabled="true" tabindex="-1"'}>فتح</a>
          <a class="btn download" ${canDl ? 'href="'+esc(dl)+'"' : 'aria-disabled="true"'}>تحميل</a>
        </div>
      </article>
    `;
  }

  function renderFiles(group){
    filesTitle.textContent = group.title;
    filesMeta.textContent = `${group.items.length} ملف`;
    fileGrid.innerHTML='';
    if(!group.items.length){
      fileGrid.innerHTML='<div class="search-empty">لا توجد روابط مضافة هنا بعد.</div>';
      return;
    }
    group.items.slice(0,8).forEach(d=>{
      fileGrid.insertAdjacentHTML('beforeend',fileCardHTML(d));
    });
    if(group.items.length>8){
      fileGrid.insertAdjacentHTML('beforeend',`
        <button class="btn docs-more" type="button">عرض المزيد (${group.items.length-8})</button>
      `);
      const moreBtn=fileGrid.querySelector('.docs-more');
      moreBtn?.addEventListener('click',()=>{
        moreBtn.remove();
        group.items.slice(8).forEach(d=>{
          fileGrid.insertAdjacentHTML('beforeend',fileCardHTML(d));
        });
      });
    }
  }

  groups.forEach((group,i)=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='docs-category-card';
    btn.style.setProperty('--doc-accent',accents[i%accents.length]);
    btn.innerHTML=`
      <span class="docs-category-icon">${icons[i%icons.length]}</span>
      <span class="docs-category-name">${esc(group.title)}</span>
      <span class="docs-category-count">${group.items.length} ملف</span>
    `;
    btn.addEventListener('click',()=>{
      categoryGrid.querySelectorAll('.docs-category-card').forEach(c=>c.classList.remove('active'));
      btn.classList.add('active');
      renderFiles(group);
    });
    categoryGrid.appendChild(btn);
    if(group.key===activeDefault.key) btn.classList.add('active');
  });

  renderFiles(activeDefault);

  const announce=document.getElementById('announce');
  if(announce){
    if(newCount>0){
      announce.style.display='flex';
      announce.querySelector('.txt').textContent = `تمت إضافة ${newCount} عنصر جديد خلال اليومين الماضيين.`;
      const closeBtn = announce.querySelector('.close');
if(closeBtn) closeBtn.onclick = ()=>{ announce.style.display='none'; };
    }else{
      announce.style.display='none';
    }
  }

  const countEl = document.getElementById('docsCount');
  if(countEl) countEl.textContent = `(${total} ملف/دليل)`;
}

function mirrorAcademyDocs(){
  const source=document.getElementById('docsCols');
  const target=document.getElementById('academyDocsCols');
  if(!source || !target) return;
  target.innerHTML=source.innerHTML;
  target.querySelectorAll('details').forEach(group => {
    group.open = false;
  });
}

function updateAcademyPlatformCount(){
  const countEl=document.getElementById('academyPlatformCount');
  const toolsSection=document.getElementById('support-tools');
  if(!countEl || !toolsSection) return;
  const count=toolsSection.querySelectorAll('.academy-tile').length;
  countEl.textContent=String(count);
}

const ACADEMY_SUPPORT_CARDS = [
  {title:"ملفات وسجلات المدير",desc:"ملفات تشغيلية حساسة بوصول محدود.",href:"https://drive.google.com/drive/folders/138uI03lwMyz0U1Lrxa5fVYl56_hcep3F?usp=sharing",icon:"fa-solid fa-file-lines",color:"var(--support-purple)",chip:"محدث"},
  {title:"سجلات المدرسة",desc:"مجلدات تتبع وتشغيل للإدارة المدرسية.",href:"https://drive.google.com/drive/folders/1fCM6lNV_i4l_LuCHl5BX0Vy2-H3lWx2E?usp=sharing",icon:"fa-solid fa-folder-tree",color:"var(--brand-teal)",chip:"محدث"},
  {title:"مناسبات وفعاليات",desc:"روزنامة الفعاليات والتنبيهات المدرسية.",href:"https://moe.gov.sa/ar/mediacenter/events/Pages/default.aspx",icon:"fa-solid fa-calendar-days",color:"var(--brand-gold)",chip:"مباشر"},
  {title:"تحليل النتائج",desc:"قراءة مؤشرات التحصيل والمتابعة.",href:"#academy-docs",icon:"fa-solid fa-chart-line",color:"var(--brand-blue)",chip:"قريبًا"}
];

const CUSTOM_SUPPORT_CARDS = [
  /*
  {
    title: "عنوان البطاقة",
    desc: "وصف مختصر",
    href: "رابط البطاقة",
    icon: "fa-solid fa-folder-open",
    color: "var(--brand-teal)",
    chip: "محدث"
  }
  */
];

function renderAcademySupportCards(){
  const grid=document.querySelector('#academy-news .academy-card-grid');
  if(!grid) return;
  if(grid.querySelector('.academy-tile, .academy-card')) return;
  const cards=[...ACADEMY_SUPPORT_CARDS, ...CUSTOM_SUPPORT_CARDS];
  grid.innerHTML=cards.map(card=>{
    const external = /^https?:\/\//.test(card.href || '');
    const attrs = external ? 'target="_blank" rel="noopener noreferrer"' : '';
    return `
      <a class="academy-tile" href="${esc(card.href || '#')}" ${attrs}>
        <span class="academy-tile-media"><i class="${esc(card.icon || 'fa-solid fa-folder-open')}" style="font-size:58px;color:${esc(card.color || 'var(--brand-teal)')}"></i></span>
        <h3>${esc(card.title || 'بطاقة جديدة')}</h3>
        <p>${esc(card.desc || '')}</p>
        ${card.chip ? `<span class="academy-chip">${esc(card.chip)}</span>` : ''}
      </a>
    `;
  }).join('');
}

/* إبراز "جديد" في بطاقات المنصات خلال يومين */
function renderPlatformNewBadge(){
  const cont = document.getElementById('platformCards');
  if(!cont) return;

  const cards = cont.querySelectorAll('a.card[data-added-at]');
  let anyNew = false;

  cards.forEach(card=>{
    const dt = card.getAttribute('data-added-at');
    const isNewNow = خلالأيام(dt, 2);

    // شارة جديدة تلقائية
    let badge = card.querySelector('.badge.new[data-auto="1"]');

    if(isNewNow){
      anyNew = true;
      if(!badge){
        badge = document.createElement('span');
        badge.className = 'badge new';
        badge.textContent = 'جديد';
        badge.setAttribute('data-auto','1');
        badge.style.position = 'absolute';
        badge.style.top = '10px';
        badge.style.insetInlineEnd = '10px';
        card.appendChild(badge);
      }
    }else{
      badge?.remove();
    }
  });

  // (اختياري) إذا عندك منصات جديدة ولا يوجد شريط إعلان ظاهر
  const announce = document.getElementById('announce');
  if(anyNew && announce && announce.style.display !== 'flex'){
    announce.style.display = 'flex';
    announce.querySelector('.txt').textContent = 'تمت إضافة عناصر جديدة خلال اليومين الماضيين.';
  }
}

/* ====== البحث الذكي ====== */
function normalizeArabic(str){
  return String(str||"").toLowerCase()
    .replace(/[أإآا]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ة/g,'ه')
    .replace(/ؤ/g,'و')
    .replace(/ئ/g,'ي')
    .replace(/[^\u0600-\u06FF0-9a-zA-Z\s]/g,' ')
    .replace(/\s+/g,' ').trim();
}
function makeIndex(){
  const idx=[];
  for(const key of ORDER){
    const arr = CATALOG[key]||[];
    for(const d of arr){
      idx.push({
        key,
        gtitle: GROUP_TITLES[key],
        title: d.title,
        desc: d.desc||'',
        kind: d.kind||'',
        url: d.url,
        addedAt: d.addedAt||'',
        latest: isLatest(d),
        titleHay: normalizeArabic(d.title||''),
        hay: normalizeArabic(`${d.title} ${d.desc||''} ${GROUP_TITLES[key]} ${d.kind||''}`)
      });
    }
  }
  return idx;
}
let SEARCH_INDEX = [];
function rebuildIndex(){ SEARCH_INDEX = makeIndex(); }

function score(q, item){
  const hay=item.hay||"";
  const t=item.titleHay||"";
  if(!hay) return 0;
  let s=0;

  if(t===q) s+=70;
  if(t.startsWith(q)) s+=55;
  if(hay===q) s+=40;
  if(hay.startsWith(q)) s+=30;

  const qParts=q.split(' ');
  for(const part of qParts){
    if(!part) continue;
    if(t.startsWith(part)) s+=22;
    else if(t.includes(part)) s+=18;

    if(hay.startsWith(part)) s+=10;
    else if(hay.includes(part)) s+=6;
  }

  s += Math.min(15, Math.floor(q.length/4));
  if(item.latest) s+=10;
  return s;
}

function searchCatalog(q, limit=12){
  const nQ=normalizeArabic(q);
  if(!nQ) return [];
  const scored=SEARCH_INDEX.map(item=>({item,score:score(nQ,item)}))
    .filter(x=>x.score>20)
    .sort((a,b)=>b.score - a.score || (b.item.latest - a.item.latest));
  return scored.slice(0,limit).map(x=>x.item);
}

function setupSearchUI(){
  const input = document.getElementById('docSearch');
  const box = document.getElementById('searchResults');
  if(!input || !box) return;

  let lastQuery='', blurTimeout=null;

  function renderResults(list, q){
    box.innerHTML='';
    if(!list.length){
      box.innerHTML = `<div class="search-empty">لا نتائج مطابقة لعبارة: <b>${esc(q)}</b></div>`;
      box.style.display='block';
      return;
    }
    list.forEach(it=>{
      const openBtn = isValidUrl(it.url)
  ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">فتح</a>`
  : `<a aria-disabled="true" tabindex="-1">فتح</a>`;
      box.insertAdjacentHTML('beforeend',`
        <div class="itm" role="option">
          <div>
            <div class="ttl">${esc(it.title)}</div>
            <div class="meta">
              <span class="tag">${esc(it.kind||'دليل')}</span>
              <span class="tag">${esc(it.gtitle)}</span>
              ${it.latest?'<span class="tag" style="background:#b41d3a;color:#fff;border-color:#b41d3a">جديد</span>':''}
            </div>
          </div>
          <div class="act">${openBtn}</div>
        </div>
      `);
    });
    box.style.display='block';
  }

  function doSearch(){
    const q = input.value.trim();
    if(q===lastQuery){return}
    lastQuery=q;
    if(!q){ box.style.display='none'; box.innerHTML=''; return; }
    const res = searchCatalog(q);
    renderResults(res, q);
  }

  input.addEventListener('input', ()=>{ window.clearTimeout(input._t); input._t=setTimeout(doSearch, 120); });
  input.addEventListener('focus', ()=>{ if(input.value.trim()){doSearch()} });
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){
      const firstLink = box.querySelector('.itm .act a[href]');
      if(firstLink){ firstLink.click(); }
    } else if(e.key==='Escape'){
      box.style.display='none';
    }
  });
  input.addEventListener('blur', ()=>{
    blurTimeout=setTimeout(()=>{ box.style.display='none'; }, 180);
  });
  box.addEventListener('mousedown', ()=>{
    if(blurTimeout) { clearTimeout(blurTimeout); blurTimeout=null; }
  });
}

/* تأثير المنصات */
function setupPlatformFX(){
  const cards = document.querySelectorAll('#platformCards .card'); // للـ reveal فقط
  const tiltCards = document.querySelectorAll('#platformCards .card:not(.bannerCard)'); // حركة فقط بدون البنرات

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        e.target.classList.add('reveal');
        io.unobserve(e.target);
      }
    });
  },{threshold:.15});

  cards.forEach(c=>io.observe(c));

  if(reduceMotion) return;

  tiltCards.forEach(card=>{
    let rafId=0;

    function onMove(ev){
      const r = card.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width - .5;
      const y = (ev.clientY - r.top) / r.height - .5;
      const rotX = (+y)*6;
      const rotY = (-x)*6;

      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(()=>{
        card.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-4px)`;
      });
    }

    function reset(){
      cancelAnimationFrame(rafId);
      card.style.transform = '';
    }

    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseleave', reset);
    card.addEventListener('blur', reset);
  });
}

function applyRegisteredSchoolName(){
  const guestMode = localStorage.getItem('schoolGuestMode') === '1';
  const savedBaseName = (localStorage.getItem('registeredSchoolBaseName') || '').trim();
  const savedStage = (localStorage.getItem('registeredSchoolStage') || '').trim();
  const composedName = savedBaseName && savedStage ? `${savedStage} ${savedBaseName}` : '';
  const savedName = composedName || (localStorage.getItem('registeredSchoolName') || '').trim();
  const schoolName = guestMode ? '' : savedName;
  document.querySelectorAll('[data-school-name]').forEach(el=>{
    el.textContent = schoolName;
    el.hidden = !schoolName;
  });
  document.querySelectorAll('.masthead-school-name').forEach(el=>{
    el.classList.toggle('is-long', !!schoolName && schoolName.length > 34);
    el.classList.toggle('is-very-long', !!schoolName && schoolName.length > 54);
  });
  document.body.classList.toggle('has-school-name', !!schoolName);
  document.body.classList.toggle('guest-mode', guestMode);
}

/* تشغيل */
function setupSectionToggles(){
  document.querySelectorAll('.academy-section').forEach((section, index)=>{
    const head = section.querySelector(':scope > .academy-section-head');
    if(!head || head.querySelector('.section-toggle-btn')) return;

    const sectionId = section.id || `academy-section-${index}`;
    const storageKey = `sectionCollapsed:${sectionId}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'section-toggle-btn';
    button.innerHTML = '<i class="fa-solid fa-chevron-up" aria-hidden="true"></i>';
    head.appendChild(button);

    function syncLabel(){
      const collapsed = section.classList.contains('is-collapsed');
      button.setAttribute('aria-label', collapsed ? 'إظهار القسم' : 'إخفاء القسم');
      button.setAttribute('title', collapsed ? 'إظهار القسم' : 'إخفاء القسم');
      button.setAttribute('aria-expanded', String(!collapsed));
    }

    function toggleSection(){
      section.classList.toggle('is-collapsed');
      localStorage.setItem(storageKey, section.classList.contains('is-collapsed') ? '1' : '0');
      syncLabel();
    }

    if(localStorage.getItem(storageKey) !== '0'){
      section.classList.add('is-collapsed');
    }
    syncLabel();

    button.addEventListener('click', toggleSection);
    head.querySelector('h2')?.addEventListener('click', toggleSection);
  });

  if(document.body.dataset.sectionJumpReady === '1') return;
  document.body.dataset.sectionJumpReady = '1';
  document.addEventListener('click', event=>{
    const link = event.target.closest('a[href^="#"]');
    if(!link) return;
    const targetId = link.getAttribute('href')?.slice(1);
    if(!targetId) return;
    const targetSection = document.getElementById(targetId);
    if(!targetSection?.classList.contains('academy-section')) return;
    targetSection.classList.remove('is-collapsed');
    localStorage.setItem(`sectionCollapsed:${targetId}`, '0');
    const toggle = targetSection.querySelector(':scope > .academy-section-head .section-toggle-btn');
    if(toggle){
      toggle.setAttribute('aria-label', 'إخفاء القسم');
      toggle.setAttribute('title', 'إخفاء القسم');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });
}

function readLocalStorageObject(key){
  try{
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }catch(_){
    return {};
  }
}

function reportText(value){
  return value === null || value === undefined ? '' : String(value).trim();
}

function getEducationDepartmentMergeFields(value){
  const educationDepartment = reportText(value).replace(/\s+/g, ' ');
  if(!educationDepartment){
    return {
      educationDepartmentPrefix:'',
      educationDepartmentName:''
    };
  }

  const structuredMatch = educationDepartment.match(
    /^(?:الإدارة العامة للتعليم|إدارة التعليم)\s*(بمنطقة|بمحافظة|بالمنطقة)\s+(.+)$/
  );
  if(structuredMatch){
    return {
      educationDepartmentPrefix:`الإدارة العامة للتعليم ${structuredMatch[1]}`,
      educationDepartmentName:reportText(structuredMatch[2])
    };
  }

  const generalMatch = educationDepartment.match(
    /^(?:الإدارة العامة للتعليم|إدارة التعليم)\s+(.+)$/
  );
  if(generalMatch){
    return {
      educationDepartmentPrefix:'الإدارة العامة للتعليم',
      educationDepartmentName:reportText(generalMatch[1])
    };
  }

  return {
    educationDepartmentPrefix:'',
    educationDepartmentName:educationDepartment
  };
}

function getReportMergeData(sectionId){
  const emptyData = {
    schoolName:'',
    schoolStage:'',
    educationDepartment:'',
    educationDepartmentPrefix:'',
    educationDepartmentName:'',
    ministryNumber:'',
    principalName:'',
    educationalAffairsAgent:'',
    studentAffairsAgent:'',
    schoolAffairsAgent:'',
    activityLeaderName:''
  };
  if(sectionId !== 'managerReports') return emptyData;

  const profile = readLocalStorageObject('registeredSchoolProfile');
  const preferences = readLocalStorageObject('reportSectionPreferences');
  const managerReports = preferences.managerReports && typeof preferences.managerReports === 'object'
    ? preferences.managerReports
    : {};
  const enabledFields = managerReports.enabledFields && typeof managerReports.enabledFields === 'object'
    ? managerReports.enabledFields
    : {};
  const values = managerReports.values && typeof managerReports.values === 'object'
    ? managerReports.values
    : {};

  function optionalValue(key, legacyKey = ''){
    const enabled = enabledFields[key] === true || (legacyKey && enabledFields[legacyKey] === true);
    if(!enabled) return '';
    const value = Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : legacyKey && Object.prototype.hasOwnProperty.call(values, legacyKey)
        ? values[legacyKey]
        : profile[key] ?? (legacyKey ? profile[legacyKey] : '');
    return reportText(value);
  }

  const educationDepartment = reportText(profile.educationDepartment);
  const educationDepartmentFields = getEducationDepartmentMergeFields(educationDepartment);

  return {
    schoolName:reportText(profile.schoolName),
    schoolStage:reportText(profile.schoolStage || profile.stage),
    educationDepartment,
    ...educationDepartmentFields,
    ministryNumber:reportText(profile.ministryNumber).replace(/[^0-9]/g, ''),
    principalName:optionalValue('principalName'),
    educationalAffairsAgent:optionalValue('educationalAffairsAgent'),
    studentAffairsAgent:optionalValue('studentAffairsAgent'),
    schoolAffairsAgent:optionalValue('schoolAffairsAgent'),
    activityLeaderName:optionalValue('activityLeaderName', 'activityCoordinatorName')
  };
}

window.getReportMergeData = getReportMergeData;

function setupManagerReportsPreferences(){
  const storageKey = 'reportSectionPreferences';
  const modal = document.getElementById('managerReportsModal');
  const dialog = modal?.querySelector('.manager-reports-dialog');
  const closeButton = document.getElementById('managerReportsClose');
  const cancelButton = document.getElementById('managerReportsCancel');
  const saveButton = document.getElementById('managerReportsSave');
  const laterButton = document.getElementById('managerReportsLater');
  const toast = document.getElementById('managerReportsToast');
  const title = document.getElementById('managerReportsTitle');
  const description = document.getElementById('managerReportsDescription');
  const settingsView = document.getElementById('managerReportsSettingsView');
  const libraryView = document.getElementById('managerReportLibrary');
  const actions = document.getElementById('managerReportsActions');
  const editDataButton = document.getElementById('managerReportsEditData');
  const entries = document.querySelectorAll('[data-manager-reports-entry]');
  if(!modal || !dialog || !closeButton || !cancelButton || !saveButton || !laterButton || !title || !description || !settingsView || !libraryView || !actions || !editDataButton || !entries.length) return;

  const optionalFields = [
    {key:'principalName', label:'مدير المدرسة', defaultEnabled:false},
    {key:'educationalAffairsAgent', label:'وكيل الشؤون التعليمية', defaultEnabled:false},
    {key:'studentAffairsAgent', label:'وكيل شؤون الطلاب', defaultEnabled:false},
    {key:'schoolAffairsAgent', label:'وكيل الشؤون المدرسية', defaultEnabled:false},
    {key:'activityLeaderName', aliases:['activityCoordinatorName'], label:'رائد النشاط', defaultEnabled:false}
  ];
  let returnFocus = null;
  let toastTimer = 0;

  const settingsTitle = 'إعداد بيانات تقارير المدير';
  const settingsDescription = 'يمكنك تعبئة البيانات التي تريد ظهورها في تقارير هذا القسم، وترك أي حقل فارغًا إذا لا ترغب في استخدامه.';
  const libraryTitle = 'مكتبة تقارير المدير';
  const libraryDescription = 'اختر التقرير المطلوب، وسيتم تنزيل نسخة Word معبأة ببيانات المدرسة والبيانات التي اخترتها لهذا القسم.';

  function getProfile(){
    return readLocalStorageObject('registeredSchoolProfile');
  }

  function getSchoolStage(profile){
    return String(profile.schoolStage || profile.stage || '').trim();
  }

  function getManagerSettings(){
    const preferences = readLocalStorageObject(storageKey);
    const managerReports = preferences.managerReports;
    return managerReports && typeof managerReports === 'object' && !Array.isArray(managerReports)
      ? managerReports
      : {};
  }

  function getToggle(key){
    return modal.querySelector(`[data-manager-field-toggle="${key}"]`);
  }

  function getValueInput(key){
    return modal.querySelector(`[data-manager-field-value="${key}"]`);
  }

  function displayValue(value){
    const cleaned = String(value || '').trim();
    return cleaned || 'غير محدد';
  }

  function firstStoredValue(source, field){
    const keys = [field.key, ...(field.aliases || [])];
    for(const key of keys){
      if(Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    }
    return undefined;
  }

  function renderRequired(profile){
    const department = document.getElementById('managerRequiredDepartment');
    const stage = document.getElementById('managerRequiredStage');
    const school = document.getElementById('managerRequiredSchool');
    const ministry = document.getElementById('managerRequiredMinistry');
    if(department) department.textContent = displayValue(profile.educationDepartment);
    if(stage) stage.textContent = displayValue(getSchoolStage(profile));
    if(school) school.textContent = displayValue(profile.schoolName);
    if(ministry) ministry.textContent = displayValue(reportText(profile.ministryNumber).replace(/[^0-9]/g, ''));
  }

  function populateModal(){
    const profile = getProfile();
    const settings = getManagerSettings();
    const enabledFields = settings.enabledFields && typeof settings.enabledFields === 'object'
      ? settings.enabledFields
      : {};
    const savedValues = settings.values && typeof settings.values === 'object'
      ? settings.values
      : {};

    renderRequired(profile);
    optionalFields.forEach(field=>{
      const toggle = getToggle(field.key);
      const input = getValueInput(field.key);
      if(!toggle || !input) return;
      const savedEnabled = firstStoredValue(enabledFields, field);
      toggle.checked = savedEnabled !== undefined
        ? savedEnabled === true
        : field.defaultEnabled;
      const savedValue = firstStoredValue(savedValues, field);
      const profileValue = firstStoredValue(profile, field);
      const initialValue = savedValue !== undefined ? savedValue : profileValue;
      input.value = String(initialValue || '');
    });
  }

  function showSettingsView(focusFirstField = false){
    title.textContent = settingsTitle;
    description.textContent = settingsDescription;
    settingsView.hidden = false;
    libraryView.hidden = true;
    actions.hidden = false;
    closeButton.setAttribute('aria-label', 'إغلاق إعدادات تقارير المدير');
    if(focusFirstField){
      const firstInput = settingsView.querySelector('input');
      firstInput?.focus();
    }
  }

  function showLibraryView(){
    title.textContent = libraryTitle;
    description.textContent = libraryDescription;
    settingsView.hidden = true;
    libraryView.hidden = false;
    actions.hidden = true;
    closeButton.setAttribute('aria-label', 'إغلاق مكتبة تقارير المدير');
    requestAnimationFrame(()=>{
      if(typeof window.renderManagerReportLibrary === 'function'){
        window.renderManagerReportLibrary();
      }
      document.getElementById('managerReportSearch')?.focus({preventScroll:true});
    });
  }

  function openModal(entry){
    returnFocus = entry;
    populateModal();
    showSettingsView();
    modal.hidden = false;
    document.body.classList.add('manager-reports-modal-open');
    closeButton.focus();
  }

  function closeModal(){
    if(modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('manager-reports-modal-open');
    if(returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  function showSavedToast(message = 'تم حفظ إعدادات تقارير المدير'){
    if(!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(()=>{
      toast.hidden = true;
    }, 2400);
  }

  entries.forEach(entry=>{
    entry.addEventListener('click', event=>{
      event.preventDefault();
      openModal(entry);
    });
  });

  modal.addEventListener('input', event=>{
    const input = event.target.closest('[data-manager-field-value]');
    if(!input) return;
    const toggle = getToggle(input.dataset.managerFieldValue || '');
    if(toggle && input.value.trim()) toggle.checked = true;
  });

  closeButton.addEventListener('click', closeModal);
  cancelButton.addEventListener('click', closeModal);
  laterButton.addEventListener('click', showLibraryView);
  editDataButton.addEventListener('click', ()=>showSettingsView(true));

  function collectManagerSettings(){
    const enabledFields = {};
    const values = {};
    optionalFields.forEach(field=>{
      enabledFields[field.key] = getToggle(field.key)?.checked === true;
      const rawValue = getValueInput(field.key)?.value || '';
      values[field.key] = rawValue.trim();
    });
    return {enabledFields, values};
  }

  function persistManagerSettings(){
    const preferences = readLocalStorageObject(storageKey);
    preferences.managerReports = collectManagerSettings();
    localStorage.setItem(storageKey, JSON.stringify(preferences));
    return preferences;
  }

  saveButton.addEventListener('click', ()=>{
    persistManagerSettings();
    showSavedToast();
    showLibraryView();
  });

  modal.addEventListener('click', event=>{
    if(event.target === modal) closeModal();
  });
  modal.addEventListener('keydown', event=>{
    if(event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [href]'))
      .filter(element=>!element.hidden && !element.closest('[hidden]'));
    if(!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if(event.shiftKey && document.activeElement === first){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey && document.activeElement === last){
      event.preventDefault();
      first.focus();
    }
  });
  document.addEventListener('keydown', event=>{
    if(event.key === 'Escape' && !modal.hidden) closeModal();
  });
}

if(localStorage.getItem('preferredTheme') === 'dark'){
  document.body.classList.add('dark');
}
applyRegisteredSchoolName();
mergeCustomDocs();
renderDocs();
mirrorAcademyDocs();
rebuildIndex();
updateAcademyPlatformCount();
renderAcademySupportCards();
setupManagerReportsPreferences();
renderPlatformNewBadge();
setupSearchUI();
setupPlatformFX();
setupSectionToggles();
updateThemeLogos();
document.documentElement.classList.remove('preload-dark');

/* زر إخفاء شريط الإشعار */



/* ===== School Support Carousel Replacement ===== */
const supportCards = document.querySelectorAll("#support .support-service-card");
const supportDotsBox = document.querySelector("#support .support-slider-dots");
let activeSupportSlide = 0;

supportCards.forEach((card, i) => {
  const dot = document.createElement("button");
  dot.className = "support-slider-dot";
  dot.type = "button";
  dot.setAttribute("aria-label", `انتقال إلى بطاقة ${i + 1}`);
  dot.onclick = () => { activeSupportSlide = i; updateSupportSlider(); };
  supportDotsBox?.appendChild(dot);

  card.addEventListener("click", (event) => {
    if(i === activeSupportSlide) return;
    event.preventDefault();
    activeSupportSlide = i;
    updateSupportSlider();
  });
});

function getSupportDiff(i){
  let diff = i - activeSupportSlide;
  const total = supportCards.length;
  if(diff > total / 2) diff -= total;
  if(diff < -total / 2) diff += total;
  return diff;
}

function getSupportOffset(){
  return window.matchMedia("(max-width: 900px)").matches ? Math.min(245, window.innerWidth * 0.68) : 318;
}

function updateSupportSlider(){
  const offset = getSupportOffset();
  supportCards.forEach((card, i) => {
    const d = getSupportDiff(i);
    if(d === 0){ card.style.transform = "translateX(-50%) translateX(0px) scale(1)"; card.style.opacity = "1"; card.style.zIndex = "100"; card.style.visibility = "visible"; }
    else if(d === -1){ card.style.transform = `translateX(-50%) translateX(${-offset}px) scale(.92)`; card.style.opacity = "1"; card.style.zIndex = "80"; card.style.visibility = "visible"; }
    else if(d === 1){ card.style.transform = `translateX(-50%) translateX(${offset}px) scale(.92)`; card.style.opacity = "1"; card.style.zIndex = "80"; card.style.visibility = "visible"; }
    else if(d === -2){ card.style.transform = `translateX(-50%) translateX(${-offset * 2}px) scale(.84)`; card.style.opacity = ".35"; card.style.zIndex = "40"; card.style.visibility = "visible"; }
    else if(d === 2){ card.style.transform = `translateX(-50%) translateX(${offset * 2}px) scale(.84)`; card.style.opacity = ".35"; card.style.zIndex = "40"; card.style.visibility = "visible"; }
    else { card.style.transform = "translateX(-50%) scale(.8)"; card.style.opacity = "0"; card.style.zIndex = "0"; card.style.visibility = "hidden"; }
  });
  document.querySelectorAll("#support .support-slider-dot").forEach((dot, i) => dot.classList.toggle("active", i === activeSupportSlide));
}

function moveSupportSlide(dir){
  activeSupportSlide = (activeSupportSlide + dir + supportCards.length) % supportCards.length;
  updateSupportSlider();
}

const supportSliderWindow = document.querySelector("#support .support-slider-window");
let supportTouchStartX = 0;
let supportTouchStartY = 0;

supportSliderWindow?.addEventListener("touchstart", (event) => {
  supportTouchStartX = event.touches[0].clientX;
  supportTouchStartY = event.touches[0].clientY;
}, { passive: true });

supportSliderWindow?.addEventListener("touchend", (event) => {
  const touch = event.changedTouches[0];
  const dx = touch.clientX - supportTouchStartX;
  const dy = touch.clientY - supportTouchStartY;
  if(Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
  moveSupportSlide(dx > 0 ? -1 : 1);
}, { passive: true });

window.addEventListener("resize", updateSupportSlider);
updateSupportSlider();
/* ===== Top Bar Date / Time / Dark Mode ===== */
function updateDateTime(){
  const now = new Date();
  const dateText = now.toLocaleDateString("en-GB");
  const timeText = now.toLocaleTimeString("ar-SA", {
    hour:"numeric",
    minute:"2-digit"
  });

  document.querySelectorAll("[data-current-date]").forEach((element) => {
    element.textContent = dateText;
  });
  document.querySelectorAll("[data-current-time]").forEach((element) => {
    element.textContent = timeText;
  });
}

function toggleDark(){
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("preferredTheme", isDark ? "dark" : "light");
  updateThemeLogos();
  updateThemeToggleState();
}

function updateThemeToggleState(){
  const isDark = document.body.classList.contains("dark");
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.setAttribute("aria-pressed", String(isDark));
  });
}

function updateThemeLogos(){
  const isDark = document.body.classList.contains("dark");
  document.querySelectorAll("[data-theme-logo]").forEach((logo) => {
    const nextSrc = isDark ? logo.dataset.darkSrc : logo.dataset.lightSrc;
    if(nextSrc && logo.getAttribute("src") !== nextSrc){
      logo.setAttribute("src", nextSrc);
    }
  });
}

function toggleContrast(){
  document.body.classList.toggle("high-contrast");
}

function openSideDrawer(){
  document.body.classList.add("drawer-open");
  document.getElementById("sideDrawer")?.setAttribute("aria-hidden", "false");
}

function closeSideDrawer(){
  document.body.classList.remove("drawer-open");
  document.getElementById("sideDrawer")?.setAttribute("aria-hidden", "true");
}

document.addEventListener("keydown", (event) => {
  if(event.key === "Escape") closeSideDrawer();
});

updateDateTime();
updateThemeToggleState();
setInterval(updateDateTime,1000);

function finishAppBoot(){
  let released = false;
  const release = () => {
    if(released) return;
    released = true;
    if(window.__appBootFallback) window.clearTimeout(window.__appBootFallback);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove("app-booting");
      });
    });
  };

  window.setTimeout(release, 800);

  if(document.fonts?.ready){
    document.fonts.ready.then(release).catch(release);
  }else{
    release();
  }
}

finishAppBoot();

function secureExternalLinks(root = document){
  root.querySelectorAll('a[href^="http://"], a[href^="https://"]').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}

secureExternalLinks();
