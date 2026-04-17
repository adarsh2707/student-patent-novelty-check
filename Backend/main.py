from __future__ import annotations

import os
import sqlite3
import asyncio
from uuid import uuid4
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session as DBSession

from redis_queue import job_queue, init_job_meta, get_job_meta
from services import run_search_pipeline, run_search_job_task, noop_update_job

from auth_sql import router as auth_router, get_current_user_required, require_admin
from semantic_ranker import get_model
from schemas import (
    IdeaInput,
    SearchRequest,
    SearchResponse,
    FeedbackRequest,
    JobState,
    SearchJobCreateResponse,
    SearchJobStatusResponse,
    SearchJobResultResponse,
    SearchHistoryItem,
    SearchHistoryListResponse,
    SearchHistoryDetailResponse,
    AdminAnalyticsSummaryResponse,
    AdminRecentSearchItem,
    AdminRecentSearchesResponse,
    AdminTopListsResponse,
)
from crud import (
    log_feedback,
    list_user_search_history_rows,
    get_user_search_history_row,
    admin_count_metrics,
    admin_top_lists,
    admin_recent_searches,
    delete_user_search_history,
)
from database import SessionLocal, get_db
from services import run_search_pipeline


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

print("=== Backend startup ===")
print("SERPAPI_KEY present:", bool(os.getenv("SERPAPI_KEY")))

DB_PATH = BASE_DIR / "search_logs.db"


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS search_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                problem TEXT,
                domain TEXT,
                technologies TEXT,
                novelty TEXT,
                cpc_suggestions TEXT,
                num_results INTEGER,
                backend_mode TEXT
            )
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS feedback_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                publication_number TEXT NOT NULL,
                patent_title TEXT,
                vote TEXT NOT NULL,
                comment TEXT,
                idea_problem TEXT,
                idea_domain TEXT,
                cpc_used TEXT
            )
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS user_search_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                problem_preview TEXT,
                problem_hash TEXT,
                domain TEXT,
                technologies TEXT,
                novelty_preview TEXT,
                cpc_used TEXT,
                result_count INTEGER NOT NULL DEFAULT 0,
                backend_mode TEXT,
                response_json TEXT
            )
            """
        )

        try:
            cur.execute("ALTER TABLE user_search_history ADD COLUMN idea_json TEXT")
        except Exception:
            pass

        conn.commit()
    finally:
        conn.close()


app = FastAPI(title="Student Patent Novelty Check - Backend")
app.include_router(auth_router)

frontend_origin_env = os.getenv("FRONTEND_ORIGIN", "").strip()
default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]
allowed_origins = default_origins + ([frontend_origin_env] if frontend_origin_env else [])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.getenv("DATABASE_URL", "").startswith("sqlite") or not os.getenv("DATABASE_URL"):
    init_db()

try:
    get_model()
    print("✅ Semantic model preloaded")
except Exception as e:
    print("⚠️ Model preload failed:", e)

JOB_STORE: Dict[str, Dict[str, Any]] = {}


@app.get("/")
def root():
    return {"message": "backend alive"}


@app.get("/ping")
def ping():
    return {"ok": True}


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "message": "Backend is running",
        "api_key_present": bool(os.getenv("SERPAPI_KEY")),
    }


@app.post("/parse-input")
def parse_input(idea: IdeaInput):
    from cpc_mapper import suggest_cpc
    cpc_suggestions = suggest_cpc(idea.domain, idea.technologies)
    return {"received": idea, "cpc_suggestions": cpc_suggestions}


@app.post("/search", response_model=SearchResponse)
def search_patents(
    payload: SearchRequest,
    current_user: Dict[str, Any] = Depends(get_current_user_required),
    db: DBSession = Depends(get_db),
):
    return run_search_pipeline(
        db=db,
        payload=payload,
        update_job_fn=noop_update_job,
        job_id=None,
        current_user=current_user,
    )


@app.post("/search/jobs", response_model=SearchJobCreateResponse)
async def create_search_job(
    payload: SearchRequest,
    current_user: Dict[str, Any] = Depends(get_current_user_required),
):
    job_id = str(uuid4())
    init_job_meta(job_id, user_id=int(current_user["id"]))

    job_queue.enqueue(
        run_search_job_task,
        payload.model_dump(),
        job_id,
        current_user,
        job_timeout=900,
    )

    return SearchJobCreateResponse(job_id=job_id, status=JobState.queued)


@app.get("/search/jobs/{job_id}", response_model=SearchJobStatusResponse)
def get_search_job_status(
    job_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user_required),
):
    job = get_job_meta(job_id)
    if not job:
        return SearchJobStatusResponse(
            job_id=job_id,
            status=JobState.failed,
            progress=100,
            stage="missing",
            error="Job not found",
        )

    if job.get("user_id") is not None and int(job["user_id"]) != int(current_user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to view this job")

    return SearchJobStatusResponse(
        job_id=job_id,
        status=JobState(job["status"]),
        progress=int(job.get("progress", 0)),
        stage=job.get("stage", "queued"),
        error=job.get("error"),
    )

@app.get("/search/jobs/{job_id}/result", response_model=SearchJobResultResponse)
def get_search_job_result(
    job_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user_required),
):
    job = get_job_meta(job_id)
    if not job:
        return SearchJobResultResponse(
            job_id=job_id,
            status=JobState.failed,
            error="Job not found",
        )

    if job.get("user_id") is not None and int(job["user_id"]) != int(current_user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to view this job result")

    result_obj = None
    if job.get("result") is not None:
        result_obj = SearchResponse(**job["result"])

    return SearchJobResultResponse(
        job_id=job_id,
        status=JobState(job["status"]),
        result=result_obj,
        error=job.get("error"),
    )


@app.get("/history/searches", response_model=SearchHistoryListResponse)
def get_my_search_history(
    current_user: Dict[str, Any] = Depends(get_current_user_required),
    db: DBSession = Depends(get_db),
):
    rows = list_user_search_history_rows(db, int(current_user["id"]), limit=50)

    items = [
        SearchHistoryItem(
            id=int(r["id"]),
            created_at=r["created_at"],
            problem_preview=r.get("problem_preview"),
            problem_hash=r.get("problem_hash"),
            domain=r.get("domain"),
            technologies=r.get("technologies"),
            novelty_preview=r.get("novelty_preview"),
            cpc_used=r.get("cpc_used"),
            result_count=int(r.get("result_count") or 0),
            backend_mode=r.get("backend_mode"),
        )
        for r in rows
    ]

    return SearchHistoryListResponse(items=items)


@app.get("/history/searches/{history_id}", response_model=SearchHistoryDetailResponse)
def get_my_search_history_detail(
    history_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user_required),
    db: DBSession = Depends(get_db),
):
    row = get_user_search_history_row(db, history_id, int(current_user["id"]))
    if not row:
        raise HTTPException(status_code=404, detail="History item not found")

    response_obj = None
    if row.get("response_obj"):
        response_obj = SearchResponse(**row["response_obj"])

    idea_obj = None
    if row.get("idea_obj"):
        idea_obj = IdeaInput(**row["idea_obj"])

    return SearchHistoryDetailResponse(
        id=int(row["id"]),
        created_at=row["created_at"],
        problem_preview=row.get("problem_preview"),
        problem_hash=row.get("problem_hash"),
        domain=row.get("domain"),
        technologies=row.get("technologies"),
        novelty_preview=row.get("novelty_preview"),
        cpc_used=row.get("cpc_used"),
        result_count=int(row.get("result_count") or 0),
        backend_mode=row.get("backend_mode"),
        response=response_obj,
        idea=idea_obj,
    )

@app.delete("/history/searches/{history_id}")
def delete_my_search_history(
    history_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user_required),
    db: DBSession = Depends(get_db),
):
    ok = delete_user_search_history(db, history_id, int(current_user["id"]))

    if not ok:
        raise HTTPException(status_code=404, detail="History item not found")

    return {"status": "deleted", "history_id": history_id}

@app.get("/admin/analytics/summary", response_model=AdminAnalyticsSummaryResponse)
def get_admin_analytics_summary(
    current_user: Dict[str, Any] = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    data = admin_count_metrics(db)
    return AdminAnalyticsSummaryResponse(**data)


@app.get("/admin/analytics/top", response_model=AdminTopListsResponse)
def get_admin_top_lists(
    current_user: Dict[str, Any] = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    data = admin_top_lists(db, limit=10)
    return AdminTopListsResponse(**data)


@app.get("/admin/analytics/recent-searches", response_model=AdminRecentSearchesResponse)
def get_admin_recent_searches(
    current_user: Dict[str, Any] = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    rows = admin_recent_searches(db, limit=25)

    items = [
        AdminRecentSearchItem(
            id=int(r["id"]),
            user_id=int(r["user_id"]) if r.get("user_id") is not None else None,
            created_at=r["created_at"],
            problem_preview=r.get("problem_preview"),
            domain=r.get("domain"),
            technologies=r.get("technologies"),
            backend_mode=r.get("backend_mode"),
            result_count=int(r.get("result_count") or 0),
        )
        for r in rows
    ]

    return AdminRecentSearchesResponse(items=items)


@app.post("/feedback")
def submit_feedback(
    payload: FeedbackRequest,
    current_user: Dict[str, Any] = Depends(get_current_user_required),
    db: DBSession = Depends(get_db),
):
    log_feedback(
        db,
        publication_number=payload.publication_number,
        patent_title=payload.patent_title or "",
        vote=payload.vote,
        comment=payload.comment or "",
        idea_problem=payload.idea_problem,
        idea_domain=payload.idea_domain or "",
        cpc_used=payload.cpc_used or [],
    )
    return {"status": "ok"}