from __future__ import annotations

import os
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session as DBSession

from cpc_mapper import generate_why_similar, suggest_cpc
from patentsearch_client import search_real_patents
from schemas import IdeaInput, SearchRequest, PatentResult, SearchResponse
from crud import log_search, save_user_search_history

from database import SessionLocal
from redis_queue import update_job_meta


_STOP = {
    "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with",
    "using", "based", "system", "method", "device", "process", "data", "model",
    "models", "real", "time", "across", "large", "improve", "use", "used",
    "idea", "application", "apps", "user", "users", "including", "via", "into",
    "from", "that", "this", "these", "those", "their", "thereof", "comprising",
    "comprises", "comprise", "wherein",
}

_CPC_HUMAN: Dict[str, str] = {
    "A61B": "Medical diagnosis, monitoring & sensing",
    "A61M": "Devices for introducing media into the body",
    "G16H": "Digital health / healthcare informatics",
    "G06F": "Computing / data processing",
    "G06Q": "Business methods / commerce / operations",
    "G06N": "AI / machine learning",
    "G01C": "Navigation / positioning / mapping",
    "G08B": "Alarm / monitoring systems",
    "G09B": "Education / teaching aids",
    "B25J": "Industrial robots / manipulators",
    "B65G": "Conveying / warehouse handling",
    "A01B": "Agriculture / field operations",
    "A01C": "Planting / seeding / cultivation",
    "A01G": "Crop health / plant care",
}

def noop_update_job_fn(*args, **kwargs):
    return None

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
    out: List[str] = []
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
                for t in tokenize(x):
                    if len(t) >= 4 and t not in _STOP and not t.isdigit():
                        cand.append(t)

    freq: Dict[str, int] = {}
    for t in cand:
        freq[t] = freq.get(t, 0) + 1

    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))
    return [t for t, _ in ranked[:k]]


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

    matched = sum(1 for p in pos if p in blob)
    neg_hits = sum(1 for n in neg if n in blob)

    base = matched / max(len(pos), 1)
    penalty = min(0.4, neg_hits * 0.08)
    return max(0.0, base - penalty)


def expand_cpc_filters(cpc_suggestions: List[str], cpc_filters: List[str]) -> List[str]:
    raw: List[str] = []
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
    out = {"section_hits": {}, "claim_support": []}

    scopes = [s for s in (section_scopes or []) if s]
    keywords = [k for k in (section_keywords or []) if k.strip()]
    if "abstract" in scopes and fallback_abstract and keywords:
        abstract_hits = extract_matching_snippets(fallback_abstract, keywords, max_hits=2)
        if abstract_hits:
            out["section_hits"]["abstract"] = abstract_hits
    return out


def _cpc_alignment_score(
    idea_cpcs: List[str],
    patent_cpcs: List[str],
    fallback_label: str,
    patent_confidence: float = 0.55,
) -> float:
    targets = [compact_cpc(x) for x in (idea_cpcs or []) if compact_cpc(x)]
    codes = [compact_cpc(x) for x in (patent_cpcs or []) if compact_cpc(x)]

    if not codes and fallback_label:
        codes = [compact_cpc(fallback_label)]

    if not targets or not codes:
        return 0.0

    best = 0.0

    for idx, target in enumerate(targets):
        idea_weight = max(0.60, 1.0 - (idx * 0.08))

        for code in codes:
            score = 0.0

            if code == target:
                score = 1.00
            elif code.startswith(target) or target.startswith(code):
                if len(code) >= 7 or len(target) >= 7:
                    score = 0.93
                else:
                    score = 0.84
            elif len(code) >= 4 and len(target) >= 4 and code[:4] == target[:4]:
                score = 0.70
            elif len(code) >= 3 and len(target) >= 3 and code[:3] == target[:3]:
                score = 0.46
            elif len(code) >= 1 and len(target) >= 1 and code[:1] == target[:1]:
                score = 0.18

            if score > 0:
                best = max(best, score * idea_weight)

    confidence_scaled = 0.72 + (0.28 * max(0.0, min(1.0, patent_confidence)))
    return min(1.0, best * confidence_scaled)


def compute_rank_features(
    idea: IdeaInput,
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

    cpcs: List[str] = []
    cpcs += normalize_cpc_list(item.get("cpc_full_codes"))
    cpcs += normalize_cpc_list(item.get("cpc_list"))
    cpcs += normalize_cpc_list(item.get("cpc_codes"))
    cpcs += normalize_cpc_list(item.get("cpc_alternatives"))

    patent_confidence = float(item.get("cpc_confidence", 0.55) or 0.55)
    cpc_alignment = _cpc_alignment_score(
        idea_cpcs=cpc_used,
        patent_cpcs=cpcs,
        fallback_label=(item.get("cpc_label") or ""),
        patent_confidence=patent_confidence,
    )

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

    return semantic, lexical, cpc_alignment, recency


def build_rank_explanations(
    *,
    item: Dict[str, Any],
    idea: IdeaInput,
    semantic: float,
    lexical: float,
    cpc_alignment: float,
) -> List[str]:
    reasons: List[str] = []

    cpc_label = compact_cpc(item.get("cpc_label") or "")
    cpc_human = cpc_human_label(cpc_label[:4]) if cpc_label else "the relevant technical area"

    if cpc_alignment >= 0.88:
        reasons.append(f"Strong CPC alignment with your inferred technical area in {cpc_human.lower()}.")
    elif cpc_alignment >= 0.68:
        reasons.append(f"Good CPC-family alignment with your idea in {cpc_human.lower()}.")
    elif cpc_alignment >= 0.42:
        reasons.append(f"Broad CPC overlap with your technical domain in {cpc_human.lower()}.")

    if semantic >= 0.80:
        reasons.append("High semantic similarity to your idea description.")
    elif semantic >= 0.62:
        reasons.append("Moderate semantic similarity to your concept.")

    if lexical >= 0.45:
        reasons.append("Matches several of your key technical terms.")
    elif lexical >= 0.28:
        reasons.append("Shares some important keywords from your idea.")

    section_hits = item.get("section_hits") or {}
    if any(section_hits.get(k) for k in section_hits):
        reasons.append("Relevant evidence was found in the patent text sections you selected.")

    year = int(item.get("year", 0) or 0)
    if year >= 2022:
        reasons.append("This is a relatively recent patent in the area.")
    elif year >= 2018:
        reasons.append("This patent is reasonably recent for this technical area.")

    seen = set()
    deduped: List[str] = []
    for r in reasons:
        key = r.strip().lower()
        if key and key not in seen:
            seen.add(key)
            deduped.append(r)

    return deduped[:4]

def noop_update_job(*args,**kwargs):
    return None

def run_search_pipeline(
    db: DBSession,
    payload: SearchRequest,
    update_job_fn=None,
    job_id: Optional[str] = None,
    current_user: Optional[Dict[str, Any]] = None,
) -> SearchResponse:
    idea = payload.idea
    
    if update_job_fn is None:
        update_job_fn = noop_update_job

    if job_id:
        update_job_fn(job_id, status="running", progress=5, stage="preparing input")

    base_cpc = payload.cpc_suggestions or suggest_cpc(idea.domain, idea.technologies)
    display_cpc_used = expand_cpc_filters(base_cpc, [])
    active_cpc_filters = normalize_exact_cpc_filters(payload.cpc_filters or [])

    input_summary = f"Idea about: {idea.problem}"
    results: List[PatentResult] = []
    backend_mode = "uninitialized"

    api_key_present = bool(os.getenv("SERPAPI_KEY"))
    if not api_key_present:
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

    if api_key_present:
        try:
            if job_id:
                update_job_fn(job_id, progress=15, stage="building retrieval query")

            ui_top_k = int(idea.max_results or 10)
            ui_top_k = max(3, min(ui_top_k, 20))
            candidate_pool = 80

            kw_list = idea.keywords or []
            tech_text = " ".join(idea.technologies or [])
            section_kw_text = " ".join(section_keywords)

            base_anchor_text = f"{idea.problem} {idea.novelty or ''} {idea.domain or ''} {tech_text} {' '.join(kw_list)} {section_kw_text}"
            anchors = extract_anchors(
                base_anchor_text,
                extra=(kw_list + section_keywords + (idea.technologies or [])),
                k=10,
            )

            if job_id:
                update_job_fn(job_id, progress=25, stage="fetching patent candidates")

            raw = search_real_patents(
                idea.model_dump(),
                limit=candidate_pool,
                anchors=anchors[:6],
                require_anchors=True,
                require_keywords=True,
                cpc_filters=[],
                debug=True,
            ) or []

            raw = merge_unique_patents(raw)

            if not raw:
                backend_mode = "serpapi_live_no_results"
            else:
                if job_id:
                    update_job_fn(job_id, progress=45, stage="applying CPC and local filters")

                if active_cpc_filters:
                    filtered: List[Dict[str, Any]] = []
                    for it in raw:
                        codes: List[str] = []
                        codes += normalize_cpc_list(it.get("cpc_full_codes"))
                        codes += normalize_cpc_list(it.get("cpc_list"))
                        codes += normalize_cpc_list(it.get("cpc_codes"))

                        if cpc_prefix_match(active_cpc_filters, codes, (it.get("cpc_label") or "")):
                            filtered.append(it)

                    raw = filtered

                if not raw:
                    backend_mode = "serpapi_live_no_results_after_cpc_filter"
                else:
                    if job_id:
                        update_job_fn(job_id, progress=60, stage="scoring candidates")

                    scores = [0.5] * len(raw)

                    for item, s in zip(raw, scores):
                        item["similarity_score"] = float(s)

                    for item in raw:
                        semantic, lexical, cpc_alignment, recency = compute_rank_features(
                            idea=idea,
                            item=item,
                            cpc_used=display_cpc_used,
                            section_keywords=section_keywords,
                        )

                        hybrid_score = (
                            (0.52 * semantic)
                            + (0.18 * lexical)
                            + (0.24 * cpc_alignment)
                            + (0.06 * recency)
                        )
                        item["hybrid_score"] = float(hybrid_score)
                        item["cpc_alignment_score"] = float(cpc_alignment)
                        item["_semantic_score"] = float(semantic)
                        item["_lexical_score"] = float(lexical)

                    raw.sort(key=lambda x: float(x.get("hybrid_score", 0.0) or 0.0), reverse=True)
                    final_items = apply_post_filters(raw, anchors, ui_top_k)

                    if section_keywords and section_scopes:
                        if job_id:
                            update_job_fn(job_id, progress=75, stage="extracting section evidence")

                        for item in final_items[:5]:
                            detail = fetch_patent_detail_sections(
                                patent_id=(item.get("publication_number") or ""),
                                section_scopes=section_scopes,
                                section_keywords=section_keywords,
                                fallback_abstract=(item.get("_abstract") or ""),
                            )

                            item["section_hits"] = detail.get("section_hits", {})
                            item["claim_support"] = detail.get("claim_support", [])

                    backend_mode = "serpapi_live_hybrid_ranked"

                    if job_id:
                        update_job_fn(job_id, progress=88, stage="building result cards")

                    c = Counter()
                    for it in final_items:
                        codes: List[str] = []
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
                            item["summary_snippet"] = make_snippet(abs_text, 240) if abs_text else ""

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

                        item["rank_explanations"] = build_rank_explanations(
                            item=item,
                            idea=idea,
                            semantic=float(item.get("_semantic_score", 0.0) or 0.0),
                            lexical=float(item.get("_lexical_score", 0.0) or 0.0),
                            cpc_alignment=float(item.get("cpc_alignment_score", 0.0) or 0.0),
                        )

                        item.setdefault("section_hits", {})
                        item.setdefault("claim_support", [])

                        r = PatentResult(**item)
                        r.why_similar = generate_why_similar(idea, r.cpc_label)
                        results.append(r)

        except Exception as e:
            print("[/search fatal error]", e)
            backend_mode = f"search_runtime_error ({repr(e)})"

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
                summary_snippet="A system that creates schedules and reminders using academic deadlines and user context…",
                claim_excerpt="A method comprising receiving course deadlines and generating reminder schedules for a student device…",
                cpc_codes=["G06F"],
                cpc_full_codes=["G06F16/00"],
                cpc_human=cpc_human_label("G06F"),
                cpc_alignment_score=None,
                rank_explanations=[],
                section_hits={},
                claim_support=[],
            )
        ]
        cpc_stats_out = dict(Counter(["G06F"]))
        cpc_human_map_out = {"G06F": cpc_human_label("G06F")}
        if backend_mode == "uninitialized":
            backend_mode = "mock_fallback"

    log_search(
        db,
        problem=idea.problem,
        domain=idea.domain or "",
        technologies=idea.technologies or [],
        novelty=idea.novelty or "",
        cpc_suggestions=display_cpc_used,
        num_results=len(results),
        backend_mode=backend_mode,
    )

    response = SearchResponse(
        input_summary=input_summary,
        domain=idea.domain,
        cpc_used=display_cpc_used,
        backend_mode=backend_mode,
        results=results,
        cpc_stats=cpc_stats_out,
        cpc_human_map=cpc_human_map_out,
    )

    if current_user and current_user.get("id") is not None:
        try:
            saved_id = save_user_search_history(
                db,
                user_id=int(current_user["id"]),
                idea=idea,
                cpc_used=display_cpc_used,
                result_count=len(results),
                backend_mode=backend_mode,
                response_obj=response.model_dump(),
            )
            print("[user_search_history] saved row id:", saved_id)
        except Exception as e:
            print("[user_search_history] save skipped:", e)

    if job_id:
        update_job_fn(
            job_id,
            status="completed",
            progress=100,
            stage="completed",
            result=response.model_dump(),
        )

    return response

def run_search_job_task(payload_dict: dict, job_id: str, current_user: Optional[Dict[str, Any]] = None) -> None:
    db = SessionLocal()
    try:
        payload = SearchRequest(**payload_dict)
        run_search_pipeline(
            db=db,
            payload=payload,
            update_job_fn=update_job_meta,
            job_id=job_id,
            current_user=current_user,
        )
    except Exception as e:
        update_job_meta(
            job_id,
            status="failed",
            progress=100,
            stage="failed",
            error=str(e),
        )
    finally:
        db.close()