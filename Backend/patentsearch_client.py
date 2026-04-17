from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

SERPAPI_BASE = "https://serpapi.com/search.json"
HTTP_TIMEOUT = 12

CPC_RULES = [
    {
        "label": "A61B",
        "human": "Medical diagnosis, monitoring & sensing",
        "full_codes": ["A61B5/00", "A61B5/024", "A61B5/1455"],
        "terms": [
            "heart", "ecg", "eeg", "diagnosis", "diagnostic", "monitoring",
            "wearable", "patient", "vitals", "biosignal", "health",
            "disease", "medical", "clinical", "symptom", "anomaly detection"
        ],
    },
    {
        "label": "A61M",
        "human": "Devices for introducing media into the body",
        "full_codes": ["A61M5/00", "A61M16/00"],
        "terms": [
            "infusion", "injection", "ventilation", "respirator", "catheter",
            "drug delivery", "medical device", "pump", "therapy"
        ],
    },
    {
        "label": "G16H",
        "human": "Digital health / healthcare informatics",
        "full_codes": ["G16H10/60", "G16H50/20"],
        "terms": [
            "electronic health record", "ehr", "healthcare informatics",
            "clinical decision", "patient management", "hospital workflow",
            "medical record", "telemedicine", "digital health"
        ],
    },
    {
        "label": "G06N",
        "human": "AI / machine learning",
        "full_codes": ["G06N20/00", "G06N3/08", "G06N7/00"],
        "terms": [
            "ai", "ml", "machine learning", "deep learning", "neural network",
            "reinforcement learning", "transformer", "classification",
            "prediction", "predictive analytics", "computer vision",
            "nlp", "artificial intelligence"
        ],
    },
    {
        "label": "G06F",
        "human": "Computing / data processing",
        "full_codes": ["G06F16/00", "G06F18/00", "G06F9/00"],
        "terms": [
            "data processing", "software", "workflow", "scheduler",
            "database", "query", "server", "application", "computing",
            "analytics", "dashboard", "automation", "platform"
        ],
    },
    {
        "label": "G06Q",
        "human": "Business methods / commerce / operations",
        "full_codes": ["G06Q10/06", "G06Q10/08", "G06Q50/00"],
        "terms": [
            "supply chain", "inventory", "warehouse", "procurement",
            "business process", "forecasting", "planning", "operations",
            "commerce", "payment", "retail", "order management"
        ],
    },
    {
        "label": "G01C",
        "human": "Navigation / positioning / mapping",
        "full_codes": ["G01C21/00", "G01C21/34"],
        "terms": [
            "navigation", "gps", "mapping", "positioning", "route",
            "routing", "location", "geospatial", "trajectory"
        ],
    },
    {
        "label": "G08B",
        "human": "Alarm / monitoring systems",
        "full_codes": ["G08B21/00", "G08B25/10"],
        "terms": [
            "alarm", "alert", "warning", "incident detection",
            "surveillance", "monitoring system", "event detection",
            "notification"
        ],
    },
    {
        "label": "G09B",
        "human": "Education / teaching aids",
        "full_codes": ["G09B5/00", "G09B7/00"],
        "terms": [
            "student", "learning", "education", "teaching", "study",
            "curriculum", "training", "assignment", "syllabus",
            "learning assistant"
        ],
    },
    {
        "label": "B25J",
        "human": "Industrial robots / manipulators",
        "full_codes": ["B25J9/16", "B25J13/08"],
        "terms": [
            "robot", "robotic", "manipulator", "industrial robot",
            "arm control", "actuator", "automation cell"
        ],
    },
    {
        "label": "B65G",
        "human": "Conveying / warehouse handling",
        "full_codes": ["B65G1/00", "B65G47/00"],
        "terms": [
            "conveyor", "warehouse handling", "sorting", "material handling",
            "storage system", "picking", "packing", "fulfillment"
        ],
    },
    {
        "label": "A01B",
        "human": "Agriculture / soil / field operations",
        "full_codes": ["A01B79/00", "A01B69/00"],
        "terms": [
            "agriculture", "farm", "farmer", "crop", "soil", "field",
            "harvest", "irrigation", "agronomy"
        ],
    },
    {
        "label": "A01C",
        "human": "Planting / seeding / cultivation",
        "full_codes": ["A01C21/00", "A01C23/00"],
        "terms": [
            "seed", "seeding", "planting", "cultivation", "sowing"
        ],
    },
    {
        "label": "A01G",
        "human": "Crop health / plant care",
        "full_codes": ["A01G7/00", "A01G25/00"],
        "terms": [
            "crop health", "plant disease", "pest", "leaf", "canopy",
            "agricultural monitoring", "plant stress", "fertility"
        ],
    },
]


def _clean_term(t: str) -> str:
    t = (t or "").strip()
    t = re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9\s\-_/]+", " ", t)).strip()
    return t


def _shorten(text: str, n: int = 220) -> str:
    t = _clean_term(text)
    if len(t) <= n:
        return t
    return t[:n].rsplit(" ", 1)[0].strip()


def _normalize_list(xs: Any) -> List[str]:
    if not xs:
        return []
    if isinstance(xs, str):
        xs = [xs]

    out: List[str] = []
    for x in xs:
        if isinstance(x, str):
            t = x.strip()
            if t:
                out.append(t)

    seen = set()
    uniq: List[str] = []
    for t in out:
        k = t.lower()
        if k not in seen:
            seen.add(k)
            uniq.append(t)
    return uniq


def _snippet(text: str, n: int = 360) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    if len(t) <= n:
        return t
    return t[:n].strip() + "…"


def _extract_pub_from_patent_id(patent_id: str) -> str:
    pid = (patent_id or "").strip()
    if not pid:
        return ""
    m = re.search(r"patent/([^/]+)", pid, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip().upper()
    return pid.strip().upper()


def _extract_year(value: Any) -> int:
    if not value:
        return datetime.utcnow().year
    s = str(value).strip()
    m = re.match(r"(\d{4})", s)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            pass
    return datetime.utcnow().year


def _keyword_presence_score(text: str, keywords: List[str], excludes: List[str]) -> float:
    blob = f" {(_clean_term(text) or '').lower()} "
    if not blob.strip():
        return 0.0

    pos = [k.lower().strip() for k in keywords if k.strip()]
    neg = [k.lower().strip() for k in excludes if k.strip()]

    if not pos:
        base = 0.0
    else:
        hits = sum(1 for p in pos if p in blob)
        base = hits / max(len(pos), 1)

    neg_hits = sum(1 for n in neg if n in blob)
    penalty = min(0.35, neg_hits * 0.08)
    return max(0.0, base - penalty)


def _build_query_variants(
    problem: str,
    novelty: str,
    tech_text: str,
    keywords: List[str],
    anchors: List[str],
) -> List[str]:
    variants = [
        _shorten(" ".join([problem, novelty, tech_text]), 160),
        _shorten(" ".join([problem, novelty]), 140),
        _shorten(" ".join([problem, tech_text]), 140),
        _shorten(" ".join([problem] + keywords[:4]), 140),
        _shorten(" ".join(anchors[:5]), 120),
    ]

    seen = set()
    out: List[str] = []
    for v in variants:
        if not v:
            continue
        key = v.lower()
        if key not in seen:
            seen.add(key)
            out.append(v)
    return out


def _merge_unique_patents(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    best: Dict[str, Dict[str, Any]] = {}

    for r in rows:
        pub = (r.get("publication_number") or "").strip().upper()
        if not pub:
            continue

        existing = best.get(pub)
        if existing is None:
            best[pub] = r
            continue

        old_score = float(existing.get("_client_score", 0.0) or 0.0)
        new_score = float(r.get("_client_score", 0.0) or 0.0)
        if new_score > old_score:
            best[pub] = r

    return list(best.values())


def _infer_cpc_from_text(text: str, idea: Dict[str, Any]) -> Dict[str, Any]:
    blob = f"{text} {' '.join(idea.get('technologies') or [])} {idea.get('domain') or ''} {idea.get('novelty') or ''}"
    blob = _clean_term(blob).lower()

    scored: List[Tuple[float, Dict[str, Any]]] = []
    for rule in CPC_RULES:
        score = 0.0
        for term in rule["terms"]:
            term_clean = _clean_term(term).lower()
            if term_clean and term_clean in blob:
                score += 1.0
                if len(term_clean.split()) > 1:
                    score += 0.25
        if score > 0:
            scored.append((score, rule))

    if not scored:
        domain = (idea.get("domain") or "").strip().lower()
        if domain == "medtech":
            return {
                "cpc_label": "A61B",
                "cpc_codes": ["A61B"],
                "cpc_full_codes": ["A61B5/00"],
                "cpc_human": "Medical diagnosis, monitoring & sensing",
                "cpc_confidence": 0.58,
                "cpc_alternatives": ["A61B"],
            }
        if domain == "robotics":
            return {
                "cpc_label": "B25J",
                "cpc_codes": ["B25J"],
                "cpc_full_codes": ["B25J9/16"],
                "cpc_human": "Industrial robots / manipulators",
                "cpc_confidence": 0.58,
                "cpc_alternatives": ["B25J"],
            }
        if domain == "agriculture":
            return {
                "cpc_label": "A01G",
                "cpc_codes": ["A01G"],
                "cpc_full_codes": ["A01G7/00"],
                "cpc_human": "Crop health / plant care",
                "cpc_confidence": 0.58,
                "cpc_alternatives": ["A01G"],
            }
        return {
            "cpc_label": "G06F",
            "cpc_codes": ["G06F"],
            "cpc_full_codes": ["G06F16/00"],
            "cpc_human": "Computing / data processing",
            "cpc_confidence": 0.52,
            "cpc_alternatives": ["G06F"],
        }

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_rule = scored[0]

    top_scores = [x[0] for x in scored[:3]]
    max_score = max(best_score, 1.0)
    confidence = min(0.95, 0.55 + min(0.40, best_score / (max_score + 2.0)))

    alternatives = [rule["label"] for _, rule in scored[:3]]

    return {
        "cpc_label": best_rule["label"],
        "cpc_codes": [best_rule["label"]],
        "cpc_full_codes": best_rule["full_codes"][:3],
        "cpc_human": best_rule["human"],
        "cpc_confidence": round(confidence, 4),
        "cpc_alternatives": alternatives,
    }


def _serpapi_search(
    *,
    api_key: str,
    query_text: str,
    limit: int,
    sort: Optional[str] = None,
    debug: bool = False,
) -> List[Dict[str, Any]]:
    params = {
        "engine": "google_patents",
        "q": query_text,
        "api_key": api_key,
    }

    if sort in {"new", "old"}:
        params["sort"] = sort

    if debug:
        print("[serpapi search params]", params)

    resp = requests.get(SERPAPI_BASE, params=params, timeout=HTTP_TIMEOUT)

    if not resp.ok:
        print("[SerpApi status]", resp.status_code)
        print("[SerpApi body]", resp.text[:2000])

    resp.raise_for_status()
    data = resp.json()
    organic = data.get("organic_results") or []

    if debug:
        print("[serpapi organic count]", len(organic) if isinstance(organic, list) else 0)

    if not isinstance(organic, list):
        return []

    return organic[: max(1, min(limit, 20))]


def _map_serpapi_result(
    item: Dict[str, Any],
    *,
    anchors: List[str],
    kw_terms: List[str],
    not_terms: List[str],
    idea: Dict[str, Any],
) -> Dict[str, Any]:
    title = item.get("title") or "Untitled patent"
    snippet = item.get("snippet") or item.get("summary") or ""
    publication_number = (
        item.get("publication_number")
        or _extract_pub_from_patent_id(item.get("patent_id") or "")
        or ""
    )

    patent_id = item.get("patent_id") or (f"patent/{publication_number}" if publication_number else "")
    assignee = item.get("assignee") or "Unknown"

    year = _extract_year(
        item.get("grant_date")
        or item.get("publication_date")
        or item.get("filing_date")
    )

    text_blob = f"{title} {snippet}"
    lexical_score = _keyword_presence_score(text_blob, kw_terms + anchors[:4], not_terms)
    anchor_hits = sum(1 for a in anchors[:6] if a.lower() in text_blob.lower()) if anchors else 0
    client_score = lexical_score + min(0.18, anchor_hits * 0.04)

    cpc_meta = _infer_cpc_from_text(text_blob, idea)

    return {
        "title": title,
        "publication_number": publication_number or patent_id,
        "year": year,
        "assignee": assignee,
        "similarity_score": 0.0,
        "cpc_label": cpc_meta["cpc_label"],
        "cpc_list": cpc_meta["cpc_codes"],
        "cpc_full_codes": cpc_meta["cpc_full_codes"],
        "cpc_human": cpc_meta["cpc_human"],
        "cpc_confidence": cpc_meta["cpc_confidence"],
        "cpc_alternatives": cpc_meta["cpc_alternatives"],
        "why_similar": [],
        "_abstract": snippet,
        "abstract_snippet": _snippet(snippet),
        "google_patents_url": item.get("link") or (f"https://patents.google.com/{patent_id}" if patent_id else None),
        "_client_score": client_score,
    }


def search_real_patents(
    idea: Dict[str, Any],
    *,
    limit: int = 100,
    anchors: Optional[List[str]] = None,
    require_anchors: bool = True,
    require_keywords: bool = True,
    cpc_filters: Optional[List[str]] = None,
    debug: bool = False,
) -> List[Dict[str, Any]]:
    api_key = os.getenv("SERPAPI_KEY")
    print("SERPAPI_KEY loaded:", bool(api_key))
    print("Problem received:", idea.get("problem"))

    if not api_key:
        raise RuntimeError("SERPAPI_KEY not set in environment.")

    problem = (idea.get("problem") or "").strip()
    novelty = (idea.get("novelty") or "").strip()
    techs = idea.get("technologies") or []
    tech_text = " ".join([t for t in techs if isinstance(t, str)]).strip()

    keywords = _normalize_list(idea.get("keywords"))
    exclude_keywords = _normalize_list(idea.get("exclude_keywords"))

    anchors = anchors or []
    anchors = [_clean_term(a) for a in anchors if _clean_term(a)]
    anchors = anchors[:8]

    kw_terms = [_clean_term(k) for k in keywords[:10] if _clean_term(k)]
    not_terms = [_clean_term(k) for k in exclude_keywords[:12] if _clean_term(k)]

    query_variants = _build_query_variants(
        problem=problem,
        novelty=novelty,
        tech_text=tech_text,
        keywords=kw_terms,
        anchors=anchors,
    )

    if not query_variants:
        query_variants = ["innovation"]

    all_rows: List[Dict[str, Any]] = []
    per_variant_limit = max(5, min(limit, 10))

    for idx, variant in enumerate(query_variants[:4]):
        sort = None
        if idx == 1:
            sort = "new"
        elif idx == 2:
            sort = "old"

        try:
            organic = _serpapi_search(
                api_key=api_key,
                query_text=variant,
                limit=per_variant_limit,
                sort=sort,
                debug=debug,
            )

            mapped = [
                _map_serpapi_result(
                    item,
                    anchors=anchors,
                    kw_terms=kw_terms,
                    not_terms=not_terms,
                    idea=idea,
                )
                for item in organic
            ]

            if debug:
                print(f"[search_real_patents] variant={variant!r} rows={len(mapped)}")

            all_rows.extend(mapped)
        except Exception as e:
            if debug:
                print(f"[search_real_patents] variant={variant!r} failed: {e}")

    merged = _merge_unique_patents(all_rows)
    merged.sort(key=lambda x: float(x.get("_client_score", 0.0) or 0.0), reverse=True)

    for r in merged:
        r.pop("_client_score", None)

    return merged[: max(1, min(limit, 100))]