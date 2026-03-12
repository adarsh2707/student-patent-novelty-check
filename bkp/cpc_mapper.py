# backend/cpc_mapper.py
from typing import List, Optional, Any


def suggest_cpc(domain: Optional[str], technologies: Optional[List[str]]) -> List[str]:
    domain = (domain or "").lower()
    techs = [t.lower() for t in (technologies or [])]

    suggestions: List[str] = []

    if domain == "software":
        suggestions.append("G06F")
        if any(t in techs for t in ["ai/ml", "ai", "machine learning", "ml"]):
            suggestions.append("G06N")

    if domain == "medtech":
        suggestions.append("G16H")

    if domain == "robotics":
        suggestions.append("B25J")

    return list(dict.fromkeys(suggestions))


def generate_why_similar(idea: Any, cpc_label: str) -> list[str]:
    reasons: list[str] = []

    what_it_does = getattr(idea, "what_it_does", None) or []
    domain = getattr(idea, "domain", None) or ""
    technologies = getattr(idea, "technologies", None) or []

    if "Automates process" in what_it_does:
        reasons.append("Also automates part of the workflow you described.")
    if "Analyzes data" in what_it_does:
        reasons.append("Uses data analysis to reach decisions, similar to your idea.")
    if "Hardware control" in what_it_does:
        reasons.append("Involves controlling hardware or equipment, like your use case.")

    if domain:
        reasons.append(f"Falls under a similar domain ({domain}) in the CPC scheme.")

    if technologies:
        reasons.append("Mentions technologies that overlap with yours: " + ", ".join(technologies))

    if not reasons:
        reasons.append("Shares overlapping concepts with your idea based on keywords and CPC.")

    reasons.append(f"Classified in CPC area {cpc_label}, which is related to your idea’s focus.")
    return reasons
