# Run locally (React + FastAPI + SQLite)

Requirements: Python 3.10+, Node.js 18+ (or Bun).

## 1. Backend (FastAPI + SQLAlchemy + SQLite)

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate    macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
python seed.py                      # creates ai_token_dashboard.db with demo data
uvicorn main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

## 2. Frontend (React + TypeScript + Vite)

In the project root, create a file named `.env.local` containing:

```text
VITE_API_URL=http://localhost:8000
```

Then:

```bash
npm install
npm run dev
```

Open the URL printed in the terminal (e.g. http://localhost:8080).
Log in with `U0001`–`U0050` (user) or `A0001`–`A0003` (admin).

Without `VITE_API_URL`, the frontend falls back to its built-in demo server.
Re-run `python seed.py` (or "Reset demo data" in the admin page) to restore the demo data.
