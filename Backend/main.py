# backend/main.py
from __future__ import annotations

import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Literal, Any, Dict, Tuple

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cpc_mapper import suggest_cpc, generate_why_similar
from semantic_ranker import rerank

# --- SQLite setup ---
BASE_DIR = Path(__file__).resolve().parent
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

        conn.commit()
    finally:
        conn.close()


def log_search(
    *,
    problem: str,
    domain: str,
    technologies: list[str],
    novelty: str,
    cpc_suggestions: list[str],
    num_results: int,
    backend_mode: str,
) -> None:
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO search_logs (
                created_at,
                problem,
                domain,
                technologies,
                novelty,
                cpc_suggestions,
                num_results,
                backend_mode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.utcnow().isoformat(timespec="seconds"),
                problem,
                domain,
                ", ".join(technologies or []),
                novelty,
                ", ".join(cpc_suggestions or []),
                int(num_results),
                backend_mode,
            ),
        )
        conn.commit()
    except Exception as e:
        print("[search_logs] Error while logging search:", e)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def log_feedback(
    *,
    publication_number: str,
    patent_title: str,
    vote: str,
    comment: str,
    idea_problem: str,
    idea_domain: str,
    cpc_used: list[str],
) -> None:
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO feedback_logs (
                created_at,
                publication_number,
                patent_title,
                vote,
                comment,
                idea_problem,
                idea_domain,
                cpc_used
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.utcnow().isoformat(timespec="seconds"),
                publication_number,
                patent_title,
                vote,
                comment,
                idea_problem,
                idea_domain,
                ", ".join(cpc_used or []),
            ),
        )
        conn.commit()
    except Exception as e:
        print("[feedback_logs] Error while logging feedback:", e)
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ---- PatentsView integration ----
PATENTSEARCH_IMPORT_ERROR: Optional[str] = None
try:
    from patentsearch_client import search_real_patents  # type: ignore

    HAS_REAL_SEARCH = True
except Exception as e:
    HAS_REAL_SEARCH = False
    PATENTSEARCH_IMPORT_ERROR = repr(e)

    def search_real_patents(*args, **kwargs):
        return []


# ----------------- FastAPI app & CORS -----------------
app = FastAPI(title="Student Patent Novelty Check - Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

# ----------------- helpers -----------------
_STOP = {
    "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with", "using",
    "based", "system", "method", "device", "process", "data", "model", "models",
    "real", "time", "across", "large", "improve", "use", "used", "idea",
    "application", "apps", "user", "users", "including", "via", "into", "from",
}


def extract_anchors(text: str, extra: List[str] | None = None, k: int = 10) -> List[str]:
    raw = (text or "").lower()
    raw = re.sub(r"[^a-z0-9\s\-_/]+", " ", raw)
    tokens = [t.strip() for t in raw.split() if t.strip()]

    cand = [t for t in tokens if len(t) >= 4 and t not in _STOP and not t.isdigit()]

    if extra:
        for x in extra:
            if isinstance(x, str):
                t = x.lower().strip()
                t = re.sub(r"[^a-z0-9\s\-_/]+", " ", t).strip()
                if t and t not in _STOP:
                    cand.append(t)

    freq: Dict[str, int] = {}
    for t in cand:
        freq[t] = freq.get(t, 0) + 1

    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], -len(kv[0])))
    return [t for t, _ in ranked[:k]]


def make_snippet(text: str, n: int = 360) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    if len(t) <= n:
        return t
    return t[:n].strip() + "…"


def apply_post_filters(
    raw: List[Dict[str, Any]],
    anchors: List[str],
    ui_top_k: int,
) -> List[Dict[str, Any]]:
    """Anti-junk + anti-drift filters after semantic rerank."""
    if not raw:
        return []

    top_score = float(raw[0].get("similarity_score", 0.0) or 0.0)

    # Slightly more forgiving than before so we don't kill good results
    floor = max(0.35, top_score - 0.22)

    cleaned: List[Dict[str, Any]] = []
    for item in raw:
        s = float(item.get("similarity_score", 0.0) or 0.0)
        if s < floor:
            continue

        # medium scores must still mention at least one anchor (prevents drift)
        if anchors and s < 0.62:
            blob = f"{item.get('title','')} {(item.get('_abstract') or '')}".lower()
            if not any(a.lower() in blob for a in anchors[:6]):
                continue

        cleaned.append(item)

    return (cleaned[:ui_top_k] if cleaned else raw[:ui_top_k])


def build_semantic_query(idea: "IdeaInput") -> str:
    tech_text = " ".join(idea.technologies or [])
    kw_list = idea.keywords or []
    kw_text = " ".join([k for k in kw_list if isinstance(k, str)])
    return " ".join([idea.problem, idea.novelty or "", idea.domain or "", tech_text, kw_text]).strip()


# ----------------- Data models -----------------
class IdeaInput(BaseModel):
    problem: str
    what_it_does: Optional[List[str]] = None
    domain: Optional[str] = None
    technologies: Optional[List[str]] = None
    novelty: Optional[str] = None

    keywords: Optional[List[str]] = None
    exclude_keywords: Optional[List[str]] = None
    assignee_filter: Optional[str] = None
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    max_results: Optional[int] = None


class SearchRequest(BaseModel):
    idea: IdeaInput
    cpc_suggestions: Optional[List[str]] = None


class PatentResult(BaseModel):
    title: str
    publication_number: str
    year: int
    assignee: str
    similarity_score: float
    cpc_label: str
    why_similar: List[str]
    google_patents_url: Optional[str] = None
    abstract_snippet: Optional[str] = None


class SearchResponse(BaseModel):
    input_summary: str
    domain: Optional[str]
    cpc_used: List[str]
    backend_mode: str
    results: List[PatentResult]


class FeedbackRequest(BaseModel):
    idea_problem: str
    idea_domain: Optional[str] = None
    cpc_used: List[str] = []
    publication_number: str
    patent_title: Optional[str] = None
    vote: Literal["up", "down"]
    comment: Optional[str] = None


# ----------------- Endpoints -----------------
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "message": "Backend is running",
        "has_real_search": HAS_REAL_SEARCH,
        "patentsearch_import_error": PATENTSEARCH_IMPORT_ERROR,
        "api_key_present": bool(os.getenv("PATENTSVIEW_API_KEY")),
    }


@app.post("/parse-input")
def parse_input(idea: IdeaInput):
    cpc_suggestions = suggest_cpc(idea.domain, idea.technologies)
    return {"received": idea, "cpc_suggestions": cpc_suggestions}


@app.post("/search", response_model=SearchResponse)
def search_patents(payload: SearchRequest):
    idea = payload.idea

    cpc_used = payload.cpc_suggestions or suggest_cpc(idea.domain, idea.technologies)
    input_summary = f"Idea about: {idea.problem}"

    results: List[PatentResult] = []
    backend_mode = "uninitialized"

    api_key_present = bool(os.getenv("PATENTSVIEW_API_KEY"))

    # ----- if live not possible, return mock -----
    if not HAS_REAL_SEARCH:
        backend_mode = f"mock_no_real_search_import ({PATENTSEARCH_IMPORT_ERROR})"
    elif not api_key_present:
        backend_mode = "mock_no_api_key"

    # ----- LIVE SEARCH -----
    if HAS_REAL_SEARCH and api_key_present:
        try:
            ui_top_k = int(idea.max_results or 10)
            ui_top_k = max(3, min(ui_top_k, 20))

            # Option A: big pool, rerank → top K
            candidate_pool = 200

            semantic_query = build_semantic_query(idea)

            kw_list = idea.keywords or []
            kw_text = " ".join([k for k in kw_list if isinstance(k, str)])
            tech_text = " ".join(idea.technologies or [])

            anchors = extract_anchors(
                f"{idea.problem} {idea.novelty or ''} {idea.domain or ''} {tech_text} {kw_text}",
                extra=kw_list,
                k=10,
            )

            # --- Adaptive gating (strict -> relaxed) ---
            # Pass 1 (strict): anchors + keywords
            raw: List[Dict[str, Any]] = search_real_patents(
                idea.model_dump(),
                limit=candidate_pool,
                anchors=anchors[:8],
                require_anchors=True,
                require_keywords=True,
            ) or []

            gating = "strict_anchors+keywords"

            # Pass 2 (relax): anchors only
            if len(raw) < 12:
                raw2 = search_real_patents(
                    idea.model_dump(),
                    limit=candidate_pool,
                    anchors=anchors[:8],
                    require_anchors=True,
                    require_keywords=False,
                ) or []
                if len(raw2) > len(raw):
                    raw = raw2
                    gating = "relaxed_anchors_only"

            # Pass 3 (relax more): no anchor requirement (but excludes still applied inside patentsearch_client)
            if len(raw) < 8:
                raw3 = search_real_patents(
                    idea.model_dump(),
                    limit=candidate_pool,
                    anchors=anchors[:8],
                    require_anchors=False,
                    require_keywords=False,
                ) or []
                if len(raw3) > len(raw):
                    raw = raw3
                    gating = "relaxed_no_anchor_gate"

            if not raw:
                backend_mode = f"patentsview_live_no_results ({gating})"
                results = []  # IMPORTANT: do NOT replace with mock
            else:
                # Rerank
                docs: List[str] = []
                for item in raw:
                    abs_text = item.get("_abstract") or ""
                    docs.append(f"{item.get('title', '')}\n{abs_text}".strip())

                scores = rerank(semantic_query, docs)
                for item, s in zip(raw, scores):
                    item["similarity_score"] = float(s)

                raw.sort(key=lambda x: x.get("similarity_score", 0.0), reverse=True)

                final_items = apply_post_filters(raw, anchors, ui_top_k)

                for item in final_items:
                    abs_text = (item.get("_abstract") or "").strip()
                    if abs_text:
                        item["abstract_snippet"] = make_snippet(abs_text)

                    item.pop("_abstract", None)

                    pub = (item.get("publication_number") or "").strip()
                    if pub and not item.get("google_patents_url"):
                        item["google_patents_url"] = f"https://patents.google.com/patent/{pub}"

                    r = PatentResult(**item)
                    r.why_similar = generate_why_similar(idea, r.cpc_label)
                    results.append(r)

                backend_mode = f"patentsview_live_semantic_anchor_gate ({gating})"

        except Exception as e:
            print("[search] Live search failed.")
            print("        Reason:", repr(e))
            backend_mode = "patentsview_live_error"
            results = []  # return empty, not mock

    # ----- MOCK ONLY when live is not available -----
    if backend_mode.startswith("mock_"):
        results = [
            PatentResult(
                title="Intelligent Assignment Reminder System for Students",
                publication_number="US2023000001A1",
                year=2023,
                assignee="Example University",
                similarity_score=0.86,
                cpc_label="G06F",
                why_similar=generate_why_similar(idea, "G06F"),
                google_patents_url="https://patents.google.com/patent/US2023000001A1",
                abstract_snippet="A system that sends reminders to students based on schedules, deadlines, and course metadata…",
            ),
            PatentResult(
                title="Natural Language Processing for Academic Task Management",
                publication_number="US2022000123A1",
                year=2022,
                assignee="EduTech Corp.",
                similarity_score=0.81,
                cpc_label="G06N",
                why_similar=generate_why_similar(idea, "G06N"),
                google_patents_url="https://patents.google.com/patent/US2022000123A1",
                abstract_snippet="NLP-driven task extraction and prioritization for academic planning…",
            ),
            PatentResult(
                title="System and Method for Time-Management Notifications",
                publication_number="US2021000456A1",
                year=2021,
                assignee="Productivity Labs",
                similarity_score=0.74,
                cpc_label="G06Q",
                why_similar=generate_why_similar(idea, "G06Q"),
                google_patents_url="https://patents.google.com/patent/US2021000456A1",
                abstract_snippet="Notifications and scheduling recommendations based on user context and deadlines…",
            ),
        ]

    log_search(
        problem=idea.problem,
        domain=idea.domain or "",
        technologies=idea.technologies or [],
        novelty=idea.novelty or "",
        cpc_suggestions=cpc_used,
        num_results=len(results),
        backend_mode=backend_mode,
    )

    return SearchResponse(
        input_summary=input_summary,
        domain=idea.domain,
        cpc_used=cpc_used,
        backend_mode=backend_mode,
        results=results,
    )


@app.post("/feedback")
def submit_feedback(payload: FeedbackRequest):
    log_feedback(
        publication_number=payload.publication_number,
        patent_title=payload.patent_title or "",
        vote=payload.vote,
        comment=payload.comment or "",
        idea_problem=payload.idea_problem,
        idea_domain=payload.idea_domain or "",
        cpc_used=payload.cpc_used or [],
    )
    return {"status": "ok"}
