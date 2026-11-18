from threading import Lock

from pymongo import MongoClient
from pymongo.database import Database

from app.core.config import settings

_client: MongoClient | None = None
_db_name = settings.mongodb_db
_lock = Lock()


def connect(uri: str | None = None, db_name: str | None = None) -> MongoClient:
    global _client, _db_name
    with _lock:
        if db_name:
            _db_name = db_name
        if _client is None:
            _client = MongoClient(
                uri or settings.mongodb_uri,
                serverSelectionTimeoutMS=5000,
                tz_aware=True,
                uuidRepresentation="standard",
            )
        _client.admin.command("ping")
        return _client


def set_database(name: str) -> None:
    global _db_name
    _db_name = name


def get_db() -> Database:
    client = connect()
    return client[_db_name]


def ping() -> bool:
    try:
        connect().admin.command("ping")
        return True
    except Exception:
        return False


def close() -> None:
    global _client
    with _lock:
        if _client is not None:
            _client.close()
            _client = None
