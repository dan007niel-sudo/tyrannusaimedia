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
- `TEXT_MODEL` / `IMAGE_MODEL` — optional, ueberschreiben die Modellvorgaben aus
  `server.py`. Da, um einen Modellwechsel ohne Deploy pruefen und ohne Rollback
  zurueckdrehen zu koennen.

## Modelle

Die IDs stehen zentral in `server.py` (Abschnitt „Modelle"), nicht im
Funktionsrumpf — bei der naechsten Abkuendigung soll an einer Stelle stehen, was
betroffen ist.

**Nur stabile IDs, nie Preview.** Am 10.09.2026 stand die App genau deswegen
unter Zugzwang: `gemini-2.5-flash-image` (Bildgenerierung **und** -bearbeitung)
hatte Abschaltung am **02.10.2026**, `gemini-3-flash-preview` (Brainstorm) war
bereits deprecated. Migriert auf `gemini-3.1-flash-image` und `gemini-3.6-flash`.

Vor jedem Modellwechsel Googles Deprecations-Seite lesen, nicht das Gedaechtnis
fragen — und danach jeden der drei Pfade (Brainstorm, Generierung, Bearbeitung)
einmal echt aufrufen. Ein `/api/health` mit `api_configured: true` beweist nur,
dass ein Schluessel gesetzt ist, nicht dass das Modell existiert.

## Deploy-Workflow

Render Web Service mit Auto-Deploy bei Push auf `main`. Build via `build.sh`, Start via Gunicorn + Uvicorn-Worker. Live unter `https://tyrannusaimedia-ga98.onrender.com`.

> Die alte Adresse `tyrannusaimedia.onrender.com` gehört zum am 30.06.2026 wegen offener Rechnung gesperrten Workspace und ist tot. Free-Plan: **kein** 24/7-Uptime-Ping auf diesen Service — das frisst das 750-Stunden-Kontingent und führt zur erneuten Sperre. Cold Start (~30–60 s) ist bewusst akzeptiert.

## Bewegtbild (Flyer → Video)

Läuft **im Browser**, nicht auf dem Server: `services/motionRenderer.ts` (Canvas + WebCodecs + `mp4-muxer`). Kein API-Aufruf, keine Serverlast, kein Upload — das Video entsteht auf dem Gerät und bleibt dort, bis es heruntergeladen wird.

Der serverseitige Renderer (`motion_render.py`, `/api/motion/*`) bleibt als Referenzimplementierung und für die spätere generative Stufe im Repo, ist aber per `MOTION_ENABLED=0` abgeschaltet. **Nicht wieder einschalten**, solange die App auf Render Free läuft: gemessen am 01.08.2026 überlebt die Instanz schon den kleinstmöglichen Auftrag (480p, 3 s, ein Format) nicht — nach ~25 s 502 und Prozess-Neustart. `/api/health` → `server_motion_available` bezieht sich nur auf diesen Pfad.

Qualitätstor: `measureSeam()` misst die Schleife auf den **rohen** Frames, nie am fertigen Video (Keyframe gegen P-Frame verfälscht jede Messung). Aufrufbar über `?selftest=1` → `window.__motion`. Grenze ist das Verhältnis Naht zu Nachbarschritt ≤ 1,3, **nicht** „bit-genau null" — siehe `SEAM_RATIO_LIMIT`.

## Hinweis

Detaillierte Arbeitsregeln, 3-Agent-Workflow und Lessons Learned: siehe `CODEX.md`.
