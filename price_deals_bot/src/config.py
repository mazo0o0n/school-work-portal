from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env."""

    database_url: str = "sqlite:///./data/deals.db"

    telegram_bot_token: str = "replace_me"
    telegram_chat_id: str = "@your_channel_username"

    price_drop_threshold_percent: float = 10.0
    scheduler_timezone: str = "Asia/Riyadh"
    request_delay_seconds: float = 3.0
    max_retries: int = 3

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
