from __future__ import annotations

import os
import re
import json
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import requests
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cpc_mapper import generate_why_similar, suggest_cpc
from semantic_ranker import rerank

load_dotenv()

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
    technologies: List[str],
    novelty: str,
    cpc_suggestions: List[str],
    num_results: int,
    backend_mode: str,
) -> None:
    conn = None
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
            if conn:
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
    cpc_used: List[str],
) -> None:
    conn = None
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
            if conn:
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


print("=== Backend startup ===")
print("PATENTSVIEW_API_KEY present:", bool(os.getenv("PATENTSVIEW_API_KEY")))
print("HAS_REAL_SEARCH:", HAS_REAL_SEARCH)
print("PATENTSEARCH_IMPORT_ERROR:", PATENTSEARCH_IMPORT_ERROR)

# ----------------- FastAPI app & CORS -----------------
app = FastAPI(title="Student Patent Novelty Check - Backend")

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
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

# ----------------- helpers -----------------
HTTP_TIMEOUT = 4

_STOP = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "for",
    "in",
    "on",
    "with",
    "using",
    "based",
    "system",
    "method",
    "device",
    "process",
    "data",
    "model",
    "models",
    "real",
    "time",
    "across",
    "large",
    "improve",
    "use",
    "used",
    "idea",
    "application",
    "apps",
    "user",
    "users",
    "including",
    "via",
    "into",
    "from",
    "that",
    "this",
    "these",
    "those",
    "their",
    "thereof",
    "comprising",
    "comprises",
    "comprise",
    "wherein",
}

_CPC_HUMAN: Dict[str, str] = {
    "A61B": "Medical diagnosis, monitoring & sensing",
    "A61M": "Devices for introducing media into the body",
    "G16H": "Digital health / healthcare informatics",
    "G06F": "Computing / data processing",
    "G06Q": "Business methods / payments / commerce",
    "G06N": "AI / machine learning",
    "G01C": "Navigation / positioning / mapping",
    "G08B": "Alarm / monitoring systems",
    "G09B": "Education / demonstration / teaching aids",
    "B25J": "Industrial robots / manipulators",
    "B65G": "Conveying / warehouse handling",
}


def cpc_human_label(code: str) -> str:
    c = (code or "").strip().upper().replace(" ", "")
    if not c:
        return ""
    return _CPC_HUMAN.get(c[:4], "Technical category")


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: List[str] = []
        for x in value:
            if isinstance(x, str):
                parts.append(x)
            elif isinstance(x, dict):
                parts.extend(str(v) for v in x.values() if isinstance(v, str))
        return " ".join(parts)
    if isinstance(value, dict):
        return " ".join(str(v) for v in value.values() if isinstance(v, str))
    return str(value)


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def tokenize(text: str) -> List[str]:
    raw = (text or "").lower()
    raw = re.sub(r"[^a-z0-9\s\-_/]+", " ", raw)
    return [t.strip() for t in raw.split() if t.strip()]


def split_sentences(text: str) -> List[str]:
    t = normalize_space(text)
    if not t:
        return []
    parts = re.split(r"(?<=[\.\?!;])\s+", t)
    return [p.strip() for p in parts if p.strip()]


def make_snippet(text: str, n: int = 360) -> str:
    t = normalize_space(text)
    if not t:
        return ""
    if len(t) <= n:
        return t
    return t[:n].rstrip() + "…"


def normalize_cpc_list(val: Any) -> List[str]:
    if not val:
        return []
    if isinstance(val, str):
        s = val.strip()
        return [s] if s else []
    if isinstance(val, list):
        out: List[str] = []
        for x in val:
            if isinstance(x, str):
                s = x.strip()
                if s:
                    out.append(s)
            elif isinstance(x, dict):
                s = (x.get("cpc") or x.get("code") or "").strip()
                if s:
                    out.append(s)
        return out
    return []


def compact_cpc(code: str) -> str:
    return (code or "").strip().upper().replace(" ", "")


def dedupe_keep_order(items: List[str]) -> List[str]:
    seen = set()
    out = []
    for x in items:
        if not x:
            continue
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def extract_anchors(text: str, extra: Optional[List[str]] = None, k: int = 10) -> List[str]:
    tokens = tokenize(text)
    cand = [t for t in tokens if len(t) >= 4 and t not in _STOP and not t.isdigit()]

    if extra:
        for x in extra:
            if isinstance(x, str):
                more = tokenize(x)
                for t in more:
                    if len(t) >= 4 and t not in _STOP and not t.isdigit():
                        cand.append(t)

    freq: Dict[str, int] = {}
    for t in cand:
        freq[t] = freq.get(t, 0) + 1

    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))
    return [t for t, _ in ranked[:k]]


def build_semantic_query(idea: "IdeaInput") -> str:
    tech_text = " ".join(idea.technologies or [])
    kw_text = " ".join([k for k in (idea.keywords or []) if isinstance(k, str)])
    does_text = " ".join(idea.what_it_does or [])
    return normalize_space(
        " ".join(
            [
                idea.problem,
                idea.novelty or "",
                idea.domain or "",
                tech_text,
                kw_text,
                does_text,
            ]
        )
    )


def extract_matching_snippets(text: str, keywords: List[str], max_hits: int = 3) -> List[str]:
    if not text or not keywords:
        return []

    kws = [k.strip().lower() for k in keywords if isinstance(k, str) and k.strip()]
    if not kws:
        return []

    hits: List[str] = []
    for sentence in split_sentences(text):
        s = sentence.lower()
        if any(k in s for k in kws):
            hits.append(sentence)
        if len(hits) >= max_hits:
            break

    if not hits:
        lower_text = text.lower()
        if any(k in lower_text for k in kws):
            hits.append(make_snippet(text, 280))

    return hits


def overlap_score(text: str, positive_terms: List[str], negative_terms: List[str]) -> float:
    blob = f" {normalize_space(text).lower()} "
    if not blob.strip():
        return 0.0

    pos = [t.lower().strip() for t in positive_terms if t and t.strip()]
    neg = [t.lower().strip() for t in negative_terms if t and t.strip()]

    if not pos:
        return 0.0

    matched = 0
    for p in pos:
        if p in blob:
            matched += 1

    neg_hits = 0
    for n in neg:
        if n in blob:
            neg_hits += 1

    base = matched / max(len(pos), 1)
    penalty = min(0.4, neg_hits * 0.08)
    return max(0.0, base - penalty)


def expand_cpc_filters(cpc_suggestions: List[str], cpc_filters: List[str]) -> List[str]:
    raw = []
    raw.extend(cpc_suggestions or [])
    raw.extend(cpc_filters or [])

    cleaned: List[str] = []
    for code in raw:
        c = compact_cpc(code)
        if not c:
            continue
        cleaned.append(c)
        if len(c) >= 4:
            cleaned.append(c[:4])

    return dedupe_keep_order(cleaned)


def normalize_exact_cpc_filters(filters: List[str]) -> List[str]:
    out: List[str] = []
    for f in filters or []:
        c = compact_cpc(f)
        if c:
            out.append(c)
    return dedupe_keep_order(out)


def cpc_prefix_match(cpc_filters: List[str], cpcs: List[str], fallback_label: str) -> bool:
    """
    Strict hierarchical match:
    - A61B matches A61B, A61B5/00, A61B5/024
    - A61B5/00 matches A61B5/00 and A61B5/024
    - A61B5/024 matches only itself and deeper descendants

    No reverse fallback.
    """
    if not cpc_filters:
        return True

    filters = [compact_cpc(f) for f in cpc_filters if compact_cpc(f)]
    if not filters:
        return True

    norm_cpcs = [compact_cpc(c) for c in (cpcs or []) if compact_cpc(c)]
    fb = compact_cpc(fallback_label)

    if not norm_cpcs and fb:
        norm_cpcs = [fb]

    for code in norm_cpcs:
        for f in filters:
            if code.startswith(f):
                return True
    return False


def apply_post_filters(raw: List[Dict[str, Any]], anchors: List[str], ui_top_k: int) -> List[Dict[str, Any]]:
    if not raw:
        return []

    top_score = float(raw[0].get("hybrid_score", raw[0].get("similarity_score", 0.0)) or 0.0)
    floor = max(0.22, top_score - 0.30)

    cleaned: List[Dict[str, Any]] = []
    for item in raw:
        s = float(item.get("hybrid_score", item.get("similarity_score", 0.0)) or 0.0)
        if s < floor:
            continue

        if anchors and s < 0.50:
            blob = f"{item.get('title', '')} {(item.get('_abstract') or '')}".lower()
            if not any(a.lower() in blob for a in anchors[:6]):
                continue

        cleaned.append(item)

    return cleaned[:ui_top_k] if cleaned else raw[:ui_top_k]


def merge_unique_patents(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    best_by_pub: Dict[str, Dict[str, Any]] = {}

    for r in rows:
        pub = (r.get("publication_number") or "").strip().upper()
        if not pub:
            pub = f"ROW::{len(best_by_pub) + 1}"

        existing = best_by_pub.get(pub)
        if existing is None:
            best_by_pub[pub] = r
            continue

        old_score = float(existing.get("similarity_score", 0.0) or 0.0)
        new_score = float(r.get("similarity_score", 0.0) or 0.0)
        if new_score > old_score:
            best_by_pub[pub] = r

    return list(best_by_pub.values())


def fetch_patent_detail_sections(
    patent_id: str,
    section_scopes: List[str],
    section_keywords: List[str],
    fallback_abstract: str = "",
) -> Dict[str, Any]:
    api_key = os.getenv("PATENTSVIEW_API_KEY")
    out = {
        "section_hits": {},
        "claim_support": [],
    }

    scopes = [s for s in (section_scopes or []) if s]
    keywords = [k for k in (section_keywords or []) if k.strip()]
    if not api_key or not scopes or not keywords:
        if "abstract" in scopes and fallback_abstract:
            abstract_hits = extract_matching_snippets(fallback_abstract, keywords, max_hits=2)
            if abstract_hits:
                out["section_hits"]["abstract"] = abstract_hits
        return out

    url = "https://search.patentsview.org/api/v1/patent/"
    q = {"_eq": {"patent_id": patent_id}}
    f = [
        "patent_id",
        "patent_title",
        "patent_abstract",
        "patent_description",
        "patent_claims",
    ]
    o = {"size": 1, "from": 0}

    headers = {
        "X-Api-Key": api_key,
        "Accept": "application/json",
    }
    params = {
        "q": json.dumps(q),
        "f": json.dumps(f),
        "o": json.dumps(o),
    }

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        patents = data.get("patents") or []
        if not patents:
            raise RuntimeError("No patent detail rows returned.")

        p = patents[0]
        abstract_text = normalize_text(p.get("patent_abstract")) or fallback_abstract
        description_text = normalize_text(p.get("patent_description"))
        claims_text = normalize_text(p.get("patent_claims"))

        brief_summary_text = ""
        if description_text:
            brief_summary_text = description_text[:1800]
        elif abstract_text:
            brief_summary_text = abstract_text

        if "abstract" in scopes and abstract_text:
            hits = extract_matching_snippets(abstract_text, keywords, max_hits=2)
            if hits:
                out["section_hits"]["abstract"] = hits

        if "claims" in scopes and claims_text:
            hits = extract_matching_snippets(claims_text, keywords, max_hits=3)
            if hits:
                out["section_hits"]["claims"] = hits
                out["claim_support"] = hits

        if "brief_summary" in scopes and brief_summary_text:
            hits = extract_matching_snippets(brief_summary_text, keywords, max_hits=2)
            if hits:
                out["section_hits"]["brief_summary"] = hits

        if "description" in scopes and description_text:
            hits = extract_matching_snippets(description_text, keywords, max_hits=2)
            if hits:
                out["section_hits"]["description"] = hits

        return out

    except Exception as e:
        print(f"[detail-query] failed for US{patent_id}: {e}")
        if "abstract" in scopes and fallback_abstract:
            abstract_hits = extract_matching_snippets(fallback_abstract, keywords, max_hits=2)
            if abstract_hits:
                out["section_hits"]["abstract"] = abstract_hits
        return out


def compute_rank_features(
    idea: "IdeaInput",
    item: Dict[str, Any],
    cpc_used: List[str],
    section_keywords: List[str],
) -> Tuple[float, float, float, float]:
    title = normalize_text(item.get("title"))
    abstract = normalize_text(item.get("_abstract"))
    text_blob = f"{title} {abstract}"

    positive_terms = dedupe_keep_order(
        [
            *(idea.keywords or []),
            *(idea.technologies or []),
            *(section_keywords or []),
            *(idea.what_it_does or []),
        ]
    )
    negative_terms = dedupe_keep_order(idea.exclude_keywords or [])

    lexical = overlap_score(text_blob, positive_terms, negative_terms)
    semantic = float(item.get("similarity_score", 0.0) or 0.0)

    cpcs = []
    cpcs += normalize_cpc_list(item.get("cpc_full_codes"))
    cpcs += normalize_cpc_list(item.get("cpc_list"))
    cpcs += normalize_cpc_list(item.get("cpc_codes"))

    cpc_boost = 0.0
    if cpc_prefix_match(cpc_used, cpcs, (item.get("cpc_label") or "")):
        cpc_boost = 1.0

    year = int(item.get("year", 0) or 0)
    recency = 0.0
    if year >= 2022:
        recency = 1.0
    elif year >= 2019:
        recency = 0.75
    elif year >= 2016:
        recency = 0.5
    elif year > 0:
        recency = 0.25

    return semantic, lexical, cpc_boost, recency


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

    section_scopes: Optional[List[str]] = None
    section_keywords: Optional[List[str]] = None


class SearchRequest(BaseModel):
    idea: IdeaInput
    cpc_suggestions: Optional[List[str]] = None
    cpc_filters: Optional[List[str]] = None


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
    summary_snippet: Optional[str] = None
    claim_excerpt: Optional[str] = None

    cpc_codes: List[str] = []
    cpc_full_codes: List[str] = []
    cpc_human: Optional[str] = None

    section_hits: Dict[str, List[str]] = {}
    claim_support: List[str] = []


class SearchResponse(BaseModel):
    input_summary: str
    domain: Optional[str]
    cpc_used: List[str]
    backend_mode: str
    results: List[PatentResult]
    cpc_stats: Dict[str, int] = {}
    cpc_human_map: Dict[str, str] = {}


class FeedbackRequest(BaseModel):
    idea_problem: str
    idea_domain: Optional[str] = None
    cpc_used: List[str] = []
    publication_number: str
    patent_title: Optional[str] = None
    vote: Literal["up", "down"]
    comment: Optional[str] = None


# ----------------- Endpoints -----------------
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

    base_cpc = payload.cpc_suggestions or suggest_cpc(idea.domain, idea.technologies)

    # For UI display / ranking
    display_cpc_used = expand_cpc_filters(base_cpc, [])

    # For actual dropdown filtering only
    active_cpc_filters = normalize_exact_cpc_filters(payload.cpc_filters or [])

    input_summary = f"Idea about: {idea.problem}"

    results: List[PatentResult] = []
    backend_mode = "uninitialized"

    api_key_present = bool(os.getenv("PATENTSVIEW_API_KEY"))

    if not HAS_REAL_SEARCH:
        backend_mode = f"mock_no_real_search_import ({PATENTSEARCH_IMPORT_ERROR})"
    elif not api_key_present:
        backend_mode = "mock_no_api_key"

    cpc_stats_out: Dict[str, int] = {}
    cpc_human_map_out: Dict[str, str] = {}

    section_scopes = [s.strip() for s in (idea.section_scopes or []) if isinstance(s, str) and s.strip()]
    section_keywords = [s.strip() for s in (idea.section_keywords or []) if isinstance(s, str) and s.strip()]

    print("SEARCH REQUEST RECEIVED")
    print("PROBLEM:", idea.problem)
    print("DOMAIN:", idea.domain)
    print("TECH:", idea.technologies)
    print("KEYWORDS:", idea.keywords)
    print("SECTION_SCOPES:", section_scopes)
    print("SECTION_KEYWORDS:", section_keywords)
    print("BASE_CPC:", base_cpc)
    print("DISPLAY_CPC_USED:", display_cpc_used)
    print("ACTIVE_CPC_FILTERS:", active_cpc_filters)

    if HAS_REAL_SEARCH and api_key_present:
        try:
            ui_top_k = int(idea.max_results or 10)
            ui_top_k = max(3, min(ui_top_k, 20))

            candidate_pool = 80
            semantic_query = build_semantic_query(idea)

            kw_list = idea.keywords or []
            tech_text = " ".join(idea.technologies or [])
            section_kw_text = " ".join(section_keywords)

            base_anchor_text = f"{idea.problem} {idea.novelty or ''} {idea.domain or ''} {tech_text} {' '.join(kw_list)} {section_kw_text}"
            anchors = extract_anchors(
                base_anchor_text,
                extra=(kw_list + section_keywords + (idea.technologies or [])),
                k=10,
            )

            raw_all: List[Dict[str, Any]] = []

            try:
                rows = search_real_patents(
                    idea.model_dump(),
                    limit=candidate_pool,
                    anchors=anchors[:6],
                    require_anchors=True,
                    require_keywords=True,
                    cpc_filters=[],
                    debug=True,
                ) or []
                raw_all.extend(rows)
            except Exception as e:
                print("[primary retrieval failed]", e)

            if len(raw_all) < 8:
                try:
                    rows2 = search_real_patents(
                        idea.model_dump(),
                        limit=candidate_pool,
                        anchors=anchors[:4],
                        require_anchors=False,
                        require_keywords=False,
                        cpc_filters=[],
                        debug=True,
                    ) or []
                    raw_all.extend(rows2)
                except Exception as e:
                    print("[fallback retrieval failed]", e)

            raw = merge_unique_patents(raw_all)

            if not raw:
                backend_mode = "patentsview_live_no_results_after_fast_retrieval"
            else:
                # strict local CPC filter
                if active_cpc_filters:
                    filtered = []
                    for it in raw:
                        codes = []
                        codes += normalize_cpc_list(it.get("cpc_full_codes"))
                        codes += normalize_cpc_list(it.get("cpc_list"))
                        codes += normalize_cpc_list(it.get("cpc_codes"))

                        if cpc_prefix_match(active_cpc_filters, codes, (it.get("cpc_label") or "")):
                            filtered.append(it)

                    raw = filtered

                if not raw:
                    backend_mode = "patentsview_live_no_results_after_cpc_filter"
                else:
                    docs: List[str] = []
                    for item in raw:
                        abs_text = item.get("_abstract") or ""
                        docs.append(f"{item.get('title', '')}\n{abs_text}".strip())

                    try:
                        scores = rerank(semantic_query, docs)
                    except Exception as e:
                        print("[rerank error]", e)
                        scores = [0.5] * len(docs)

                    for item, s in zip(raw, scores):
                        item["similarity_score"] = float(s)

                    for item in raw:
                        semantic, lexical, cpc_boost, recency = compute_rank_features(
                            idea=idea,
                            item=item,
                            cpc_used=display_cpc_used,
                            section_keywords=section_keywords,
                        )

                        hybrid_score = (
                            (0.62 * semantic)
                            + (0.25 * lexical)
                            + (0.08 * cpc_boost)
                            + (0.05 * recency)
                        )
                        item["hybrid_score"] = float(hybrid_score)

                    raw.sort(key=lambda x: float(x.get("hybrid_score", 0.0) or 0.0), reverse=True)
                    final_items = apply_post_filters(raw, anchors, ui_top_k)

                    if section_keywords and section_scopes:
                        for item in final_items[:5]:
                            pub = (item.get("publication_number") or "").strip().upper()
                            patent_id = pub.replace("US", "", 1) if pub.startswith("US") else pub

                            try:
                                detail = fetch_patent_detail_sections(
                                    patent_id=patent_id,
                                    section_scopes=section_scopes,
                                    section_keywords=section_keywords,
                                    fallback_abstract=(item.get("_abstract") or ""),
                                )
                            except Exception as e:
                                print("[section extraction error]", e)
                                detail = {"section_hits": {}, "claim_support": []}

                            item["section_hits"] = detail.get("section_hits", {})
                            item["claim_support"] = detail.get("claim_support", [])

                            section_hit_count = 0
                            for scope in section_scopes:
                                section_hit_count += len((item.get("section_hits") or {}).get(scope) or [])

                            if section_hit_count > 0:
                                item["hybrid_score"] = float(item.get("hybrid_score", 0.0) or 0.0) + min(
                                    0.12, section_hit_count * 0.04
                                )

                        for item in final_items[5:]:
                            item["section_hits"] = item.get("section_hits", {})
                            item["claim_support"] = item.get("claim_support", [])

                        final_items.sort(key=lambda x: float(x.get("hybrid_score", 0.0) or 0.0), reverse=True)

                    if section_keywords and section_scopes:
                        section_filtered_items: List[Dict[str, Any]] = []
                        for item in final_items:
                            section_hits = item.get("section_hits") or {}
                            has_match = False
                            for scope in section_scopes:
                                hits = section_hits.get(scope) or []
                                if hits:
                                    has_match = True
                                    break
                            if has_match:
                                section_filtered_items.append(item)

                        if section_filtered_items:
                            final_items = section_filtered_items
                            backend_mode = "patentsview_live_hybrid_ranked_with_section_filter"
                        else:
                            backend_mode = "patentsview_live_hybrid_ranked_section_fallback"
                    else:
                        backend_mode = "patentsview_live_hybrid_ranked"

                    c = Counter()
                    for it in final_items:
                        codes = []
                        codes += normalize_cpc_list(it.get("cpc_full_codes"))
                        codes += normalize_cpc_list(it.get("cpc_list"))
                        codes += normalize_cpc_list(it.get("cpc_codes"))

                        seen_codes = set()
                        for code in codes:
                            s = compact_cpc(code)
                            if not s or s in seen_codes:
                                continue
                            seen_codes.add(s)
                            c[s] += 1

                    cpc_stats_out = dict(c)

                    tops = set()
                    for code in cpc_stats_out.keys():
                        top = code[:4]
                        if len(top) == 4:
                            tops.add(top)

                    for top in tops:
                        cpc_human_map_out[top] = cpc_human_label(top)

                    for item in final_items:
                        abs_text = normalize_text(item.get("_abstract")).strip()
                        if abs_text:
                            item["abstract_snippet"] = make_snippet(abs_text)

                        if not item.get("summary_snippet"):
                            summary_hits = (item.get("section_hits") or {}).get("brief_summary") or []
                            if summary_hits:
                                item["summary_snippet"] = make_snippet(summary_hits[0], 240)
                            elif abs_text:
                                item["summary_snippet"] = make_snippet(abs_text, 240)

                        if not item.get("claim_excerpt"):
                            claim_hits = item.get("claim_support") or []
                            if claim_hits:
                                item["claim_excerpt"] = make_snippet(claim_hits[0], 240)

                        item.pop("_abstract", None)

                        pub = (item.get("publication_number") or "").strip()
                        if pub and not item.get("google_patents_url"):
                            item["google_patents_url"] = f"https://patents.google.com/patent/{pub}"

                        cpc_list = normalize_cpc_list(item.get("cpc_list"))
                        cpc_full = normalize_cpc_list(item.get("cpc_full_codes"))

                        item["cpc_codes"] = [compact_cpc(x) for x in cpc_list if compact_cpc(x)]
                        item["cpc_full_codes"] = [compact_cpc(x) for x in cpc_full if compact_cpc(x)]

                        lbl = compact_cpc(item.get("cpc_label") or "")
                        item["cpc_human"] = cpc_human_label(lbl[:4]) if lbl else ""

                        if "hybrid_score" in item:
                            item["similarity_score"] = float(item["hybrid_score"])

                        r = PatentResult(**item)
                        r.why_similar = generate_why_similar(idea, r.cpc_label)
                        results.append(r)

        except Exception as e:
            print("[/search fatal error]", e)
            backend_mode = f"search_runtime_error ({repr(e)})"

    if backend_mode.startswith("mock_") or (not results and backend_mode in {"uninitialized", "search_runtime_error"}):
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
                summary_snippet="A system that creates schedules and reminders using academic deadlines and user context…",
                claim_excerpt="A method comprising receiving course deadlines and generating reminder schedules for a student device…",
                cpc_codes=["G06F"],
                cpc_full_codes=["G06F"],
                cpc_human=cpc_human_label("G06F"),
                section_hits={},
                claim_support=[],
            )
        ]
        cpc_stats_out = dict(Counter(["G06F"]))
        cpc_human_map_out = {"G06F": cpc_human_label("G06F")}
        if backend_mode == "uninitialized":
            backend_mode = "mock_fallback"

    log_search(
        problem=idea.problem,
        domain=idea.domain or "",
        technologies=idea.technologies or [],
        novelty=idea.novelty or "",
        cpc_suggestions=display_cpc_used,
        num_results=len(results),
        backend_mode=backend_mode,
    )

    return SearchResponse(
        input_summary=input_summary,
        domain=idea.domain,
        cpc_used=display_cpc_used,
        backend_mode=backend_mode,
        results=results,
        cpc_stats=cpc_stats_out,
        cpc_human_map=cpc_human_map_out,
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