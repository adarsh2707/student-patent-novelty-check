from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv

from database import SessionLocal
from models import User, SessionToken, UserSearchHistory, SearchLog, FeedbackLog

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SQLITE_PATH = BASE_DIR / "search_logs.db"


def migrate_users(sqlite_conn, db):
    cur = sqlite_conn.cursor()
    cur.execute("""
        SELECT id, email, password_hash, role, school_domain, created_at, updated_at
        FROM users
    """)
    rows = cur.fetchall()

    for r in rows:
        existing = db.query(User).filter(User.id == r[0]).first()
        if existing:
            continue
        db.add(
            User(
                id=r[0],
                email=r[1],
                password_hash=r[2],
                role=r[3],
                school_domain=r[4],
                created_at=r[5],
                updated_at=r[6],
            )
        )
    db.commit()
    print(f"Migrated users: {len(rows)}")


def migrate_sessions(sqlite_conn, db):
    cur = sqlite_conn.cursor()
    cur.execute("""
        SELECT id, user_id, session_token_hash, created_at, expires_at, revoked_at
        FROM sessions
    """)
    rows = cur.fetchall()

    for r in rows:
        existing = db.query(SessionToken).filter(SessionToken.id == r[0]).first()
        if existing:
            continue
        db.add(
            SessionToken(
                id=r[0],
                user_id=r[1],
                session_token_hash=r[2],
                created_at=r[3],
                expires_at=r[4],
                revoked_at=r[5],
            )
        )
    db.commit()
    print(f"Migrated sessions: {len(rows)}")


def migrate_user_search_history(sqlite_conn, db):
    cur = sqlite_conn.cursor()
    cur.execute("""
        SELECT id, user_id, created_at, problem_preview, problem_hash, domain,
               technologies, novelty_preview, cpc_used, idea_json,
               result_count, backend_mode, response_json
        FROM user_search_history
    """)
    rows = cur.fetchall()

    for r in rows:
        existing = db.query(UserSearchHistory).filter(UserSearchHistory.id == r[0]).first()
        if existing:
            continue
        db.add(
            UserSearchHistory(
                id=r[0],
                user_id=r[1],
                created_at=r[2],
                problem_preview=r[3],
                problem_hash=r[4],
                domain=r[5],
                technologies=r[6],
                novelty_preview=r[7],
                cpc_used=r[8],
                idea_json=r[9],
                result_count=r[10],
                backend_mode=r[11],
                response_json=r[12],
            )
        )
    db.commit()
    print(f"Migrated user_search_history: {len(rows)}")


def migrate_search_logs(sqlite_conn, db):
    cur = sqlite_conn.cursor()
    cur.execute("""
        SELECT id, created_at, problem, domain, technologies, novelty,
               cpc_suggestions, num_results, backend_mode
        FROM search_logs
    """)
    rows = cur.fetchall()

    for r in rows:
        existing = db.query(SearchLog).filter(SearchLog.id == r[0]).first()
        if existing:
            continue
        db.add(
            SearchLog(
                id=r[0],
                created_at=r[1],
                problem=r[2],
                domain=r[3],
                technologies=r[4],
                novelty=r[5],
                cpc_suggestions=r[6],
                num_results=r[7],
                backend_mode=r[8],
            )
        )
    db.commit()
    print(f"Migrated search_logs: {len(rows)}")


def migrate_feedback_logs(sqlite_conn, db):
    cur = sqlite_conn.cursor()
    cur.execute("""
        SELECT id, created_at, publication_number, patent_title, vote, comment,
               idea_problem, idea_domain, cpc_used
        FROM feedback_logs
    """)
    rows = cur.fetchall()

    for r in rows:
        existing = db.query(FeedbackLog).filter(FeedbackLog.id == r[0]).first()
        if existing:
            continue
        db.add(
            FeedbackLog(
                id=r[0],
                created_at=r[1],
                publication_number=r[2],
                patent_title=r[3],
                vote=r[4],
                comment=r[5],
                idea_problem=r[6],
                idea_domain=r[7],
                cpc_used=r[8],
            )
        )
    db.commit()
    print(f"Migrated feedback_logs: {len(rows)}")


def main():
    if not SQLITE_PATH.exists():
        raise FileNotFoundError(f"SQLite DB not found: {SQLITE_PATH}")

    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    db = SessionLocal()

    try:
        migrate_users(sqlite_conn, db)
        migrate_sessions(sqlite_conn, db)
        migrate_user_search_history(sqlite_conn, db)
        migrate_search_logs(sqlite_conn, db)
        migrate_feedback_logs(sqlite_conn, db)
        print("SQLite → PostgreSQL migration complete.")
    finally:
        sqlite_conn.close()
        db.close()


if __name__ == "__main__":
    main()