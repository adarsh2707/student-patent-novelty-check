# Student Patent Novelty Check

A full-stack patent novelty support tool that allows users to describe an idea, search for similar patents, rank results semantically, and review why a patent is relevant.

## Features
- User registration and login
- User-specific search history
- Async patent search using Redis + RQ worker
- Semantic patent ranking
- Downloadable search results
- Backend authentication and user isolation

## Tech Stack
- Frontend: Next.js
- Backend: FastAPI
- Queue: Redis + RQ
- Database: SQLite
- Patent retrieval: SerpAPI / Google Patents

## Backend setup
1. Create `.env` from `.env.example`
2. Install Python dependencies
3. Start Redis
4. Start FastAPI
5. Start worker

## Frontend setup
1. Create `.env.local` from `.env.example`
2. Install dependencies
3. Run the Next.js dev server