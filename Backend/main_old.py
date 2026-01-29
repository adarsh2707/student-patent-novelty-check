from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional

from cpc_mapper import suggest_cpc


app = FastAPI(title="Student Patent Novelty Check - Backend")


# ---------- Request / Response Models ----------

class IdeaInput(BaseModel):
    problem: str
    what_it_does: Optional[List[str]] = None
    domain: Optional[str] = None
    technologies: Optional[List[str]] = None
    novelty: Optional[str] = None


class SearchRequest(BaseModel):
    idea: IdeaInput
    # optional CPC suggestions from the previous step
    cpc_suggestions: Optional[List[str]] = None


class PatentResult(BaseModel):
    title: str
    publication_number: str
    year: int
    assignee: str
    similarity_score: float   # 0–1 for now
    cpc_label: str
    why_similar: List[str]


class SearchResponse(BaseModel):
    input_summary: str
    domain: Optional[str]
    cpc_used: List[str]
    results: List[PatentResult]


# ---------- Health & Parse Input ----------

@app.get("/health")
def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "message": "Backend is running"}


@app.post("/parse-input")
def parse_input(idea: IdeaInput):
    """
    Accepts structured idea input from the guided form.

    Current responsibilities:
    - Echo back the received idea
    - Suggest CPC codes using simple rule-based logic
    - (Later) will also clean text, extract keywords, and prepare for search
    """
    cpc_suggestions = suggest_cpc(idea.domain, idea.technologies)

    return {
        "received": idea,
        "cpc_suggestions": cpc_suggestions,
        "keywords_example": ["automation", "students", "AI"],  # placeholder
    }


# ---------- Mock Search Endpoint ----------

@app.post("/search", response_model=SearchResponse)
def search_patents(payload: SearchRequest):
    """
    Mock search endpoint.

    For now, this does NOT hit a real database.
    It:
    - Takes the user's idea and optional CPC suggestions
    - Builds a simple input summary
    - Returns a static list of 'fake' but realistic patent results

    Later this will:
    - Use embeddings + CPC filters against a real patent database.
    """

    idea = payload.idea

    # If frontend didn't send CPC suggestions, compute them here
    cpc_used = payload.cpc_suggestions or suggest_cpc(
        idea.domain,
        idea.technologies
    )

    input_summary = f"Idea about: {idea.problem}"

    # --- Mock results (hard-coded for now) ---
    mock_results = [
        PatentResult(
            title="Intelligent Assignment Reminder System for Students",
            publication_number="US2023000001A1",
            year=2023,
            assignee="Example University",
            similarity_score=0.86,
            cpc_label="G06F — Digital data processing",
            why_similar=[
                "Also targets student productivity and deadlines",
                "Uses software to send automated reminders",
            ],
        ),
        PatentResult(
            title="Natural Language Processing for Academic Task Management",
            publication_number="US2022000123A1",
            year=2022,
            assignee="EduTech Corp.",
            similarity_score=0.81,
            cpc_label="G06N — AI systems",
            why_similar=[
                "Uses NLP to analyze text-based tasks",
                "Focuses on organizing assignments and schedules",
            ],
        ),
        PatentResult(
            title="System and Method for Time-Management Notifications",
            publication_number="US2021000456A1",
            year=2021,
            assignee="Productivity Labs",
            similarity_score=0.74,
            cpc_label="G06Q — Data processing for administrative purposes",
            why_similar=[
                "Provides automated notifications for upcoming tasks",
                "Addresses similar problem of missed deadlines",
            ],
        ),
    ]

    return SearchResponse(
        input_summary=input_summary,
        domain=idea.domain,
        cpc_used=cpc_used,
        results=mock_results,
    )
