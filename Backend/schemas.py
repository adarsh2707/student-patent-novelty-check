from __future__ import annotations

from enum import Enum
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


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
    cpc_codes: List[str] = Field(default_factory=list)
    cpc_full_codes: List[str] = Field(default_factory=list)
    cpc_human: Optional[str] = None
    cpc_alignment_score: Optional[float] = None
    rank_explanations: List[str] = Field(default_factory=list)
    section_hits: Dict[str, List[str]] = Field(default_factory=dict)
    claim_support: List[str] = Field(default_factory=list)


class SearchResponse(BaseModel):
    input_summary: str
    domain: Optional[str]
    cpc_used: List[str]
    backend_mode: str
    results: List[PatentResult]
    cpc_stats: Dict[str, int] = Field(default_factory=dict)
    cpc_human_map: Dict[str, str] = Field(default_factory=dict)


class FeedbackRequest(BaseModel):
    idea_problem: str
    idea_domain: Optional[str] = None
    cpc_used: List[str] = Field(default_factory=list)
    publication_number: str
    patent_title: Optional[str] = None
    vote: Literal["up", "down"]
    comment: Optional[str] = None


class JobState(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class SearchJobCreateResponse(BaseModel):
    job_id: str
    status: JobState
    message: str = "Search queued"


class SearchJobStatusResponse(BaseModel):
    job_id: str
    status: JobState
    progress: int = 0
    stage: str = "queued"
    error: Optional[str] = None


class SearchJobResultResponse(BaseModel):
    job_id: str
    status: JobState
    result: Optional[SearchResponse] = None
    error: Optional[str] = None


class SearchHistoryItem(BaseModel):
    id: int
    created_at: str
    problem_preview: Optional[str] = None
    problem_hash: Optional[str] = None
    domain: Optional[str] = None
    technologies: Optional[str] = None
    novelty_preview: Optional[str] = None
    cpc_used: Optional[str] = None
    result_count: int
    backend_mode: Optional[str] = None


class SearchHistoryListResponse(BaseModel):
    items: List[SearchHistoryItem]


class SearchHistoryDetailResponse(BaseModel):
    id: int
    created_at: str
    problem_preview: Optional[str] = None
    problem_hash: Optional[str] = None
    domain: Optional[str] = None
    technologies: Optional[str] = None
    novelty_preview: Optional[str] = None
    cpc_used: Optional[str] = None
    result_count: int
    backend_mode: Optional[str] = None
    response: Optional[SearchResponse] = None
    idea: Optional[IdeaInput] = None


class AdminAnalyticsSummaryResponse(BaseModel):
    total_searches: int
    total_feedback: int
    total_users: int
    searches_last_7_days: int
    searches_last_30_days: int


class AdminTopItem(BaseModel):
    label: str
    count: int


class AdminRecentSearchItem(BaseModel):
    id: int
    created_at: str
    problem_preview: Optional[str] = None
    domain: Optional[str] = None
    technologies: Optional[str] = None
    backend_mode: Optional[str] = None
    result_count: Optional[int] = None
    user_id: Optional[int] = None


class AdminRecentSearchesResponse(BaseModel):
    items: List[AdminRecentSearchItem]


class AdminTopListsResponse(BaseModel):
    top_domains: List[AdminTopItem]
    top_technologies: List[AdminTopItem]
    top_backend_modes: List[AdminTopItem]