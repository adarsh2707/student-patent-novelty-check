from __future__ import annotations

from pathlib import Path
from typing import List

try:
    from sentence_transformers import SentenceTransformer, util
except Exception:
      SentenceTransformer = None
      util = None

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models" / "all-MiniLM-L6-v2"

_model = None


def get_model():
    global _model

    if SentenceTransformer is None:
        return None

    if _model is None:
        if not MODEL_DIR.exists():
            raise RuntimeError(f"Local model not found at: {MODEL_DIR}")
        _model = SentenceTransformer(str(MODEL_DIR))
    return _model


def rerank(query: str, docs: List[str]) -> List[float]:
    if not docs:
        return []

    model = get_model()
    if model is None or util is None:
       return [0.5] * len(docs)

    query_embedding = model.encode(query, convert_to_tensor=True, normalize_embeddings=True)
    doc_embeddings = model.encode(docs, convert_to_tensor=True, normalize_embeddings=True)

    scores = util.cos_sim(query_embedding, doc_embeddings)[0]
    return [float(x) for x in scores]
