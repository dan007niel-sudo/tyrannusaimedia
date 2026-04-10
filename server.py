"""
Tyrannus AI Media — FastAPI Backend
Proxies all Gemini API calls so the API key stays on the server.
Serves the built React frontend from dist/.
"""

import os
import json
import base64
import asyncio
import mimetypes
import traceback
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from google import genai
from google.genai import types

# ─── Error Classification ─────────────────────────────────────────────────────

IMAGE_GEN_TIMEOUT_SECONDS = 120  # 2 minutes max per image

def classify_gemini_error(error: Exception) -> HTTPException:
    """
    Classify a Gemini API error into a user-friendly HTTP response.
    Returns an HTTPException with:
      - Appropriate HTTP status code
      - JSON detail with 'message', 'errorType', and 'retryable' fields
    """
    msg = str(error)
    error_lower = msg.lower()

    # Permission / Auth errors
    if any(kw in error_lower for kw in ["api key not valid", "permission_denied", "403", "unauthorized", "401"]):
        return HTTPException(
            status_code=403,
            detail=json.dumps({
                "message": "API-Zugriff verweigert. Der API-Key ist ungültig oder hat keine Berechtigung.",
                "errorType": "PERMISSION_DENIED",
                "retryable": False,
            })
        )

    # Rate limiting
    if any(kw in error_lower for kw in ["429", "resource_exhausted", "rate limit", "quota"]):
        return HTTPException(
            status_code=429,
            detail=json.dumps({
                "message": "Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut.",
                "errorType": "RATE_LIMITED",
                "retryable": True,
            })
        )

    # Timeout
    if any(kw in error_lower for kw in ["504", "deadline_exceeded", "timeout", "timed out"]):
        return HTTPException(
            status_code=504,
            detail=json.dumps({
                "message": "Die Generierung hat zu lange gedauert. Bitte versuche es erneut oder verwende eine niedrigere Auflösung.",
                "errorType": "TIMEOUT",
                "retryable": True,
            })
        )

    # Content safety block
    if any(kw in error_lower for kw in ["safety", "blocked", "content_filter", "prohibited", "harm"]):
        return HTTPException(
            status_code=422,
            detail=json.dumps({
                "message": "Dieses Bild konnte nicht generiert werden — der Inhalt wurde aus Sicherheitsgründen blockiert. Bitte passe den Prompt an.",
                "errorType": "CONTENT_BLOCKED",
                "retryable": False,
            })
        )

    # Model not found
    if any(kw in error_lower for kw in ["404", "not_found", "model"]):
        return HTTPException(
            status_code=502,
            detail=json.dumps({
                "message": "Das KI-Modell ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.",
                "errorType": "MODEL_UNAVAILABLE",
                "retryable": True,
            })
        )

    # Server errors (500, 503)
    if any(kw in error_lower for kw in ["500", "503", "internal", "unavailable"]):
        return HTTPException(
            status_code=502,
            detail=json.dumps({
                "message": "Der KI-Server ist vorübergehend nicht erreichbar. Bitte versuche es in einer Minute erneut.",
                "errorType": "SERVER_ERROR",
                "retryable": True,
            })
        )

    # Generic fallback
    return HTTPException(
        status_code=500,
        detail=json.dumps({
            "message": f"Ein unerwarteter Fehler ist aufgetreten: {msg[:200]}",
            "errorType": "UNKNOWN",
            "retryable": True,
        })
    )


def check_safety_block(response) -> None:
    """
    Check if a Gemini response was blocked due to safety filters.
    Raises an exception with a descriptive message if blocked.
    """
    if not response.candidates:
        raise Exception("SAFETY_BLOCKED: Keine Antwort erhalten — möglicherweise durch Inhaltsfilter blockiert.")

    candidate = response.candidates[0]
    finish_reason = getattr(candidate, 'finish_reason', None)

    if finish_reason and str(finish_reason).upper() in ('SAFETY', 'BLOCKED', 'CONTENT_FILTER'):
        # Try to extract which safety category triggered
        safety_info = ""
        ratings = getattr(candidate, 'safety_ratings', None)
        if ratings:
            blocked_cats = [str(r.category) for r in ratings if getattr(r, 'blocked', False)]
            if blocked_cats:
                safety_info = f" (Kategorien: {', '.join(blocked_cats)})"
        raise Exception(f"SAFETY_BLOCKED: Inhalt durch Sicherheitsfilter blockiert{safety_info}.")

# ─── Configuration ────────────────────────────────────────────────────────────

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

if not GEMINI_API_KEY:
    print("⚠️  WARNING: GEMINI_API_KEY not set. API endpoints will fail.")

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# ─── Constants (from original constants.ts) ───────────────────────────────────

PHOTOREALISM_SUFFIX = """
Shot on 50mm Prime Lens, Full-Frame Sensor.
Aperture f/1.8 for natural bokeh and shallow depth of field.
Visible Skin Pores, Realistic Skin Sheen, Peach Fuzz.
Frizz and Flyaways (hair), Fabric Texture/Creases (clothing), Lint/Scratches.
Dust Particles in Light, Condensation, Water Droplets.
Chromatic Aberration, Camera Grain, Slight Lens Distortion for an unedited photo look.
Cinematic Lighting, Volumetric Atmosphere. High Fidelity.
NO CGI, NO 3D RENDER, NO VIDEO GAME GRAPHICS, NO CARTOON, NO ILLUSTRATION, NO DIGITAL ART STYLE.
"""

MODERN_STYLE_SUFFIX = (
    "Modern editorial photography, high-end fashion magazine style, "
    "clean composition, contemporary aesthetic, sharp focus, professional lighting, "
    "8k resolution, highly detailed."
)

SYSTEM_INSTRUCTION_BRAINSTORM = """
Du bist ein erstklassiger Art Director für eine moderne Designagentur, spezialisiert auf historische und theologische Visualisierungen.
Dein Kunde ist "Tyrannus AI Media" (eine fortschrittliche Bibelschule).
Erstelle hochwertige visuelle Metaphern für Flyer basierend auf Bibelversen.

WICHTIG - INHALTLICHE VORGABEN (HISTORISCHER KONTEXT & SYMBOLIK):
- **Historische Authentizität**: Analysiere den historischen Kontext des Verses (z.B. Römisches Reich, Babylon, Wüstenwanderung, Zeit der Könige). Die visuelle Welt (Kleidung, Architektur, Gegenstände) muss in diese Zeit passen.
- **Biblische Tiefe**: Nutze tiefe, biblische Symbolik (z.B. Salböl, zerbrochene Tonkrüge, Weizen, Fels, antike Schriftrollen, Leinenbinden) statt oberflächlicher Klischees.
- **Keine modernen Elemente**: Vermeide moderne Kleidung oder Technologie, es sei denn, der User wünscht es explizit. Das Standard-Setting ist die biblische Antike.

WICHTIG - STILRICHTUNG (KEINE VIDEOSPIEL-GRAFIK):
- **Cinematic Realism**: Der Look muss aussehen wie ein Foto aus einem hochwertigen Historienfilm (z.B. "The Chosen", "Passion Christi") oder eine National Geographic Dokumentation.
- **ANTI-CGI**: Auf gar keinen Fall "Video Spiel Grafik", 3D-Render-Look, Fantasy-Art-Stil oder übertriebenes HDR. Es muss "echt", "staubig" und "organisch" wirken.
- **Textur & Atmosphäre**: Fokus auf echte Materialien (grober Stein, verwittertes Holz, gewebte Stoffe, menschliche Haut mit Poren) und dramatisches, natürliches Licht (Kerzenschein, Sonnenstrahlen durch Staub).

Antworte NUR in JSON. Die Sprache für Title und Description muss DEUTSCH sein.
Der 'visualPrompt' muss für den Bildgenerator auf ENGLISCH sein. Er muss sehr detailliert den historischen Look beschreiben (z.B. "ancient jerusalem texture", "roman tunic", "dusty atmosphere", "warm cinematic lighting").
"""

# ─── Pydantic Models ──────────────────────────────────────────────────────────

class BrainstormRequest(BaseModel):
    verse: str
    theme: str
    userVision: str = ""
    styleMode: str = "classic"
    referenceImage: str | None = None  # data:image/...;base64,...


class FormatRequest(BaseModel):
    key: str
    ratio: str


class GenerateImagesRequest(BaseModel):
    metaphorPrompt: str
    imageSize: str = "1K"
    requests: list[FormatRequest]
    styleMode: str = "classic"
    referenceImage: str | None = None


class EditImageRequest(BaseModel):
    imageBase64: str  # data:image/...;base64,...
    editInstruction: str


# ─── Helpers ──────────────────────────────────────────────────────────────────

def parse_data_uri(data_uri: str) -> tuple[str, bytes]:
    """Parse a data URI into (mime_type, raw_bytes)."""
    # Format: data:image/png;base64,iVBORw0KGgo...
    header, b64_data = data_uri.split(",", 1)
    mime_type = header.split(":")[1].split(";")[0]
    raw_bytes = base64.b64decode(b64_data)
    return mime_type, raw_bytes


def make_data_uri(mime_type: str, raw_bytes: bytes) -> str:
    """Create a data URI from raw bytes."""
    b64 = base64.b64encode(raw_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{b64}"


def ensure_client():
    """Raise an error if the Gemini client is not configured."""
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY ist nicht konfiguriert. Bitte den Server-Admin kontaktieren."
        )


def build_reference_part(data_uri: str) -> types.Part:
    """Build a Gemini Part from a data URI image."""
    mime_type, raw_bytes = parse_data_uri(data_uri)
    return types.Part(
        inline_data=types.Blob(mime_type=mime_type, data=raw_bytes)
    )


# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(title="Tyrannus AI Media API")


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.post("/api/brainstorm")
async def api_brainstorm(req: BrainstormRequest):
    """Generate 3 visual metaphor concepts for a bible verse + theme."""
    ensure_client()

    # Build style context
    if req.styleMode == "modern":
        style_context = """
        STIL-RICHTUNG: MODERN / EDITORIAL
        - Die Bildsprache soll zeitgenössisch, minimalistisch und "high-end" wirken.
        - Denke an moderne Magazin-Cover, abstrakte Kunstinstallationen oder cleanes Design.
        - Weniger "historisch", mehr "zeitlos modern".
        """
    else:
        style_context = """
        STIL-RICHTUNG: KLASSISCH / ZEITLOS
        - Die Bildsprache soll cineastisch, episch und tiefgründig sein.
        - Denke an hochwertige Filmstills, klassische Malerei in realistischem Gewand.
        """

    prompt = f"""
    Analysiere die theologische Bedeutung dieses Verses: "{req.verse}" und dieses Themas: "{req.theme}".
    Entwickle 3 verschiedene visuelle Metaphern.
    {style_context}
    Die Szenen müssen realistisch und greifbar sein (nicht zu abstrakt).
    """

    if req.userVision and req.userVision.strip():
        prompt += f"""
        ZUSATZ-ANFORDERUNG VOM KUNDEN:
        Der Nutzer hat folgende konkrete visuelle Wünsche/Elemente: "{req.userVision}".
        
        WICHTIG:
        1. Integriere diese Elemente in mindestens 2 der 3 Vorschläge.
        2. Wenn die Wünsche sehr konkret sind, verfeinere sie zu einem professionellen Bild.
        3. Stelle sicher, dass die theologische Bedeutung trotzdem transportiert wird.
        """

    if req.referenceImage:
        prompt += """
        REFERENZBILD VOM KUNDEN:
        Der Nutzer hat ein Referenzbild hochgeladen. Nutze dieses Bild als Inspiration für Stimmung, Komposition oder Stil.
        """

    prompt += """
    Gib ein JSON-Array zurück:
    - id: string (einzigartig)
    - title: string (kurzer, prägnanter Titel auf Deutsch)
    - description: string (Erklärung der Verbindung auf Deutsch)
    - visualPrompt: string (Detaillierte visuelle Beschreibung für den Bildgenerator auf ENGLISCH, ohne Kameraspezifikationen. Integriere Stil-Vorgaben wie "modern editorial" oder "cinematic lighting" direkt hier.)
    """

    # Build content parts
    parts = []
    if req.referenceImage:
        parts.append(build_reference_part(req.referenceImage))
    parts.append(types.Part(text=prompt))

    try:
        response = await client.aio.models.generate_content(
            model="gemini-3-flash-preview",
            contents=types.Content(parts=parts),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION_BRAINSTORM,
                response_mime_type="application/json",
                response_schema={
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "id": {"type": "STRING"},
                            "title": {"type": "STRING"},
                            "description": {"type": "STRING"},
                            "visualPrompt": {"type": "STRING"},
                        },
                        "required": ["id", "title", "description", "visualPrompt"],
                    },
                },
            ),
        )

        text = response.text
        if not text:
            raise HTTPException(status_code=500, detail="Keine Metaphern generiert.")
        
        return JSONResponse(content=json.loads(text))

    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️  Brainstorm error: {e}")
        traceback.print_exc()
        raise classify_gemini_error(e)


async def _generate_single_image(
    prompt: str,
    size: str,
    aspect_ratio: str,
    style_mode: str,
    reference_image: str | None,
) -> str:
    """Generate a single image and return as data URI. Includes timeout and safety checks."""
    style_suffix = PHOTOREALISM_SUFFIX if style_mode == "classic" else MODERN_STYLE_SUFFIX
    full_prompt = f"{prompt}\n\n{style_suffix}"

    parts = []
    if reference_image:
        parts.append(build_reference_part(reference_image))
    parts.append(types.Part(text=full_prompt))

    # Wrap in timeout to prevent hanging requests
    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model="gemini-2.5-flash-image",
                contents=types.Content(parts=parts),
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    image_config=types.ImageConfig(
                        aspect_ratio=aspect_ratio,
                    ),
                ),
            ),
            timeout=IMAGE_GEN_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise Exception(f"TIMEOUT: Bildgenerierung für {aspect_ratio} hat nach {IMAGE_GEN_TIMEOUT_SECONDS}s nicht geantwortet.")

    # Check for safety blocks
    check_safety_block(response)

    # Extract generated image from response
    if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                return make_data_uri(
                    part.inline_data.mime_type or "image/png",
                    part.inline_data.data,
                )

    raise Exception(f"Kein Bild generiert für Format {aspect_ratio}")


@app.post("/api/generate-images")
async def api_generate_images(req: GenerateImagesRequest):
    """Generate images in multiple formats (feed, story, banner, custom)."""
    ensure_client()

    if not req.requests:
        raise HTTPException(status_code=400, detail="Bitte mindestens ein Format auswählen.")

    # Generate all formats in parallel
    tasks = []
    for fmt in req.requests:
        tasks.append(
            _generate_single_image(
                req.metaphorPrompt,
                req.imageSize,
                fmt.ratio,
                req.styleMode,
                req.referenceImage,
            )
        )

    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    results = {}
    errors_by_type = {}  # Track error types for smart error messages
    all_failed = True

    for fmt, result in zip(req.requests, raw_results):
        if isinstance(result, Exception):
            error_msg = str(result)
            print(f"⚠️  Image generation failed for {fmt.key}: {error_msg}")

            # Classify the error
            classified = classify_gemini_error(result)
            error_detail = json.loads(classified.detail)
            error_type = error_detail.get("errorType", "UNKNOWN")
            errors_by_type[error_type] = error_detail

            results[fmt.key] = None
        else:
            results[fmt.key] = result
            all_failed = False

    if all_failed and errors_by_type:
        # Return the most specific/important error
        # Priority: PERMISSION > CONTENT_BLOCKED > RATE_LIMITED > TIMEOUT > others
        priority = ["PERMISSION_DENIED", "CONTENT_BLOCKED", "RATE_LIMITED", "TIMEOUT", "MODEL_UNAVAILABLE", "SERVER_ERROR"]
        for prio_type in priority:
            if prio_type in errors_by_type:
                err = errors_by_type[prio_type]
                raise HTTPException(
                    status_code=classify_gemini_error(Exception(prio_type.lower())).status_code,
                    detail=json.dumps(err)
                )
        # Generic fallback
        first_err = next(iter(errors_by_type.values()))
        raise HTTPException(status_code=500, detail=json.dumps(first_err))

    return JSONResponse(content=results)


@app.post("/api/edit-image")
async def api_edit_image(req: EditImageRequest):
    """Edit an existing image using AI."""
    ensure_client()

    mime_type, raw_bytes = parse_data_uri(req.imageBase64)

    parts = [
        types.Part(
            inline_data=types.Blob(mime_type=mime_type, data=raw_bytes)
        ),
        types.Part(
            text=f"Edit this image. {req.editInstruction}. Maintain the photorealistic style: {PHOTOREALISM_SUFFIX}"
        ),
    ]

    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model="gemini-2.5-flash-image",
                contents=types.Content(parts=parts),
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                ),
            ),
            timeout=IMAGE_GEN_TIMEOUT_SECONDS,
        )

        # Check for safety blocks
        check_safety_block(response)

        for part in response.candidates[0].content.parts:
            if part.inline_data:
                data_uri = make_data_uri(
                    part.inline_data.mime_type or "image/png",
                    part.inline_data.data,
                )
                return JSONResponse(content={"image": data_uri})

        raise HTTPException(status_code=500, detail=json.dumps({
            "message": "Bearbeitung fehlgeschlagen — kein Bild in Antwort.",
            "errorType": "UNKNOWN",
            "retryable": True,
        }))

    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=json.dumps({
            "message": "Die Bildbearbeitung hat zu lange gedauert. Bitte versuche es erneut.",
            "errorType": "TIMEOUT",
            "retryable": True,
        }))
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️  Edit error: {e}")
        traceback.print_exc()
        raise classify_gemini_error(e)


@app.get("/api/health")
async def health():
    """Health check for Render."""
    return {
        "status": "ok",
        "service": "Tyrannus AI Media",
        "api_configured": client is not None,
    }


# ─── Static File Serving (Production) ────────────────────────────────────────

DIST_DIR = Path(__file__).parent / "dist"

if DIST_DIR.exists():
    # Serve built assets (JS, CSS, images)
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve the React SPA. Falls back to index.html for client-side routing."""
        file_path = DIST_DIR / full_path
        if file_path.is_file() and ".." not in full_path:
            media_type, _ = mimetypes.guess_type(str(file_path))
            return FileResponse(str(file_path), media_type=media_type)
        return FileResponse(str(DIST_DIR / "index.html"))
