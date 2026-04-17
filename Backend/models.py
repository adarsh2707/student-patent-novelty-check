from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(Text, unique=True, nullable=False, index=True)
    password_hash = Column(Text, nullable=False)
    role = Column(Text, nullable=False, default="student")
    school_domain = Column(Text, nullable=True)
    created_at = Column(Text, nullable=False)
    updated_at = Column(Text, nullable=False)

    sessions = relationship("SessionToken", back_populates="user", cascade="all, delete-orphan")
    searches = relationship("UserSearchHistory", back_populates="user", cascade="all, delete-orphan")


class SessionToken(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    session_token_hash = Column(Text, unique=True, nullable=False, index=True)
    created_at = Column(Text, nullable=False)
    expires_at = Column(Text, nullable=False)
    revoked_at = Column(Text, nullable=True)

    user = relationship("User", back_populates="sessions")


class UserSearchHistory(Base):
    __tablename__ = "user_search_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(Text, nullable=False)

    problem_preview = Column(Text, nullable=True)
    problem_hash = Column(Text, nullable=True)
    domain = Column(Text, nullable=True)
    technologies = Column(Text, nullable=True)
    novelty_preview = Column(Text, nullable=True)
    cpc_used = Column(Text, nullable=True)
    idea_json = Column(Text, nullable=True)

    result_count = Column(Integer, nullable=False, default=0)
    backend_mode = Column(Text, nullable=True)
    response_json = Column(Text, nullable=True)

    user = relationship("User", back_populates="searches")


class SearchLog(Base):
    __tablename__ = "search_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(Text, nullable=False)
    problem = Column(Text, nullable=True)
    domain = Column(Text, nullable=True)
    technologies = Column(Text, nullable=True)
    novelty = Column(Text, nullable=True)
    cpc_suggestions = Column(Text, nullable=True)
    num_results = Column(Integer, nullable=True)
    backend_mode = Column(Text, nullable=True)


class FeedbackLog(Base):
    __tablename__ = "feedback_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(Text, nullable=False)
    publication_number = Column(Text, nullable=False)
    patent_title = Column(Text, nullable=True)
    vote = Column(Text, nullable=False)
    comment = Column(Text, nullable=True)
    idea_problem = Column(Text, nullable=True)
    idea_domain = Column(Text, nullable=True)
    cpc_used = Column(Text, nullable=True)