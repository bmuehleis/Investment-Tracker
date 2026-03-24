import logging
import os
from logging.handlers import RotatingFileHandler
from app.core.config import APP_NAME

LOG_DIR = "logs"
LOG_FILE = "app.log"

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
    
    return logger
