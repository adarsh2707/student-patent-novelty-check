# Student Patent Novelty Check

Student Patent Novelty Check is a web-based application that helps students, researchers, and early-stage innovators identify potentially relevant prior art by searching patent data, ranking similar patents, and surfacing supporting snippets from abstracts, summaries, and claims.

The system combines semantic ranking, keyword matching, CPC-based filtering, and section-level evidence extraction to make patent discovery more interpretable and student-friendly.

## Key Features

- Semantic patent search based on idea description
- Keyword-assisted retrieval and reranking
- CPC-based filtering and refinement
- Abstract, summary, and claims evidence snippets
- Relevance feedback collection
- Downloadable results report
- Privacy policy / disclaimer page
- PatentsView attribution integrated into the UI

## Tech Stack

### Frontend
- Next.js
- React

### Backend
- FastAPI
- Python
- PatentsView API
- sentence-transformers for semantic ranking

## Project Structure

```text
student-patent-novelty-check/
├── Backend/
│   ├── main.py
│   ├── patentsearch_client.py
│   ├── semantic_ranker.py
│   ├── cpc_mapper.py
│   ├── requirements.txt
│   └── ...
├── frontend/
│   ├── package.json
│   ├── src/
│   └── ...
├── .env.example
├── .gitignore
└── README.md