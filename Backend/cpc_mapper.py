from __future__ import annotations

import re
from typing import List, Optional

# Broad idea-side CPC suggestion rules
CPC_SUGGESTION_RULES = [
    {
        "label": "A61B",
        "terms": [
            "heart", "ecg", "eeg", "diagnosis", "diagnostic", "monitoring",
            "wearable", "patient", "vitals", "biosignal", "disease", "medical"
        ],
        "human": "Medical diagnosis, monitoring & sensing",
    },
    {
        "label": "A61M",
        "terms": [
            "infusion", "ventilation", "catheter", "drug delivery", "therapy", "pump"
        ],
        "human": "Devices for introducing media into the body",
    },
    {
        "label": "G16H",
        "terms": [
            "hospital", "ehr", "telemedicine", "clinical decision", "digital health"
        ],
        "human": "Digital health / healthcare informatics",
    },
    {
        "label": "G06N",
        "terms": [
            "ai", "ml", "machine learning", "deep learning", "prediction",
            "classification", "computer vision", "nlp", "reinforcement learning"
        ],
        "human": "AI / machine learning",
    },
    {
        "label": "G06F",
        "terms": [
            "software", "application", "workflow", "platform", "automation",
            "database", "analytics", "dashboard", "scheduler"
        ],
        "human": "Computing / data processing",
    },
    {
        "label": "G06Q",
        "terms": [
            "inventory", "warehouse", "supply chain", "forecasting", "operations",
            "retail", "commerce", "planning", "order"
        ],
        "human": "Business methods / commerce / operations",
    },
    {
        "label": "G01C",
        "terms": [
            "navigation", "gps", "mapping", "route", "routing", "positioning", "location"
        ],
        "human": "Navigation / positioning / mapping",
    },
    {
        "label": "G08B",
        "terms": [
            "alert", "alarm", "warning", "incident", "surveillance", "notification"
        ],
        "human": "Alarm / monitoring systems",
    },
    {
        "label": "G09B",
        "terms": [
            "student", "learning", "education", "training", "assignment", "curriculum"
        ],
        "human": "Education / teaching aids",
    },
    {
        "label": "B25J",
        "terms": [
            "robot", "robotic", "manipulator", "actuator", "industrial robot"
        ],
        "human": "Industrial robots / manipulators",
    },
    {
        "label": "B65G",
        "terms": [
            "conveyor", "material handling", "sorting", "fulfillment", "picking", "packing"
        ],
        "human": "Conveying / warehouse handling",
    },
    {
        "label": "A01B",
        "terms": [
            "farm", "agriculture", "soil", "field", "irrigation", "harvest"
        ],
        "human": "Agriculture / field operations",
    },
    {
        "label": "A01C",
        "terms": [
            "seed", "seeding", "planting", "sowing", "cultivation"
        ],
        "human": "Planting / seeding / cultivation",
    },
    {
        "label": "A01G",
        "terms": [
            "crop", "plant disease", "crop health", "pest", "leaf", "plant stress"
        ],
        "human": "Crop health / plant care",
    },
]


CPC_HUMAN = {
    "A61B": "Medical diagnosis, monitoring & sensing",
    "A61M": "Devices for introducing media into the body",
    "G16H": "Digital health / healthcare informatics",
    "G06N": "AI / machine learning",
    "G06F": "Computing / data processing",
    "G06Q": "Business methods / commerce / operations",
    "G01C": "Navigation / positioning / mapping",
    "G08B": "Alarm / monitoring systems",
    "G09B": "Education / teaching aids",
    "B25J": "Industrial robots / manipulators",
    "B65G": "Conveying / warehouse handling",
    "A01B": "Agriculture / field operations",
    "A01C": "Planting / seeding / cultivation",
    "A01G": "Crop health / plant care",
}


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9\s\-_/]+", " ", text or "")).strip().lower()


def suggest_cpc(domain: Optional[str], technologies: Optional[List[str]]) -> List[str]:
    domain_text = _clean(domain or "")
    tech_text = _clean(" ".join(technologies or []))
    blob = f"{domain_text} {tech_text}".strip()

    if not blob:
        return ["G06F"]

    scores = []
    for rule in CPC_SUGGESTION_RULES:
        score = 0
        for term in rule["terms"]:
            t = _clean(term)
            if t and t in blob:
                score += 1
        if score > 0:
            scores.append((score, rule["label"]))

    scores.sort(key=lambda x: x[0], reverse=True)

    out = []
    seen = set()
    for _, label in scores[:4]:
        if label not in seen:
            seen.add(label)
            out.append(label)

    if not out:
        if domain_text == "medtech":
            return ["A61B", "G16H", "G06N"]
        if domain_text == "robotics":
            return ["B25J", "G06N", "G06F"]
        if domain_text == "agriculture":
            return ["A01G", "A01B", "G06N"]
        if domain_text == "software":
            return ["G06F", "G06N", "G06Q"]
        return ["G06F", "G06N"]

    return out


def _cpc_match_type(idea_cpcs: List[str], patent_cpc: str) -> str:
    patent_cpc = (patent_cpc or "").strip().upper()
    cleaned = [(x or "").strip().upper() for x in (idea_cpcs or []) if (x or "").strip()]
    if not patent_cpc or not cleaned:
        return "general"

    for target in cleaned:
        if patent_cpc == target:
            return "exact"
        if patent_cpc.startswith(target) or target.startswith(patent_cpc):
            return "descendant"
        if len(patent_cpc) >= 4 and len(target) >= 4 and patent_cpc[:4] == target[:4]:
            return "subclass"
        if len(patent_cpc) >= 3 and len(target) >= 3 and patent_cpc[:3] == target[:3]:
            return "class"
        if patent_cpc[:1] == target[:1]:
            return "section"

    return "general"


def _domain_phrase(domain: Optional[str]) -> str:
    d = (domain or "").strip()
    if not d:
        return "technical domain"
    return d.lower()


def generate_why_similar(idea, cpc_label: str) -> List[str]:
    problem = (getattr(idea, "problem", "") or "").strip()
    domain = _domain_phrase(getattr(idea, "domain", None))
    technologies = getattr(idea, "technologies", None) or []
    novelty = (getattr(idea, "novelty", "") or "").strip()
    idea_cpcs = suggest_cpc(getattr(idea, "domain", None), technologies)

    tech_phrase = ", ".join(technologies[:3]) if technologies else "the core technical approach"
    cpc_human = CPC_HUMAN.get((cpc_label or "").strip().upper()[:4], "the relevant technical area")
    match_type = _cpc_match_type(idea_cpcs, cpc_label)

    reasons: List[str] = []

    if problem:
        reasons.append(
            f"This patent appears relevant to your problem area around {problem[:110].rstrip('.')}."
        )

    if match_type == "exact":
        reasons.append(
            f"It aligns directly with the CPC category {cpc_label}, which closely matches your inferred technical focus in {cpc_human.lower()}."
        )
    elif match_type == "descendant":
        reasons.append(
            f"It falls within a more specific branch of the CPC area {cpc_label}, which is strongly aligned with your inferred focus in {cpc_human.lower()}."
        )
    elif match_type == "subclass":
        reasons.append(
            f"It shares the same CPC subclass family as your idea, suggesting strong overlap in {cpc_human.lower()}."
        )
    elif match_type == "class":
        reasons.append(
            f"It is in a closely related CPC class, indicating partial technical overlap with your concept."
        )
    elif match_type == "section":
        reasons.append(
            f"It sits in the same broader CPC section, which suggests some relevance at the domain level."
        )
    else:
        reasons.append(
            f"It maps to {cpc_human.lower()}, which is still relevant to your {domain} concept."
        )

    reasons.append(
        f"The technical approach overlaps with your idea through {tech_phrase}."
    )

    if novelty:
        reasons.append(
            f"Your novelty statement also points toward similar mechanisms or use cases, especially around {novelty[:110].rstrip('.')}."
        )

    # keep it tight
    deduped = []
    seen = set()
    for r in reasons:
        key = r.lower().strip()
        if key not in seen and r.strip():
            seen.add(key)
            deduped.append(r)

    return deduped[:4]