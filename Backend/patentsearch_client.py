# backend/patentsearch_client.py
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

PATENTSVIEW_BASE = "https://search.patentsview.org/api/v1/patent/"


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

    # de-dupe (preserve order)
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


def search_real_patents(
    idea: Dict[str, Any],
    *,
    limit: int = 100,
    anchors: Optional[List[str]] = None,  # topic anchors
    require_anchors: bool = True,         # keep junk out
    require_keywords: bool = True,        # keep junk out (auto-disabled if keywords empty)
    debug: bool = False,
) -> List[Dict[str, Any]]:
    api_key = os.getenv("PATENTSVIEW_API_KEY")
    if not api_key:
        raise RuntimeError("PATENTSVIEW_API_KEY not set in environment.")

    problem = (idea.get("problem") or "").strip()
    novelty = (idea.get("novelty") or "").strip()
    techs = idea.get("technologies") or []
    tech_text = " ".join([t for t in techs if isinstance(t, str)]).strip()

    keywords = _normalize_list(idea.get("keywords"))
    exclude_keywords = _normalize_list(idea.get("exclude_keywords"))
    assignee_filter = (idea.get("assignee_filter") or "").strip()
    year_from = idea.get("year_from")
    year_to = idea.get("year_to")

    # Keep base query short to avoid long-URL + 5xx issues
    query_text_full = " ".join([x for x in [problem, novelty, tech_text] if x]).strip()
    query_text = _shorten(query_text_full, 220) or _shorten(problem, 220) or "innovation"

    anchors = anchors or []
    anchors = [_clean_term(a) for a in anchors if _clean_term(a)]
    anchors = anchors[:8]

    kw_terms = [_clean_term(k) for k in keywords[:10] if _clean_term(k)]
    if not kw_terms:
        require_keywords = False

    criteria: List[Dict[str, Any]] = []

    # Base match
    criteria.append(
        {
            "_or": [
                {"_text_any": {"patent_title": query_text}},
                {"_text_any": {"patent_abstract": query_text}},
            ]
        }
    )

    # Anchor gate (HARD)
    if require_anchors and anchors:
        criteria.append(
            {
                "_or": [
                    {"_text_any": {"patent_title": " ".join(anchors)}},
                    {"_text_any": {"patent_abstract": " ".join(anchors)}},
                ]
            }
        )

    # Keyword gate (HARD)
    if require_keywords and kw_terms:
        criteria.append(
            {
                "_or": [
                    {"_text_any": {"patent_title": " ".join(kw_terms)}},
                    {"_text_any": {"patent_abstract": " ".join(kw_terms)}},
                ]
            }
        )

    # Excludes (NOT)
    not_terms = [_clean_term(k) for k in exclude_keywords[:12] if _clean_term(k)]
    if not_terms:
        criteria.append(
            {
                "_not": {
                    "_or": (
                        [{"_text_any": {"patent_title": t}} for t in not_terms]
                        + [{"_text_any": {"patent_abstract": t}} for t in not_terms]
                    )
                }
            }
        )

    # Assignee filter (optional)
    if assignee_filter:
        criteria.append({"_text_any": {"assignees.assignee_organization": assignee_filter}})

    # Year range (CORRECT operator shape for this API)
    if year_from and isinstance(year_from, int):
        criteria.append({"_gte": {"patent_date": f"{year_from}-01-01"}})
    if year_to and isinstance(year_to, int):
        criteria.append({"_lte": {"patent_date": f"{year_to}-12-31"}})

    q = {"_and": criteria} if len(criteria) > 1 else criteria[0]

    f = [
        "patent_id",
        "patent_title",
        "patent_date",
        "patent_abstract",
        "assignees.assignee_organization",
        "cpc_current.cpc_subclass_id",
    ]

    # Options for PatentSearch API (size/from)
    per_page = max(1, min(int(limit), 100))
    o = {"size": per_page, "from": 0}

    headers = {"X-Api-Key": api_key, "Accept": "application/json"}
    params = {"q": json.dumps(q), "f": json.dumps(f), "o": json.dumps(o)}

    if debug:
        print("ANCHORS:", anchors)
        print("KW_TERMS:", kw_terms)
        print("EXCLUDES:", not_terms)
        print("Q_LEN:", len(params["q"]))

    resp = None
    try:
        resp = requests.get(PATENTSVIEW_BASE, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
    except requests.HTTPError:
        # Retry-on-5xx WITH safety rails (keep anchors + excludes)
        if resp is not None and resp.status_code >= 500:
            minimal_criteria: List[Dict[str, Any]] = [
                {
                    "_or": [
                        {"_text_any": {"patent_title": query_text}},
                        {"_text_any": {"patent_abstract": query_text}},
                    ]
                }
            ]

            if anchors:
                minimal_criteria.append(
                    {
                        "_or": [
                            {"_text_any": {"patent_title": " ".join(anchors[:6])}},
                            {"_text_any": {"patent_abstract": " ".join(anchors[:6])}},
                        ]
                    }
                )

            if not_terms:
                minimal_criteria.append(
                    {
                        "_not": {
                            "_or": (
                                [{"_text_any": {"patent_title": t}} for t in not_terms[:10]]
                                + [{"_text_any": {"patent_abstract": t}} for t in not_terms[:10]]
                            )
                        }
                    }
                )

            minimal_q = (
                {"_and": minimal_criteria}
                if len(minimal_criteria) > 1
                else minimal_criteria[0]
            )

            params_retry = dict(params)
            params_retry["q"] = json.dumps(minimal_q)

            if debug:
                print("RETRY_Q_LEN:", len(params_retry["q"]))

            resp = requests.get(PATENTSVIEW_BASE, headers=headers, params=params_retry, timeout=30)
            resp.raise_for_status()
        else:
            raise

    data = resp.json()
    patents = data.get("patents") or []

    results: List[Dict[str, Any]] = []
    for p in patents:
        title = p.get("patent_title") or "Untitled patent"
        abstract = p.get("patent_abstract") or ""
        patent_id = p.get("patent_id") or "UNKNOWN"
        patent_date = p.get("patent_date") or ""

        year = datetime.utcnow().year
        if isinstance(patent_date, str) and len(patent_date) >= 4:
            try:
                year = int(patent_date[:4])
            except Exception:
                pass

        assignee = "Unknown"
        assignees = p.get("assignees") or []
        if isinstance(assignees, list) and assignees:
            org = assignees[0].get("assignee_organization")
            if org:
                assignee = org

        cpc_label = "CPC (unspecified)"
        cpc_current = p.get("cpc_current") or []
        if isinstance(cpc_current, list) and cpc_current:
            cpc_label = cpc_current[0].get("cpc_subclass_id") or cpc_label

        publication_number = f"US{patent_id}"
        google_url = f"https://patents.google.com/patent/{publication_number}"

        results.append(
            {
                "title": title,
                "publication_number": publication_number,
                "year": year,
                "assignee": assignee,
                "similarity_score": 0.0,
                "cpc_label": cpc_label,
                "why_similar": [],
                "_abstract": abstract,
                "abstract_snippet": _snippet(abstract),
                "google_patents_url": google_url,
            }
        )

    return results[:per_page]
