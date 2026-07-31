"""
Tyrannus AI Media — FastAPI Backend
Proxies all Gemini API calls so the API key stays on the server.
Serves the built React frontend from dist/.
"""

import os
import json
import base64
import asyncio
import functools
import secrets
import mimetypes
import re
import shutil
import tempfile
import time
import traceback
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse
from urllib.request import Request as URLRequest, urlopen

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

import motion_render

# ─── Error Classification ─────────────────────────────────────────────────────

IMAGE_GEN_TIMEOUT_SECONDS = 120  # 2 minutes max per image
MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024
MAX_EDIT_IMAGE_BYTES = 20 * 1024 * 1024
MAX_DOWNLOAD_IMAGE_BYTES = 50 * 1024 * 1024
MAX_DOWNLOAD_FORM_BYTES = ((MAX_DOWNLOAD_IMAGE_BYTES + 2) // 3) * 4 + 1024
ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
SAFE_DOWNLOAD_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")

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

# ─── Configuration ──────────────────────────────────────────────────────

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
HISTORY_ADMIN_TOKEN = os.environ.get("HISTORY_ADMIN_TOKEN", "")

if not GEMINI_API_KEY:
    print("⚠️  WARNING: GEMINI_API_KEY not set. API endpoints will fail.")

if not HISTORY_ADMIN_TOKEN:
    print("⚠️  WARNING: HISTORY_ADMIN_TOKEN not set. Project history endpoints are locked.")

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# ─── Supabase Configuration ───────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

supabase_client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        from supabase import create_client
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("✅ Supabase connected.")
    except Exception as e:
        print(f"⚠️  Supabase init failed: {e}")
else:
    print("⚠️  SUPABASE_URL/SUPABASE_KEY not set. Persistence disabled.")

IMAGE_BUCKET = "generated-images"
# Videos werden hierhin gespiegelt, wenn der Bucket existiert. Ohne ihn laeuft
# die Funktion trotzdem — die Clips haengen dann nur am Job und verfallen mit
# ihm (MOTION_JOB_TTL).
MOTION_BUCKET = os.environ.get("MOTION_BUCKET", "generated-motion")

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
Die Markenstimme kommt aus der Schule von Tyrannus: ein klarer, minimalistischer, geistlicher Raum,
in dem Menschen Gott begegnen, Jesus leidenschaftlich lieben und Erweckung leben.
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
    imageSize: Literal["1K", "2K", "4K"] = "1K"
    requests: list[FormatRequest]
    styleMode: str = "classic"
    referenceImage: str | None = None
    projectId: str | None = None
    metaphorId: str | None = None


class EditImageRequest(BaseModel):
    imageBase64: str  # data:image/...;base64,...
    editInstruction: str


# ─── Helpers ──────────────────────────────────────────────────────────────────

def structured_error(status_code: int, message: str, error_type: str, retryable: bool) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=json.dumps({
            "message": message,
            "errorType": error_type,
            "retryable": retryable,
        })
    )


def parse_data_uri(data_uri: str) -> tuple[str, bytes]:
    """Parse a data URI into (mime_type, raw_bytes)."""
    if not data_uri.startswith("data:") or "," not in data_uri:
        raise ValueError("UPLOAD_INVALID: Ungültiges Bildformat.")

    header, b64_data = data_uri.split(",", 1)
    if ";base64" not in header:
        raise ValueError("UPLOAD_INVALID: Bild muss als Base64-Data-URI übertragen werden.")

    mime_type = header.split(":", 1)[1].split(";", 1)[0].lower()
    try:
        raw_bytes = base64.b64decode(b64_data, validate=True)
    except Exception as exc:
        raise ValueError("UPLOAD_INVALID: Bilddaten konnten nicht gelesen werden.") from exc
    return mime_type, raw_bytes


def validate_uploaded_image(data_uri: str, max_bytes: int) -> tuple[str, bytes]:
    """Validate a browser-provided image data URI before passing it to Gemini."""
    mime_type, raw_bytes = parse_data_uri(data_uri)
    if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise structured_error(
            415,
            "Dieses Bildformat wird nicht unterstützt. Bitte JPG, PNG oder WebP verwenden.",
            "UPLOAD_INVALID",
            False,
        )
    if not raw_bytes:
        raise structured_error(400, "Das hochgeladene Bild ist leer.", "UPLOAD_INVALID", False)
    if len(raw_bytes) > max_bytes:
        max_mb = max_bytes // (1024 * 1024)
        raise structured_error(
            413,
            f"Das Bild ist zu groß. Bitte maximal {max_mb}MB hochladen.",
            "UPLOAD_TOO_LARGE",
            False,
        )
    return mime_type, raw_bytes


def validate_storage_public_url(public_url: str) -> None:
    if not SUPABASE_URL:
        raise ValueError("SUPABASE_URL is required for public storage URLs.")
    base = urlparse(SUPABASE_URL)
    parsed = urlparse(public_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Only HTTPS storage URLs are accepted.")
    if parsed.scheme != base.scheme or parsed.netloc != base.netloc:
        raise ValueError("Storage URL does not belong to the configured Supabase project.")
    expected_prefix = f"/storage/v1/object/public/{IMAGE_BUCKET}/"
    if not parsed.path.startswith(expected_prefix):
        raise ValueError("Storage URL does not belong to the generated image bucket.")


def load_storage_image(image_url: str, max_bytes: int) -> tuple[str, bytes]:
    """Load one generated image from the configured Supabase public bucket."""
    validate_storage_public_url(image_url)
    try:
        request = URLRequest(image_url, headers={"User-Agent": "TyrannusAI-Media/1.0"})
        with urlopen(request, timeout=10) as response:
            mime_type = (response.headers.get_content_type() or "").lower()
            raw_bytes = response.read(max_bytes + 1)
    except Exception as exc:
        raise structured_error(
            400,
            "Das gespeicherte Bild konnte nicht geladen werden.",
            "UPLOAD_INVALID",
            True,
        ) from exc

    if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
        guessed_type, _ = mimetypes.guess_type(urlparse(image_url).path)
        mime_type = (guessed_type or mime_type).lower()

    if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise structured_error(
            415,
            "Dieses gespeicherte Bildformat wird nicht unterstützt.",
            "UPLOAD_INVALID",
            False,
        )
    if not raw_bytes:
        raise structured_error(400, "Das gespeicherte Bild ist leer.", "UPLOAD_INVALID", False)
    if len(raw_bytes) > max_bytes:
        raise structured_error(
            413,
            "Das gespeicherte Bild ist zu groß.",
            "UPLOAD_TOO_LARGE",
            False,
        )
    return mime_type, raw_bytes


def load_edit_image_input(image_input: str) -> tuple[str, bytes]:
    """Accept a browser data URI or one of our Supabase public image URLs for editing."""
    if image_input.startswith("data:"):
        return validate_uploaded_image(image_input, MAX_EDIT_IMAGE_BYTES)

    return load_storage_image(image_input, MAX_EDIT_IMAGE_BYTES)


def safe_download_filename(filename: str, mime_type: str) -> str:
    """
    Return an ASCII filename with an extension matching the payload.

    Die Endung kommt IMMER aus dem geprueften MIME-Typ, nie aus dem
    uebergebenen Namen. Ohne passende Endung landet die Datei auf iPhone und
    iPad ohne Typ im Downloads-Ordner und laesst sich nicht oeffnen (siehe
    PR #2/#3). Video gehoert deshalb genauso in diese Tabelle wie Bild —
    ein fehlender Eintrag ist hier kein Fallback, sondern ein KeyError.
    """
    extension_by_mime = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
    }
    desired_extension = extension_by_mime[mime_type]
    stem = Path(filename).stem[:80] or "tyrannus-media"
    safe_stem = SAFE_DOWNLOAD_FILENAME.sub("-", stem).strip("._-") or "tyrannus-media"
    return f"{safe_stem}{desired_extension}"


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


def ensure_history_admin(x_history_token: str | None = Header(default=None, alias="X-History-Token")) -> None:
    """Protect project history reads and deletes with a server-side admin token."""
    if not HISTORY_ADMIN_TOKEN:
        raise HTTPException(
            status_code=503,
            detail=json.dumps({
                "message": "Projekt-Historie ist noch nicht abgesichert konfiguriert. Bitte HISTORY_ADMIN_TOKEN in Render setzen.",
                "errorType": "SERVER_ERROR",
                "retryable": False,
            })
        )

    if not x_history_token or not secrets.compare_digest(x_history_token, HISTORY_ADMIN_TOKEN):
        raise HTTPException(
            status_code=401,
            detail=json.dumps({
                "message": "Historie-Token fehlt oder ist ungültig.",
                "errorType": "PERMISSION_DENIED",
                "retryable": False,
            })
        )


def build_reference_part(data_uri: str) -> types.Part:
    """Build a Gemini Part from a data URI image."""
    mime_type, raw_bytes = validate_uploaded_image(data_uri, MAX_REFERENCE_IMAGE_BYTES)
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
        
        metaphors_data = json.loads(text)

        # Persist to Supabase if available
        project_id = None
        if supabase_client:
            try:
                # Create project
                project_result = supabase_client.table("projects").insert({
                    "verse": req.verse,
                    "theme": req.theme,
                    "user_vision": req.userVision,
                    "style_mode": req.styleMode,
                }).execute()
                project_id = project_result.data[0]["id"] if project_result.data else None

                # Save metaphors and return the persisted DB ids to the client.
                if project_id:
                    saved_metaphors = []
                    for m in metaphors_data:
                        metaphor_result = supabase_client.table("metaphors").insert({
                            "project_id": project_id,
                            "title": m.get("title", ""),
                            "description": m.get("description", ""),
                            "visual_prompt": m.get("visualPrompt", ""),
                        }).execute()
                        if not metaphor_result.data or not metaphor_result.data[0].get("id"):
                            raise RuntimeError("Metaphor insert did not return a database id.")
                        saved = dict(m)
                        saved["id"] = metaphor_result.data[0]["id"]
                        saved_metaphors.append(saved)
                    metaphors_data = saved_metaphors
                    print(f"✅ Project {project_id} saved with {len(metaphors_data)} metaphors.")
            except Exception as e:
                print(f"⚠️  Supabase save failed (non-blocking): {e}")
                project_id = None

        return JSONResponse(content={"metaphors": metaphors_data, "projectId": project_id})

    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️  Brainstorm error: {e}")
        traceback.print_exc()
        raise classify_gemini_error(e)


async def _generate_single_image(
    prompt: str,
    size: Literal["1K", "2K", "4K"],
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
                        image_size=size,
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
    errors_by_format = {}
    all_failed = True

    for fmt, result in zip(req.requests, raw_results):
        if isinstance(result, Exception):
            error_msg = str(result)
            print(f"⚠️  Image generation failed for {fmt.key}: {error_msg}")

            if isinstance(result, HTTPException):
                classified = result
                detail = classified.detail
                error_detail = json.loads(detail) if isinstance(detail, str) else detail
            else:
                classified = classify_gemini_error(result)
                error_detail = json.loads(classified.detail)
            error_type = error_detail.get("errorType", "UNKNOWN")
            errors_by_type[error_type] = {
                "statusCode": classified.status_code,
                **error_detail,
            }
            errors_by_format[fmt.key] = error_detail

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
                    status_code=err.pop("statusCode", 500),
                    detail=json.dumps(err),
                )
        # Generic fallback
        first_err = next(iter(errors_by_type.values()))
        raise HTTPException(status_code=500, detail=json.dumps(first_err))

    # Upload successful images to Supabase Storage
    stored_urls = {}
    if supabase_client:
        for fmt_key, data_uri in results.items():
            if data_uri is None:
                continue
            try:
                mime_type, raw_bytes = parse_data_uri(data_uri)
                ext = "png" if "png" in mime_type else "jpg"
                file_name = f"{uuid.uuid4().hex}.{ext}"
                storage_path = f"{file_name}"

                supabase_client.storage.from_(IMAGE_BUCKET).upload(
                    path=storage_path,
                    file=raw_bytes,
                    file_options={"content-type": mime_type},
                )

                public_url = supabase_client.storage.from_(IMAGE_BUCKET).get_public_url(storage_path)
                stored_urls[fmt_key] = public_url
                print(f"✅ Image uploaded: {storage_path}")
            except Exception as e:
                print(f"⚠️  Storage upload failed for {fmt_key}: {e}")

        if req.projectId and stored_urls:
            try:
                aspect_ratios = {fmt.key: fmt.ratio for fmt in req.requests}
                save_req = SaveImagesRequest(
                    projectId=req.projectId,
                    metaphorId=req.metaphorId,
                    images=stored_urls,
                    aspectRatios=aspect_ratios,
                )
                save_image_references(save_req)
            except Exception as e:
                print(f"⚠️  Image reference save failed (non-blocking): {e}")

    return JSONResponse(content={"images": results, "storedUrls": stored_urls, "errors": errors_by_format})


@app.post("/api/edit-image")
async def api_edit_image(req: EditImageRequest):
    """Edit an existing image using AI."""
    ensure_client()

    mime_type, raw_bytes = load_edit_image_input(req.imageBase64)

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


# ─── API: Save Image References (after client confirms) ────────────────────

class SaveImagesRequest(BaseModel):
    projectId: str
    metaphorId: str | None = None
    images: dict[str, str]  # { "feed": "public_url", ... }
    aspectRatios: dict[str, str] = Field(default_factory=dict)


def validate_save_image_reference_request(req: SaveImagesRequest) -> None:
    uuid.UUID(req.projectId)
    if req.metaphorId:
        uuid.UUID(req.metaphorId)

    for fmt_key, public_url in req.images.items():
        if not public_url:
            continue
        validate_storage_public_url(public_url)
        if req.aspectRatios.get(fmt_key, "1:1") not in {"1:1", "3:4", "4:3", "9:16", "16:9"}:
            raise ValueError("Unsupported aspect ratio.")


def save_image_references(req: SaveImagesRequest) -> None:
    validate_save_image_reference_request(req)

    for fmt_key, public_url in req.images.items():
        if not public_url:
            continue
        supabase_client.table("generated_images").insert({
            "project_id": req.projectId,
            "metaphor_id": req.metaphorId,
            "format_key": fmt_key,
            "aspect_ratio": req.aspectRatios.get(fmt_key, "1:1"),
            "storage_path": public_url.split("/")[-1] if public_url else "",
            "public_url": public_url,
        }).execute()


@app.post("/api/save-images")
async def api_save_images(req: SaveImagesRequest, _: None = Depends(ensure_history_admin)):
    """Admin-only compatibility endpoint for saving image references."""
    if not supabase_client:
        return JSONResponse(content={"saved": False, "reason": "Persistence disabled"})

    try:
        save_image_references(req)
        return JSONResponse(content={"saved": True})
    except Exception as e:
        print(f"⚠️  Save images failed: {e}")
        return JSONResponse(content={"saved": False, "reason": str(e)})


# ─── API: Image Download ────────────────────────────────────────────

@app.get("/api/download-image")
def api_download_image(url: str, filename: str = "tyrannus-media.png"):
    """
    Serve a generated image as a real same-origin attachment.

    iOS/iPadOS browsers do not reliably download large data: URLs created by
    JavaScript. A normal HTTPS response with Content-Disposition works across
    Safari, Chrome on iOS, and desktop browsers.
    """
    try:
        mime_type, raw_bytes = load_storage_image(url, MAX_DOWNLOAD_IMAGE_BYTES)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Ungültige Bildadresse.") from exc

    download_name = safe_download_filename(filename, mime_type)
    return Response(
        content=raw_bytes,
        media_type=mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "Content-Length": str(len(raw_bytes)),
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.post("/api/download-embedded-image")
async def api_download_embedded_image(
    request: Request,
    filename: str = "tyrannus-media.png",
):
    """Turn a generated data URI into a normal attachment without browser-side blobs."""
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_DOWNLOAD_FORM_BYTES:
            raise HTTPException(status_code=413, detail="Das Bild ist zu groß.")
        body.extend(chunk)

    prefix = b"image_data="
    if not body.startswith(prefix):
        raise HTTPException(status_code=400, detail="Ungültige Bilddaten.")

    try:
        image_data = bytes(body[len(prefix):]).rstrip(b"\r\n").decode("ascii")
        mime_type, raw_bytes = validate_uploaded_image(
            image_data,
            MAX_DOWNLOAD_IMAGE_BYTES,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Ungültige Bilddaten.") from exc

    download_name = safe_download_filename(filename, mime_type)
    return Response(
        content=raw_bytes,
        media_type=mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "Content-Length": str(len(raw_bytes)),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ─── API: Project History ────────────────────────────────────────────

@app.get("/api/projects")
async def api_list_projects(_: None = Depends(ensure_history_admin)):
    """List all projects, newest first."""
    if not supabase_client:
        return JSONResponse(content=[])

    try:
        result = supabase_client.table("projects") \
            .select("id, verse, theme, style_mode, created_at") \
            .order("created_at", desc=True) \
            .limit(50) \
            .execute()
        return JSONResponse(content=result.data or [])
    except Exception as e:
        print(f"⚠️  List projects failed: {e}")
        return JSONResponse(content=[])


@app.get("/api/projects/{project_id}")
async def api_get_project(project_id: str, _: None = Depends(ensure_history_admin)):
    """Get a single project with its metaphors and images."""
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Persistence disabled")

    try:
        # Get project
        project = supabase_client.table("projects") \
            .select("*") \
            .eq("id", project_id) \
            .single() \
            .execute()

        # Get metaphors
        metaphors = supabase_client.table("metaphors") \
            .select("*") \
            .eq("project_id", project_id) \
            .execute()

        # Get images
        images = supabase_client.table("generated_images") \
            .select("*") \
            .eq("project_id", project_id) \
            .execute()

        return JSONResponse(content={
            "project": project.data,
            "metaphors": metaphors.data or [],
            "images": images.data or [],
        })
    except Exception as e:
        print(f"⚠️  Get project failed: {e}")
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden.")


@app.delete("/api/projects/{project_id}")
async def api_delete_project(project_id: str, _: None = Depends(ensure_history_admin)):
    """Delete a project and all related data (CASCADE handles metaphors + images)."""
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Persistence disabled")

    try:
        # Delete images from storage first
        images = supabase_client.table("generated_images") \
            .select("storage_path") \
            .eq("project_id", project_id) \
            .execute()

        if images.data:
            paths = [img["storage_path"] for img in images.data if img.get("storage_path")]
            if paths:
                try:
                    supabase_client.storage.from_(IMAGE_BUCKET).remove(paths)
                except Exception as e:
                    print(f"⚠️  Storage cleanup failed: {e}")

        # Delete project (CASCADE deletes metaphors + images)
        supabase_client.table("projects").delete().eq("id", project_id).execute()
        return JSONResponse(content={"deleted": True})
    except Exception as e:
        print(f"⚠️  Delete project failed: {e}")
        raise HTTPException(status_code=500, detail="Löschen fehlgeschlagen.")


@app.get("/api/health")
async def health():
    """Health check for Render."""
    return {
        "status": "ok",
        "service": "Tyrannus AI Media",
        "api_configured": client is not None,
        "persistence_enabled": supabase_client is not None,
        "history_auth_configured": bool(HISTORY_ADMIN_TOKEN),
        "motion_available": motion_available(),
    }


# ─── API: Motion (Flyer → Bewegtbild, Stufe „Ambient") ───────────────────
#
# Bewusst als Job und nicht als synchroner Request: das Rendern dauert auf
# Render Free (0,1 CPU) deutlich laenger als ein Browser-Request warten sollte,
# und die generative Stufe „Cinematic" braucht spaeter ohnehin Minuten. Der
# Client legt einen Job an und pollt.
#
# Jobs liegen im Prozessspeicher, nicht in der Datenbank. Das ist fuer v1
# bewusst so: die Instanz ist ein einzelner Prozess, Jobs leben Minuten, und ein
# Neustart darf sie verlieren. Sobald mehr als eine Instanz laeuft oder Veo
# dazukommt, muss der Zustand nach Supabase — dann zaehlt der Job auch Geld,
# und ein verlorener Job kostet echtes Budget.

class MotionJobRequest(BaseModel):
    image: str = Field(..., description="Flyer als Base64-Data-URI")
    presets: list[str] = Field(default_factory=lambda: list(motion_render.DEFAULT_PRESETS))
    formats: list[str] = Field(default_factory=lambda: list(motion_render.ALL_FORMATS))
    duration: float = motion_render.DEFAULT_DURATION
    shortEdge: int = motion_render.DEFAULT_SHORT_EDGE
    bannerOffset: float = 0.5


MAX_MOTION_UPLOAD_BYTES = 12 * 1024 * 1024
# Base64 blaeht um ~4/3 auf, dazu etwas Luft fuer den JSON-Rahmen.
MOTION_MAX_BODY_BYTES = int(MAX_MOTION_UPLOAD_BYTES * 4 / 3) + 64 * 1024
MOTION_JOB_TTL_SECONDS = int(os.environ.get("MOTION_JOB_TTL", "1800"))
# Gleichzeitig wartend oder laufend. Bei Semaphore(1) heisst „6" schon: der
# sechste steht hinter fuenf seriellen Renders.
MOTION_MAX_ACTIVE_JOBS = int(os.environ.get("MOTION_MAX_ACTIVE_JOBS", "3"))
# Insgesamt gehaltene Jobs inklusive fertiger. Ohne dieses Limit waere die Zahl
# der Verzeichnisse mit fertigen MP4s bis zur TTL nach oben offen.
MOTION_MAX_RETAINED_JOBS = int(os.environ.get("MOTION_MAX_RETAINED_JOBS", "24"))

_motion_jobs: dict[str, dict] = {}
# Genau EIN Renderprozess gleichzeitig. Zwei parallele ffmpeg-Laeufe reissen die
# 512 MB der Free-Instanz, und bei 0,1 CPU macht Parallelitaet ohnehin nichts
# schneller — sie macht nur beide Jobs langsam.
_motion_semaphore = asyncio.Semaphore(1)


def motion_available() -> bool:
    try:
        motion_render.ffmpeg_bin()
        motion_render.ffprobe_bin()
        return True
    except motion_render.MotionError:
        return False


def _motion_discard(job_id: str) -> None:
    """Job samt Verzeichnis entfernen. Muss auf JEDEM Endzustand laufen, sonst
    bleiben Quelldatei (bis 12 MB) und Zwischenbilder auf der Platte liegen."""
    job = _motion_jobs.pop(job_id, None)
    if job:
        shutil.rmtree(job["dir"], ignore_errors=True)


def _motion_cleanup_expired() -> None:
    """
    Abgelaufene Jobs samt Dateien entfernen — die Instanz hat keinen Platz fuer
    Videos, die niemand mehr abholt.

    Laufende und wartende Jobs sind ausgenommen. Die TTL zaehlt ab
    FERTIGSTELLUNG, nicht ab Anlage: bei 0,1 CPU und seriellem Rendern kann ein
    Job laenger in der Warteschlange stehen als die TTL lang ist. Wuerde hier
    nach `created_at` aufgeraeumt, risse man einem laufenden Job das
    Arbeitsverzeichnis unter den Fuessen weg — ffmpeg liefe weiter und
    verbrauchte die einzige CPU, der Client bekaeme ab da 404.
    """
    now = time.time()
    for job_id, job in list(_motion_jobs.items()):
        if job["status"] in ("queued", "running"):
            continue
        finished_at = job.get("finished_at") or job["created_at"]
        if now - finished_at < MOTION_JOB_TTL_SECONDS:
            continue
        _motion_discard(job_id)


def _motion_public_job(job: dict) -> dict:
    return {
        "jobId": job["id"],
        "status": job["status"],
        "progress": job["progress"],
        "presets": job["presets"],
        "results": job["results"],
        "error": job["error"],
    }


async def _motion_run(
    job_id: str,
    src_path: Path,
    req: "motion_render.RenderRequest",
    src_info: "motion_render.SourceInfo",
) -> None:
    job = _motion_jobs[job_id]
    async with _motion_semaphore:
        # Der Job kann waehrend der Wartezeit abgelaufen und aufgeraeumt worden
        # sein. Dann gibt es kein Verzeichnis mehr, in das gerendert werden
        # koennte — hier abbrechen statt ins Leere schreiben.
        if _motion_jobs.get(job_id) is not job:
            return
        job["status"] = "running"

        def progress(index: int, total: int, fmt: str) -> None:
            job["progress"] = {
                "done": index,
                "total": total,
                "current": motion_render.FORMAT_LABEL.get(fmt, fmt),
            }

        try:
            # ffmpeg blockiert; ohne den Thread steht der Event-Loop und die
            # Statusabfrage des Clients bekommt keine Antwort mehr.
            clips = await asyncio.to_thread(
                functools.partial(
                    motion_render.render_all,
                    src_path, Path(job["dir"]), req,
                    measure=False, on_progress=progress, src=src_info,
                )
            )
        except motion_render.MotionError as exc:
            _motion_fail(job, exc.message)
            print(f"⚠️  Motion job {job_id} failed: {exc.message} | {exc.detail}")
            return
        except Exception as exc:  # noqa: BLE001
            _motion_fail(job, "Beim Rendern ist ein unerwarteter Fehler aufgetreten.")
            print(f"⚠️  Motion job {job_id} crashed: {exc}")
            traceback.print_exc()
            return

        results = []
        for clip in clips:
            entry = {
                "format": clip.fmt,
                "label": motion_render.FORMAT_LABEL[clip.fmt],
                "width": clip.width,
                "height": clip.height,
                "duration": clip.duration,
                "seconds": round(clip.seconds_spent, 1),
                "url": f"/api/motion/jobs/{job_id}/video?format={clip.fmt}",
                "publicUrl": None,
            }
            if supabase_client:
                # Der Supabase-Client ist synchron; der Upload ist ein
                # blockierender HTTP-Call. Ohne den Thread stuende der
                # Event-Loop fuer bis zu drei Videos nacheinander still — genau
                # der Grund, aus dem schon das Rendern ausgelagert ist. Die
                # Statusabfrage des Clients bekaeme so lange keine Antwort.
                entry["publicUrl"] = await asyncio.to_thread(
                    _motion_upload, clip, job_id,
                )
            results.append(entry)

        job["results"] = results
        job["progress"] = {"done": len(clips), "total": len(clips), "current": None}
        job["status"] = "done"
        job["finished_at"] = time.time()
        src_path.unlink(missing_ok=True)


def _motion_fail(job: dict, message: str) -> None:
    """
    Job als gescheitert markieren und die Zwischenstaende wegraeumen.

    Ohne das Aufraeumen bleibt bei jedem Fehlschlag die Quelldatei (bis 12 MB)
    plus alle Zwischenbilder liegen, bis die TTL greift — auf einer Instanz mit
    fluechtiger, kleiner Platte summiert sich das schnell.
    """
    job["status"] = "failed"
    job["error"] = message
    job["finished_at"] = time.time()
    for leftover in Path(job["dir"]).glob("*"):
        if leftover.is_file():
            leftover.unlink(missing_ok=True)


def _motion_upload(clip, job_id: str) -> str | None:
    """Nach Supabase hochladen, wenn ein Bucket konfiguriert ist. Fehler sind
    nicht fatal — das Video ist ueber den Job-Endpunkt ohnehin erreichbar."""
    try:
        path = f"{job_id}_{clip.fmt}.mp4"
        supabase_client.storage.from_(MOTION_BUCKET).upload(
            path=path,
            file=clip.path.read_bytes(),
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )
        return supabase_client.storage.from_(MOTION_BUCKET).get_public_url(path)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  Motion upload failed for {clip.fmt}: {e}")
        return None


@app.post("/api/motion/jobs")
async def api_motion_create_job(request: Request):
    """Legt einen Renderjob an und gibt sofort die Job-ID zurueck."""
    if not motion_available():
        raise structured_error(
            503,
            "Die Bewegtbild-Funktion ist auf diesem Server nicht verfügbar "
            "(ffmpeg fehlt).",
            "MOTION_UNAVAILABLE",
            False,
        )

    # Der Demo-Modus darf keine Rechenzeit verbrauchen. Der Header ist
    # kooperativ — die echte Bremse sind MOTION_MAX_ACTIVE_JOBS und das
    # Ein-Prozess-Limit darunter.
    if request.headers.get("X-Demo-Mode") == "1":
        raise structured_error(
            403,
            "Im Demo-Modus werden keine Videos gerendert.",
            "DEMO_MODE",
            False,
        )

    # Gegendruck VOR dem Einlesen des Bodys.
    #
    # Ein Flyer als Base64 ist ~16 MB Rohbody; kommt der Request erst durch die
    # Modellvalidierung, liegen Rohbody, geparster String und dekodierte Bytes
    # gleichzeitig im Speicher — rund 45 MB pro Request. Auf einer 512-MB-Instanz
    # reichen zehn gleichzeitige Uploads fuer den OOM-Kill des einzigen Workers,
    # samt aller laufenden Jobs. Deshalb zuerst Content-Length und Auslastung
    # pruefen und erst danach ueberhaupt lesen.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MOTION_MAX_BODY_BYTES:
        raise structured_error(
            413,
            "Der Flyer ist zu groß. Bitte maximal 12 MB hochladen.",
            "UPLOAD_TOO_LARGE",
            False,
        )

    _motion_cleanup_expired()
    active = sum(1 for j in _motion_jobs.values() if j["status"] in ("queued", "running"))
    if active >= MOTION_MAX_ACTIVE_JOBS:
        raise structured_error(
            429,
            "Gerade laufen zu viele Renderjobs. Bitte versuch es in ein paar "
            "Minuten noch einmal.",
            "MOTION_BUSY",
            True,
        )
    if len(_motion_jobs) >= MOTION_MAX_RETAINED_JOBS:
        raise structured_error(
            429,
            "Es liegen zu viele fertige Videos auf dem Server. Bitte versuch es "
            "in ein paar Minuten noch einmal.",
            "MOTION_BUSY",
            True,
        )

    raw_body = await request.body()
    if len(raw_body) > MOTION_MAX_BODY_BYTES:
        raise structured_error(
            413,
            "Der Flyer ist zu groß. Bitte maximal 12 MB hochladen.",
            "UPLOAD_TOO_LARGE",
            False,
        )
    try:
        req = MotionJobRequest.model_validate_json(raw_body)
    except Exception as exc:  # noqa: BLE001
        raise structured_error(
            400, "Die Anfrage konnte nicht gelesen werden.", "MOTION_INVALID", False,
        ) from exc

    mime_type, raw_bytes = validate_uploaded_image(req.image, MAX_MOTION_UPLOAD_BYTES)

    try:
        render_req = motion_render.RenderRequest(
            presets=tuple(req.presets),
            formats=tuple(req.formats),
            duration=req.duration,
            short_edge=req.shortEdge,
            banner_offset=req.bannerOffset,
        ).validated()
    except motion_render.MotionError as exc:
        raise structured_error(400, exc.message, "MOTION_INVALID", False)

    job_id = str(uuid.uuid4())
    job_dir = Path(tempfile.mkdtemp(prefix=f"motion-{job_id[:8]}-"))
    suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime_type]
    src_path = job_dir / f"source{suffix}"
    src_path.write_bytes(raw_bytes)

    # Quelle sofort pruefen, damit ein abgeschnittenes JPEG als klarer Fehler
    # zurueckkommt und nicht erst nach Minuten im Job auftaucht. Das Ergebnis
    # wird an den Job durchgereicht — die Pruefung dekodiert das Bild komplett,
    # und ein zweiter Durchlauf im Renderer wuerde diese Kosten auf 0,1 CPU
    # ohne Gegenwert verdoppeln.
    try:
        src_info = await asyncio.to_thread(motion_render.probe_source, src_path)
    except motion_render.MotionError as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise structured_error(400, exc.message, "MOTION_SOURCE_INVALID", False) from exc

    job = {
        "id": job_id,
        "dir": str(job_dir),
        "status": "queued",
        "progress": {"done": 0, "total": len(render_req.formats), "current": None},
        "presets": list(render_req.presets),
        "results": [],
        "error": None,
        "created_at": time.time(),
        "finished_at": None,
        "task": None,
    }
    _motion_jobs[job_id] = job

    # Referenz festhalten: der Event-Loop haelt Tasks nur schwach, ein sonst
    # unreferenzierter Task kann mitten im Lauf vom GC eingesammelt werden. Der
    # Job haengt dann fuer immer auf „queued" und der Client pollt ins Leere.
    # `_motion_public_job` waehlt die Felder explizit aus, das Task-Objekt
    # landet also nicht in der Antwort.
    job["task"] = asyncio.create_task(
        _motion_run(job_id, src_path, render_req, src_info)
    )
    return JSONResponse(content=_motion_public_job(job), status_code=202)


@app.get("/api/motion/jobs/{job_id}")
async def api_motion_job_status(job_id: str):
    # Auch hier aufraeumen: wuerde nur der POST-Handler putzen, gaebe eine
    # ruhige Woche ohne neuen Job den Platz nie wieder frei — und genau so
    # wird das Werkzeug benutzt, naemlich einmal pro Woche.
    _motion_cleanup_expired()

    job = _motion_jobs.get(job_id)
    if not job:
        raise structured_error(
            404,
            "Dieser Renderauftrag ist nicht mehr verfügbar. Bitte erzeuge das "
            "Bewegtbild neu.",
            "MOTION_JOB_GONE",
            False,
        )
    return JSONResponse(content=_motion_public_job(job))


@app.get("/api/motion/jobs/{job_id}/video")
async def api_motion_video(
    job_id: str,
    format: str = Query(..., alias="format"),
    download: int = 0,
):
    """
    Liefert ein fertiges Video aus. `download=1` erzwingt den Download.

    Content-Disposition mit explizitem Dateinamen ist auf iPhone/iPad Pflicht —
    ohne ihn landet die Datei ohne Endung im Downloads-Ordner und laesst sich
    nicht oeffnen (gleiche Fallstricke wie bei den Bild-Downloads, PR #2/#3).
    """
    job = _motion_jobs.get(job_id)
    if not job:
        raise structured_error(
            404,
            "Dieser Renderauftrag ist nicht mehr verfügbar. Bitte erzeuge das "
            "Bewegtbild neu.",
            "MOTION_JOB_GONE",
            False,
        )
    # Gegen die Enum pruefen, BEVOR der Wert in einen Pfad geht.
    if format not in motion_render.ALL_FORMATS:
        raise structured_error(400, "Unbekanntes Format.", "MOTION_INVALID", False)

    path = Path(job["dir"]) / f"{format}.mp4"
    if not path.is_file():
        raise structured_error(
            404, "Dieses Video ist noch nicht fertig.", "MOTION_PENDING", True,
        )

    headers = {}
    if download:
        filename = safe_download_filename(f"tyrannus-{format}.mp4", "video/mp4")
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return FileResponse(str(path), media_type="video/mp4", headers=headers)


@app.get("/api/motion/bench")
async def api_motion_bench(_: None = Depends(ensure_history_admin)):
    """
    Misst die reine Renderzeit auf DIESER Instanz.

    Der Grund fuer diesen Endpunkt: lokal auf einem M-Serie-Mac rechnet ffmpeg
    mit ~235 % CPU, Render Free hat 0,1 CPU. Wie gross der Faktor wirklich ist,
    laesst sich nicht schaetzen — nur messen. Von dieser Zahl haengt ab, ob
    720p reicht oder ob der Plan gewechselt werden muss.
    """
    if not motion_available():
        raise structured_error(503, "ffmpeg ist nicht verfügbar.", "MOTION_UNAVAILABLE", False)

    results = []
    with tempfile.TemporaryDirectory(prefix="motion-bench-") as raw_tmp:
        tmp = Path(raw_tmp)
        src = tmp / "bench.png"
        # Synthetische 1080x1350-Quelle — unabhaengig von hochgeladenen Dateien.
        await asyncio.to_thread(motion_render._run, [
            motion_render.ffmpeg_bin(), "-y", "-v", "error",
            "-f", "lavfi", "-i", "testsrc2=s=1080x1350",
            "-frames:v", "1", str(src),
        ])

        for short_edge in (720, 1080):
            req = motion_render.RenderRequest(
                presets=("atem", "licht"), formats=("feed",),
                duration=6, short_edge=short_edge,
            )
            started = time.monotonic()
            async with _motion_semaphore:
                clips = await asyncio.to_thread(
                    functools.partial(
                        motion_render.render_all, src, tmp, req, measure=False,
                    )
                )
            results.append({
                "shortEdge": short_edge,
                "size": f"{clips[0].width}x{clips[0].height}",
                "seconds": round(time.monotonic() - started, 1),
                "bytes": clips[0].path.stat().st_size,
            })
            clips[0].path.unlink(missing_ok=True)

    return {"ffmpeg": motion_render.ffmpeg_bin(), "runs": results}


# ─── Static File Serving (Production) ────────────────────────────────────

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
