from pathlib import Path

from src.db import Base, engine
from src import models  # noqa: F401


def main() -> None:
    """Create all configured database tables."""
    data_dir = Path("data")
    data_dir.mkdir(exist_ok=True)
    Base.metadata.create_all(bind=engine)
    print("Database initialized successfully.")


if __name__ == "__main__":
    main()
