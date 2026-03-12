# backend/semantic_ranker.py
from __future__ import annotations

from functools import lru_cache
from typing import List
import os

# IMPORTANT: keep imports inside try so backend won't crash if deps missing
try:
    import numpy as np
    from sentence_transformers import SentenceTransformer
    _HAS_EMBED_DEPS = True
except Exception as e:
    print("[semantic_ranker] embedding deps not available:", e)
    _HAS_EMBED_DEPS = False
    np = None  # type: ignore
    SentenceTransformer = None  # type: ignore


@lru_cache(maxsize=1)
def _model():
    """
    Cached model instance (loads once).
    Uses env var EMBED_MODEL if provided.
    """
    if not _HAS_EMBED_DEPS:
        raise RuntimeError("Embedding dependencies are missing.")
    model_name = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
    return SentenceTransformer(model_name)


def rerank(query_text: str, docs: List[str], *, max_docs: int = 200) -> List[float]:
    """
    Returns similarity scores [0..1] aligned to docs order.

    - Encodes query + docs in ONE batch for speed.
    - Uses normalize_embeddings=True so cosine = dot product.
    - Never crashes your API: falls back to neutral scores if model fails.
    """
    # Basic guards
    docs = docs or []
    if not query_text or not query_text.strip() or not docs:
        return [0.0 for _ in docs]

    # Prevent runaway reranking
    if len(docs) > max_docs:
        docs = docs[:max_docs]

    # If deps missing, return neutral mid scores so pipeline still works
    if not _HAS_EMBED_DEPS:
        return [0.5 for _ in docs]

    try:
        m = _model()

        # Batch encode: [query] + docs -> embeddings
        texts = [query_text] + docs
        embs = m.encode(
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        q = embs[0]          # (d,)
        d = embs[1:]         # (n, d)

        # Because normalized, cosine similarity = dot product
        sims = (d @ q).tolist()

        # Clamp [0..1] (cosine can be slightly negative)
        sims = [max(0.0, min(1.0, float(s))) for s in sims]

        # If we truncated docs due to max_docs, pad remaining with low scores
        if len(sims) < len(docs):
            sims.extend([0.0] * (len(docs) - len(sims)))

        return sims

    except Exception as e:
        print("[semantic_ranker] rerank failed, using fallback scores:", e)
        return [0.5 for _ in docs]
