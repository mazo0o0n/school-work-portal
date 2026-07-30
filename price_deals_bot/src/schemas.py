from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass(slots=True)
class ScrapedProduct:
    """Normalized product data extracted from a store page."""

    product_id: str
    title: str | None
    current_price: Decimal | None
    old_price: Decimal | None
    url: str
    image_url: str | None
    availability: str
    source: str
    last_checked: datetime


@dataclass(slots=True)
class Deal:
    """A deal ready to be formatted and sent to Telegram."""

    product_id: str
    title: str
    current_price: Decimal
    old_price: Decimal | None
    reference_price: Decimal
    discount_percentage: Decimal
    url: str
    image_url: str | None
