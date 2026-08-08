"""
Basic logging configuration (Phase 1 scaffolding).

Provides a single get_logger() helper so later phases have a consistent
logging pattern from day one. Contains no business/domain logic.
"""

import logging
import sys


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        stream=sys.stdout,
    )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
