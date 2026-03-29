import logging
import os
import time
from logging.handlers import RotatingFileHandler
from app.core.config import APP_NAME

LOG_DIR = "logs"
LOG_FILE = "app.log"

# store last log timestamps
_log_cooldowns = {}


def _should_log(key, cooldown):
    now = time.time()
    last_time = _log_cooldowns.get(key, 0)

    if now - last_time >= cooldown:
        _log_cooldowns[key] = now
        return True
    return False


def _wrap_with_cooldown(log_func):
    def wrapper(msg, *args, cooldown=None, key=None, **kwargs):
        if cooldown is None:
            return log_func(msg, *args, **kwargs)

        cooldown_key = key or msg

        if _should_log(cooldown_key, cooldown):
            return log_func(msg, *args, **kwargs)

    return wrapper


def setup_logger():
    os.makedirs(LOG_DIR, exist_ok=True)

    logger = logging.getLogger(APP_NAME)
    logger.setLevel(logging.INFO)

    if logger.hasHandlers():
        return logger

    file_handler = RotatingFileHandler(
        os.path.join(LOG_DIR, LOG_FILE),
        maxBytes=5_000_000,
        backupCount=3
    )
    file_handler.setLevel(logging.INFO)

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s"
    )

    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    logger.info = _wrap_with_cooldown(logger.info)
    logger.warning = _wrap_with_cooldown(logger.warning)
    logger.error = _wrap_with_cooldown(logger.error)

    return logger