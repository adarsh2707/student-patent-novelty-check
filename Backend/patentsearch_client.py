from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

PATENTSVIEW_BASE = "https://search.patentsview.org/api/v1/patent/"
HTTP_TIMEOUT = 6


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


def _dedupe_preserve(xs: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for x in xs:
        if not x:
            continue
        k = x.strip().upper()
        if k in seen:
            continue
        seen.add(k)
        out.append(k)
    return out


def _compact_cpc(code: str) -> str:
    return (code or "").strip().upper().replace(" ", "")


def _extract_cpc_list(patent_obj: Dict[str, Any]) -> List[str]:
    cpcs: List[str] = []
    cpc_current = patent_obj.get("cpc_current") or []
    if isinstance(cpc_current, list):
        for c in cpc_current:
            if isinstance(c, dict):
                v = (c.get("cpc_subclass_id") or "").strip()
                if v:
                    cpcs.append(v.upper().replace(" ", ""))
    return _dedupe_preserve(cpcs)


def _extract_cpc_full_codes(patent_obj: Dict[str, Any]) -> List[str]:
    subclass: List[str] = []
    group: List[str] = []
    subgroup: List[str] = []

    cpc_current = patent_obj.get("cpc_current") or []
    if isinstance(cpc_current, list):
        for c in cpc_current:
            if not isinstance(c, dict):
                continue

            sc = (c.get("cpc_subclass_id") or "").strip()
            if sc:
                subclass.append(sc)

            g = (c.get("cpc_group_id") or "").strip()
            if g:
                group.append(g)

            sg = (c.get("cpc_subgroup_id") or "").strip()
            if sg:
                subgroup.append(sg)

    combined = subgroup + group + subclass
    return _dedupe_preserve([x.replace(" ", "") for x in combined])


def _build_text_any_clauses(field: str, phrases: List[str]) -> List[Dict[str, Any]]:
    clauses = []
    for p in phrases:
        cleaned = _clean_term(p)
        if cleaned:
            clauses.append({"_text_any": {field: cleaned}})
    return clauses


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
    return [v for v in _dedupe_preserve([v for v in variants if v]) if v]


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


def _search_once(
    *,
    api_key: str,
    query_text: str,
    anchors: List[str],
    kw_terms: List[str],
    not_terms: List[str],
    assignee_filter: str,
    year_from: Optional[int],
    year_to: Optional[int],
    cpc_filters_norm: List[str],
    limit: int,
    require_anchors: bool,
    require_keywords: bool,
    debug: bool = False,
) -> List[Dict[str, Any]]:
    criteria: List[Dict[str, Any]] = []

    title_abs_query = []
    if query_text:
        title_abs_query.extend(_build_text_any_clauses("patent_title", [query_text]))
        title_abs_query.extend(_build_text_any_clauses("patent_abstract", [query_text]))
        if title_abs_query:
            criteria.append({"_or": title_abs_query})

    if require_anchors and anchors:
        anchor_clauses = []
        anchor_clauses.extend(_build_text_any_clauses("patent_title", anchors[:6]))
        anchor_clauses.extend(_build_text_any_clauses("patent_abstract", anchors[:6]))
        if anchor_clauses:
            criteria.append({"_or": anchor_clauses})

    if require_keywords and kw_terms:
        kw_clauses = []
        kw_clauses.extend(_build_text_any_clauses("patent_title", kw_terms[:8]))
        kw_clauses.extend(_build_text_any_clauses("patent_abstract", kw_terms[:8]))
        if kw_clauses:
            criteria.append({"_or": kw_clauses})

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

    if assignee_filter:
        criteria.append({"_text_any": {"assignees.assignee_organization": assignee_filter}})

    if year_from and isinstance(year_from, int):
        criteria.append({"_gte": {"patent_date": f"{year_from}-01-01"}})
    if year_to and isinstance(year_to, int):
        criteria.append({"_lte": {"patent_date": f"{year_to}-12-31"}})

    # Retrieval hint only: use top4 subclass filters when provided
    if cpc_filters_norm:
        cpc_or = []
        for c in cpc_filters_norm[:8]:
            top4 = c[:4]
            if top4:
                cpc_or.append({"_eq": {"cpc_current.cpc_subclass_id": top4}})
        if cpc_or:
            criteria.append({"_or": cpc_or})

    if not criteria:
        q = {"_text_any": {"patent_abstract": "innovation"}}
    elif len(criteria) == 1:
        q = criteria[0]
    else:
        q = {"_and": criteria}

    f = [
        "patent_id",
        "patent_title",
        "patent_date",
        "patent_abstract",
        "assignees.assignee_organization",
        "cpc_current.cpc_subclass_id",
        "cpc_current.cpc_group_id",
        "cpc_current.cpc_subgroup_id",
    ]

    per_page = max(1, min(int(limit), 100))
    o = {"size": per_page, "from": 0}

    headers = {"X-Api-Key": api_key, "Accept": "application/json"}
    params = {"q": json.dumps(q), "f": json.dumps(f), "o": json.dumps(o)}

    if debug:
        print("[_search_once] query_text:", query_text)
        print("[_search_once] Q_LEN:", len(params["q"]))

    resp = requests.get(PATENTSVIEW_BASE, headers=headers, params=params, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()

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
            org = assignees[0].get("assignee_organization") if isinstance(assignees[0], dict) else None
            if org:
                assignee = org

        cpc_list = _extract_cpc_list(p)
        cpc_full_codes = _extract_cpc_full_codes(p)

        publication_number = f"US{patent_id}"
        google_url = f"https://patents.google.com/patent/{publication_number}"
        cpc_label = cpc_list[0] if cpc_list else "CPC (unspecified)"

        text_blob = f"{title} {abstract}"
        lexical_score = _keyword_presence_score(text_blob, kw_terms + anchors[:4], not_terms)
        anchor_hits = sum(1 for a in anchors[:6] if a.lower() in text_blob.lower()) if anchors else 0
        client_score = lexical_score + min(0.18, anchor_hits * 0.04)

        results.append(
            {
                "title": title,
                "publication_number": publication_number,
                "year": year,
                "assignee": assignee,
                "similarity_score": 0.0,
                "cpc_label": cpc_label,
                "cpc_list": cpc_list,
                "cpc_full_codes": cpc_full_codes,
                "why_similar": [],
                "_abstract": abstract,
                "abstract_snippet": _snippet(abstract),
                "google_patents_url": google_url,
                "_client_score": client_score,
            }
        )

    return results


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

    anchors = anchors or []
    anchors = [_clean_term(a) for a in anchors if _clean_term(a)]
    anchors = anchors[:8]

    kw_terms = [_clean_term(k) for k in keywords[:10] if _clean_term(k)]
    not_terms = [_clean_term(k) for k in exclude_keywords[:12] if _clean_term(k)]

    if not kw_terms:
        require_keywords = False

    cpc_filters_norm = _normalize_list(cpc_filters) if cpc_filters else []
    cpc_filters_norm = [_compact_cpc(c) for c in cpc_filters_norm if _compact_cpc(c)]
    cpc_filters_norm = _dedupe_preserve(cpc_filters_norm)[:8]

    if debug:
        print("ANCHORS:", anchors)
        print("KW_TERMS:", kw_terms)
        print("EXCLUDES:", not_terms)
        print("CPC_FILTERS:", cpc_filters_norm)

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
    per_variant_limit = max(10, min(limit, 40))

    search_plans = [
        {"name": "strict", "require_anchors": require_anchors, "require_keywords": require_keywords},
        {"name": "anchors_only", "require_anchors": require_anchors, "require_keywords": False},
        {"name": "keywords_only", "require_anchors": False, "require_keywords": require_keywords},
        {"name": "broad", "require_anchors": False, "require_keywords": False},
    ]

    for variant in query_variants[:4]:
        for plan in search_plans:
            try:
                rows = _search_once(
                    api_key=api_key,
                    query_text=variant,
                    anchors=anchors,
                    kw_terms=kw_terms,
                    not_terms=not_terms,
                    assignee_filter=assignee_filter,
                    year_from=year_from,
                    year_to=year_to,
                    cpc_filters_norm=cpc_filters_norm,
                    limit=per_variant_limit,
                    require_anchors=plan["require_anchors"],
                    require_keywords=plan["require_keywords"],
                    debug=debug,
                )
                if debug:
                    print(f"[search_real_patents] variant={variant!r} plan={plan['name']} rows={len(rows)}")
                all_rows.extend(rows)
            except Exception as e:
                if debug:
                    print(f"[search_real_patents] variant={variant!r} plan={plan['name']} failed: {e}")

    merged = _merge_unique_patents(all_rows)

    # No hard CPC filtering here.
    # main.py handles strict hierarchical CPC filtering consistently.

    merged.sort(key=lambda x: float(x.get("_client_score", 0.0) or 0.0), reverse=True)

    for r in merged:
        r.pop("_client_score", None)

    return merged[: max(1, min(limit, 100))]


def _try_patentsview_detail_query(publication_number: str, fields: List[str]) -> Dict[str, Any]:
    api_key = os.getenv("PATENTSVIEW_API_KEY")
    if not api_key:
        return {}

    patent_id = re.sub(r"^US", "", (publication_number or "").strip(), flags=re.IGNORECASE)

    q = {"_eq": {"patent_id": patent_id}}
    o = {"size": 1, "from": 0}

    headers = {"X-Api-Key": api_key, "Accept": "application/json"}
    params = {"q": json.dumps(q), "f": json.dumps(fields), "o": json.dumps(o)}

    try:
        resp = requests.get(PATENTSVIEW_BASE, headers=headers, params=params, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        patents = data.get("patents") or []
        if patents:
            return patents[0]
    except Exception as e:
        print(f"[detail-query] failed for {publication_number}: {e}")

    return {}


def get_patent_details(publication_number: str) -> Dict[str, Any]:
    pub = (publication_number or "").strip()
    if not pub:
        return {}

    fields = [
        "patent_id",
        "patent_title",
        "patent_abstract",
        "patent_num_claims",
        "patent_claims",
        "patent_description",
    ]

    p = _try_patentsview_detail_query(pub, fields)

    title = p.get("patent_title") or ""
    abstract = p.get("patent_abstract") or ""

    raw_claims = p.get("patent_claims") or ""
    raw_description = p.get("patent_description") or ""

    claims = ""
    brief_summary = ""

    if isinstance(raw_claims, str):
        claims = raw_claims.strip()
    elif isinstance(raw_claims, list):
        claims = " ".join([str(x).strip() for x in raw_claims if str(x).strip()])

    if isinstance(raw_description, str):
        desc = raw_description.strip()
        m = re.search(
            r"(brief summary|summary of the invention)(.*?)(detailed description|description of the drawings|claims)",
            desc,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if m:
            brief_summary = re.sub(r"\s+", " ", m.group(2)).strip()
        else:
            brief_summary = desc[:1200].strip()

    return {
        "title": title,
        "abstract": abstract,
        "brief_summary": brief_summary,
        "claims": claims,
    }