-- بيانات تواصل مسؤول التسجيل للمراجعة الإدارية فقط.
-- الأعمدة اختيارية لضمان توافق سجلات المدارس المنشأة قبل هذه المرحلة.
ALTER TABLE schools ADD COLUMN registration_contact_name TEXT;
ALTER TABLE schools ADD COLUMN registration_contact_phone TEXT;
