from __future__ import annotations

import json
import hashlib
from collections import Counter
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from sqlalchemy.orm import Session as DBSession

from models import FeedbackLog, SearchLog, User, UserSearchHistory
from schemas import IdeaInput

def safe_preview(text: str, max_len: int = 140) -> str:
    t = " ".join((text or "").strip().split())
    if not t:
        return ""
    if len(t) <= max_len:
        return t
    return t[:max_len].rstrip() + "…"


def sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").strip().encode("utf-8")).hexdigest()


def log_search(
    db: DBSession,
    *,
    problem: str,
    domain: str,
    technologies: List[str],
    novelty: str,
    cpc_suggestions: List[str],
    num_results: int,
    backend_mode: str,
) -> None:
    try:
        row = SearchLog(
            created_at=datetime.utcnow().isoformat(timespec="seconds"),
            problem=problem,
            domain=domain,
            technologies=", ".join(technologies or []),
            novelty=novelty,
            cpc_suggestions=", ".join(cpc_suggestions or []),
            num_results=int(num_results),
            backend_mode=backend_mode,
        )
        db.add(row)
        db.commit()
    except Exception as e:
        db.rollback()
        print("[search_logs] Error while logging search:", e)


def log_feedback(
    db: DBSession,
    *,
    publication_number: str,
    patent_title: str,
    vote: str,
    comment: str,
    idea_problem: str,
    idea_domain: str,
    cpc_used: List[str],
) -> None:
    try:
        row = FeedbackLog(
            created_at=datetime.utcnow().isoformat(timespec="seconds"),
            publication_number=publication_number,
            patent_title=patent_title,
            vote=vote,
            comment=comment,
            idea_problem=idea_problem,
            idea_domain=idea_domain,
            cpc_used=", ".join(cpc_used or []),
        )
        db.add(row)
        db.commit()
    except Exception as e:
        db.rollback()
        print("[feedback_logs] Error while logging feedback:", e)


def save_user_search_history(
    db: DBSession,
    *,
    user_id: int,
    idea: IdeaInput,
    cpc_used: List[str],
    result_count: int,
    backend_mode: str,
    response_obj: Dict,
) -> Optional[int]:
    try:
        row = UserSearchHistory(
            user_id=int(user_id),
            created_at=datetime.utcnow().isoformat(timespec="seconds"),
            problem_preview=safe_preview(idea.problem, 140),
            problem_hash=sha256_text(idea.problem),
            domain=idea.domain or "",
            technologies=", ".join(idea.technologies or []),
            novelty_preview=safe_preview(idea.novelty or "", 140),
            cpc_used=", ".join(cpc_used or []),
            result_count=int(result_count),
            backend_mode=backend_mode,
            response_json=json.dumps(response_obj),
            idea_json=json.dumps(idea.model_dump()),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        
        print("[user_search_history] saved row id:", row.id);
        return row.id
    except Exception as e:
        db.rollback()
        print("[user_search_history] Error while saving history:", e)
        return None

def delete_user_search_history(db: DBSession, history_id: int, user_id: int) -> bool:
    try:
        row = (
            db.query(UserSearchHistory)
            .filter(
                UserSearchHistory.id == int(history_id),
                UserSearchHistory.user_id == int(user_id),
            )
            .first()
        )

        if not row:
            return False

        db.delete(row)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        print("[user_search_history] Error while deleting history row:", e)
        return False

def list_user_search_history_rows(db: DBSession, user_id: int, limit: int = 25) -> List[Dict[str, object]]:
    try:
        rows = (
            db.query(UserSearchHistory)
            .filter(UserSearchHistory.user_id == int(user_id))
            .order_by(UserSearchHistory.id.desc())
            .limit(int(limit))
            .all()
        )

        return [
            {
                "id": r.id,
                "user_id": r.user_id,
                "created_at": r.created_at,
                "problem_preview": r.problem_preview,
                "problem_hash": r.problem_hash,
                "domain": r.domain,
                "technologies": r.technologies,
                "novelty_preview": r.novelty_preview,
                "cpc_used": r.cpc_used,
                "result_count": r.result_count,
                "backend_mode": r.backend_mode,
            }
            for r in rows
        ]
    except Exception as e:
        print("[user_search_history] Error while listing history:", e)
        return []


def get_user_search_history_row(db: DBSession, history_id: int, user_id: int) -> Optional[Dict]:
    try:
        row = (
            db.query(UserSearchHistory)
            .filter(
                UserSearchHistory.id == int(history_id),
                UserSearchHistory.user_id == int(user_id),
            )
            .first()
        )

        if not row:
            return None

        out = {
            "id": row.id,
            "user_id": row.user_id,
            "created_at": row.created_at,
            "problem_preview": row.problem_preview,
            "problem_hash": row.problem_hash,
            "domain": row.domain,
            "technologies": row.technologies,
            "novelty_preview": row.novelty_preview,
            "cpc_used": row.cpc_used,
            "result_count": row.result_count,
            "backend_mode": row.backend_mode,
            "response_json": row.response_json,
            "idea_json": row.idea_json,
        }

        raw_json = out.get("response_json") or ""
        try:
            out["response_obj"] = json.loads(raw_json) if raw_json else None
        except Exception:
            out["response_obj"] = None

        raw_idea_json = out.get("idea_json") or ""
        try:
            out["idea_obj"] = json.loads(raw_idea_json) if raw_idea_json else None
        except Exception:
            out["idea_obj"] = None

        return out
    except Exception as e:
        print("[user_search_history] Error while reading history row:", e)
        return None


def admin_count_metrics(db: DBSession) -> Dict[str, int]:
    try:
        total_searches = db.query(SearchLog).count()
        total_feedback = db.query(FeedbackLog).count()
        total_users = db.query(User).count()

        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)

        searches_last_7_days = (
            db.query(SearchLog)
            .filter(SearchLog.created_at >= seven_days_ago.isoformat(timespec="seconds"))
            .count()
        )

        searches_last_30_days = (
            db.query(SearchLog)
            .filter(SearchLog.created_at >= thirty_days_ago.isoformat(timespec="seconds"))
            .count()
        )

        return {
            "total_searches": total_searches,
            "total_feedback": total_feedback,
            "total_users": total_users,
            "searches_last_7_days": searches_last_7_days,
            "searches_last_30_days": searches_last_30_days,
        }
    except Exception as e:
        print("[admin_count_metrics] error:", e)
        return {
            "total_searches": 0,
            "total_feedback": 0,
            "total_users": 0,
            "searches_last_7_days": 0,
            "searches_last_30_days": 0,
        }


def _split_csv_text(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [x.strip() for x in value.split(",") if x.strip()]


def admin_top_lists(db: DBSession, limit: int = 10) -> List[Dict[str, object]]:
    try:
        rows = db.query(SearchLog).order_by(SearchLog.id.desc()).all()

        domain_counter = Counter()
        tech_counter = Counter()
        backend_counter = Counter()

        for row in rows:
            domain = (row.domain or "").strip()
            backend_mode = (row.backend_mode or "").strip()
            technologies = row.technologies or ""

            if domain:
                domain_counter[domain] += 1

            if backend_mode:
                backend_counter[backend_mode] += 1

            for tech in _split_csv_text(technologies):
                tech_counter[tech] += 1

        return {
            "top_domains": [{"label": k, "count": int(v)} for k, v in domain_counter.most_common(limit)],
            "top_technologies": [{"label": k, "count": int(v)} for k, v in tech_counter.most_common(limit)],
            "top_backend_modes": [{"label": k, "count": int(v)} for k, v in backend_counter.most_common(limit)],
        }
    except Exception as e:
        print("[admin_top_lists] error:", e)
        return {
            "top_domains": [],
            "top_technologies": [],
            "top_backend_modes": [],
        }


def admin_recent_searches(db: DBSession, limit: int = 25) -> List[Dict[str, object]]:
    try:
        rows = (
            db.query(UserSearchHistory)
            .order_by(UserSearchHistory.id.desc())
            .limit(int(limit))
            .all()
        )

        return [
            {
                "id": r.id,
                "user_id": r.user_id,
                "created_at": r.created_at,
                "problem_preview": r.problem_preview,
                "domain": r.domain,
                "technologies": r.technologies,
                "backend_mode": r.backend_mode,
                "result_count": r.result_count,
            }
            for r in rows
        ]
    except Exception as e:
        print("[admin_recent_searches] error:", e)
        return []