# CLAUDE.md

## Was ist das Projekt

Tyrannus AI Media — KI-gestütztes visuelles Studio für cineastische Bildgenerierung basierend auf biblischen Themen.

## Stack

| Schicht       | Technologie                                  |
| ------------- | -------------------------------------------- |
| Frontend      | React + TypeScript + Tailwind CSS (Vite)     |
| Backend       | FastAPI (Python 3.11+), Gunicorn/Uvicorn     |
| KI            | Google Gemini API (Text + Imagen)            |
| Persistenz    | Supabase (Projekt-Historie, Storage)         |
| Deployment    | Render Web Service                           |

## Wichtigste Dateien

- `App.tsx` — Frontend Root, App-Shell, Header, View-Routing
- `server.py` — FastAPI Backend, Gemini-Proxy, History-Endpoints
- `CODEX.md` — Detaillierte Arbeitsregeln und Lessons Learned
- `.env.example` — Vollständige Liste der ENV-Vars

## Wichtige ENV-Vars

Namen (Werte siehe `.env.example`):

- `GEMINI_API_KEY`
- `HISTORY_ADMIN_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`

## Deploy-Workflow

Render Web Service mit Auto-Deploy bei Push auf `main`. Build via `build.sh`, Start via Gunicorn + Uvicorn-Worker. Live unter `https://tyrannusaimedia-ga98.onrender.com`.

> Die alte Adresse `tyrannusaimedia.onrender.com` gehört zum am 30.06.2026 wegen offener Rechnung gesperrten Workspace und ist tot. Free-Plan: **kein** 24/7-Uptime-Ping auf diesen Service — das frisst das 750-Stunden-Kontingent und führt zur erneuten Sperre. Cold Start (~30–60 s) ist bewusst akzeptiert.

`build.sh` lädt zusätzlich ein statisches ffmpeg nach `bin/` (gitignored, ~150 MB) für den Bewegtbild-Renderer. Schlägt der Download fehl, startet die App trotzdem und meldet die Funktion als nicht verfügbar — sichtbar an `/api/health` → `motion_available`.

## Hinweis

Detaillierte Arbeitsregeln, 3-Agent-Workflow und Lessons Learned: siehe `CODEX.md`.
