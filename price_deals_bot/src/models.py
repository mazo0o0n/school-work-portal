from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db import Base


class Product(Base):
    """A product tracked by the bot."""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(50), default="amazon_sa")
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    canonical_product_id: Mapped[str | None] = mapped_column(String(150), index=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    snapshots: Mapped[list["PriceSnapshot"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )


class PriceSnapshot(Base):
    """A point-in-time price reading for a tracked product."""

    __tablename__ = "price_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_db_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    current_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    old_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="SAR")
    availability: Mapped[str] = mapped_column(String(50), default="unknown")
    last_checked: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    raw_payload: Mapped[str | None] = mapped_column(Text, nullable=True)

    product: Mapped[Product] = relationship(back_populates="snapshots")


class DealSent(Base):
    """A sent deal fingerprint used to avoid duplicate Telegram messages."""

    __tablename__ = "deals_sent"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_db_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    discount_percentage: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    message_hash: Mapped[str] = mapped_column(String(128), index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("message_hash", name="uq_deals_sent_message_hash"),
    )
