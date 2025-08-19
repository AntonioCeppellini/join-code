# Joincode

**Joincode** is a real-time collaborative editor for files & repositories.  
Share a link or a room code, join a room, and write together in the browser.  
Perfect for **pair programming**, **coding interviews**, **workshops/classrooms**, and **code reviews**.

---

## Features
- **Rooms** with invite link or **room code**
- **Controlled editing**: one active writer at a time (queue/hand-off)
- **Live chat** sidebar (typing, reactions)
- **Change requests**: suggest edits on a selected range, then **accept/apply**
- **Inline comments** anchored to code
- **Repo/File import** (upload ZIP or repo), **export** as ZIP
- **Snapshots & history**
- **Roles**: owner / editor / viewer

> Not a full IDE. Focused on fast, low-friction collaboration.

---

## Use Cases
- **Pair programming** (driver/navigator)
- **Coding interviews** (candidate proposes changes, interviewer applies)
- **Workshops & lessons** (instructor writes, students chat/suggest)
- **Code reviews & walkthroughs**

---

## How It Works (MVP)
- **Single writer** holds a short **lease** to edit; others see updates live.
- **Patches** are applied atomically and versioned.
- **Change requests** carry a range + snippet/diff and can be applied with one click.
- **Comments** live on code ranges; anchors update when the file changes.

---

## Getting Started (local dev)

**Prereqs:** Python 3.11+, Node 20+, Redis, PostgreSQL  
*(Or run Redis/Postgres via Docker Compose.)*

```bash
# 1) Clone
git clone https://github.com/<you>/joincode.git
cd joincode

# 2) Start services (optional helper)
docker compose up -d db redis

# 3) Backend (FastAPI)
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --reload --port 8000

# 4) Frontend (Next.js)
cd frontend
npm install
npm run dev
