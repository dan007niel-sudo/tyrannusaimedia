# Tyrannus AI Media

> KI-gestütztes visuelles Studio für cineastische Bildgenerierung basierend auf biblischen Themen.

## Architektur

```
┌─────────────────────┐      ┌──────────────────────┐      ┌──────────────┐
│   React Frontend    │ ──── │   FastAPI Backend     │ ──── │  Google       │
│   (Vite Build)      │ /api │   (server.py)         │      │  Gemini API   │
│   Served from dist/ │      │   API Key sicher      │      │              │
└─────────────────────┘      └──────────────────────┘      └──────────────┘
```

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: FastAPI (Python) — proxied alle Gemini API Aufrufe
- **API Key**: Bleibt sicher auf dem Server (nie im Browser)
- **Deployment**: Render Web Service

## Lokal starten

### Voraussetzungen
- Node.js (v18+)
- Python 3.11+

### Setup

```bash
# 1. Node dependencies installieren
npm install

# 2. Python dependencies installieren
pip install -r requirements.txt

# 3. Environment Variable setzen
cp .env.example .env
# → GEMINI_API_KEY in .env eintragen

# 4. Frontend starten (Port 3000)
npm run dev

# 5. Backend starten (Port 8000, separates Terminal)
uvicorn server:app --reload --port 8000
```

Öffne `http://localhost:3000` — Vite proxied `/api/*` automatisch zum Backend.

## Deployment auf Render

1. Push auf GitHub
2. Render Dashboard → **New Web Service**
3. Repo verbinden → Branch `main`
4. **Build Command**: `chmod +x build.sh && ./build.sh`
5. **Start Command**: `gunicorn server:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 300`
6. **Environment Variable**: `GEMINI_API_KEY` setzen
7. ✅ Deploy!

Live unter: `https://tyrannusaimedia.onrender.com`

## Funktionen

- 🎨 **Visuelle Konzeption**: Bibelverse in cineastische Bildmetaphern verwandeln
- 📐 **Multi-Format**: Feed (3:4), Story (9:16), Banner (16:9), Custom
- 🖼️ **Auflösung**: 1K, 2K, 4K
- ✏️ **Bild-Bearbeitung**: Generierte Bilder direkt nachbearbeiten
- 📱 **Responsive**: Desktop & Mobile
