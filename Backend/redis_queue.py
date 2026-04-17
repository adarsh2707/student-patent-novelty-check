from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from redis import Redis
from rq import Queue

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
RQ_QUEUE_NAME = os.getenv("RQ_QUEUE_NAME", "patent-search")

redis_conn = Redis.from_url(REDIS_URL)
job_queue = Queue(RQ_QUEUE_NAME, connection=redis_conn)


def _job_meta_key(job_id: str) -> str:
    return f"patent_job:{job_id}"


def init_job_meta(job_id: str, user_id: Optional[int] = None) -> None:
    payload = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "stage": "queued",
        "error": None,
        "result": None,
        "created_at": datetime.utcnow().isoformat(timespec="seconds"),
        "user_id": user_id,
    }
    redis_conn.set(_job_meta_key(job_id), json.dumps(payload))


def get_job_meta(job_id: str) -> Optional[Dict[str, Any]]:
    raw = redis_conn.get(_job_meta_key(job_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def update_job_meta(
    job_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    stage: Optional[str] = None,
    error: Optional[str] = None,
    result: Optional[dict] = None,
) -> None:
    current = get_job_meta(job_id) or {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "stage": "queued",
        "error": None,
        "result": None,
        "created_at": datetime.utcnow().isoformat(timespec="seconds"),
        "user_id": None,
    }

    if status is not None:
        current["status"] = status
    if progress is not None:
        current["progress"] = max(0, min(100, int(progress)))
    if stage is not None:
        current["stage"] = stage
    if error is not None:
        current["error"] = error
    if result is not None:
        current["result"] = result

    redis_conn.set(_job_meta_key(job_id), json.dumps(current))
