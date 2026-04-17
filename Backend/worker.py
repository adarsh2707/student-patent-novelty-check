from __future__ import annotations

from redis_queue import redis_conn, RQ_QUEUE_NAME
from rq import Worker

if __name__ == "__main__":
    worker = Worker([RQ_QUEUE_NAME], connection=redis_conn)
    worker.work()