# Price Deals Bot

نظام Python مستقل داخل المستودع لمراقبة أسعار المنتجات، حفظ الأسعار التاريخية، ثم إرسال العروض لاحقًا إلى Telegram.

## المرحلة الحالية

هذه المرحلة تؤسس البنية الأساسية فقط:

- إعدادات المشروع من متغيرات البيئة.
- اتصال قاعدة البيانات عبر SQLAlchemy.
- نماذج قاعدة البيانات الأساسية.
- سكربت تهيئة قاعدة بيانات SQLite.

## هيكل المشروع

```text
price_deals_bot/
├── README.md
├── requirements.txt
├── .env.example
├── data/
├── scripts/
│   └── init_db.py
└── src/
    ├── __init__.py
    ├── config.py
    ├── db.py
    ├── models.py
    └── schemas.py
```

## التشغيل المحلي

من جذر المستودع:

```bash
cd price_deals_bot
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python scripts/init_db.py
```

سيتم إنشاء قاعدة بيانات SQLite في:

```text
price_deals_bot/data/deals.db
```
