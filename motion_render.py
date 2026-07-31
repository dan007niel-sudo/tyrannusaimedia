"""
Tyrannus AI Media — Motion Renderer (Stufe „Ambient")

Macht aus einem statischen Flyer ein nahtlos schleifendes Bewegtbild.
Rein deterministisch: nur ffmpeg, kein generatives Modell, keine Kosten pro Video.
Die Pixel des Flyers bleiben unveraendert — Schrift kann also nicht zerfleddern.

Zweistufig, damit der Speicher auf einer 512-MB-Instanz reicht:

  1. build_canvas()  — baut EINMAL das Standbild im Zielformat, ueberabgetastet
                       um Faktor S (siehe supersample_factor). Landet als PNG
                       im Temp-Verzeichnis.
  2. animate()       — faehrt die Bewegung darauf und encodiert.

Warum ueberabgetastet: ffmpegs zoompan quantisiert x/y/zoom auf ganze
Eingabepixel. Bei langsamen Fahrten bewegt sich das Bild dann weniger als einen
Pixel pro Frame und es entsteht sichtbares Stufen. Auf dem Mac loest die lokale
Pipeline das mit `magick -distort SRT` (Float-Argumente) — pro Frame ein eigener
Prozess, in der Cloud nicht bezahlbar. Der Ersatz: die Quelle vor zoompan um S
vergroessern und zoompan direkt auf die Zielgroesse ausgeben lassen. Die
Quantisierung liegt dann bei 1/S Ausgabepixel, und der interne Downscale
mittelt zusaetzlich.

Nahtlosigkeit: `atem`, `licht` und `staub` sind cosinus-periodisch —
(1-cos(2*PI*T/L))/2 ist bei T=0 und T=L identisch — und schliessen deshalb von
selbst. Nur `pushin` ist linear und braucht eine Ueberblendung; die baut
build_motion_graph() in denselben Durchlauf ein.

Zwei Nahtfehler, die nur durch Messung aufgefallen sind und die die Mathematik
allein nicht verhindert (Details an ZOOM_BASE und am `licht`-Zweig):

  * Bei Zoom exakt 1,0 verkleinert ffmpeg ohne Resampling. Frame 0 war dadurch
    der einzige unbehandelte Frame im Clip. → ZOOM_BASE, nie exakt 1,0.
  * `eq` ueberspringt sich selbst bei exakt neutralen Parametern. Frame 0 war
    dadurch der einzige Frame ohne Lichtkurve. → Puls um null zentrieren.

Beides sind Faelle, in denen der erste Frame in ein anderes Verarbeitungsregime
faellt als alle anderen. Wer hier etwas aendert, misst danach die Naht.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Sequence

# ─── Konfiguration ────────────────────────────────────────────────────────────

MotionPreset = Literal["atem", "licht", "pushin", "staub"]
MotionFormat = Literal["feed", "story", "banner"]

ALL_PRESETS: tuple[MotionPreset, ...] = ("atem", "licht", "pushin", "staub")
DEFAULT_PRESETS: tuple[MotionPreset, ...] = ("atem", "licht")
ALL_FORMATS: tuple[MotionFormat, ...] = ("feed", "story", "banner")

# Seitenverhaeltnisse. `feed` ist das Original-Flyerformat (kein Beschnitt),
# `story` fuellt oben/unten mit einer unscharfen Kopie auf (kein Beschnitt),
# `banner` beschneidet — und verliert dabei 55 % der Bildhoehe.
FORMAT_ASPECT: dict[MotionFormat, tuple[int, int]] = {
    "feed": (4, 5),
    "story": (9, 16),
    "banner": (16, 9),
}

FORMAT_LABEL: dict[MotionFormat, str] = {
    "feed": "Feed 4:5",
    "story": "Story 9:16",
    "banner": "TV-Loop 16:9",
}

# Kurze Kante der Ausgabe. 720 ist der Default, weil Render Free nur 0,1 CPU
# hat — die tatsaechliche Entscheidung faellt nach der Messung auf der Instanz.
DEFAULT_SHORT_EDGE = int(os.environ.get("MOTION_SHORT_EDGE", "720"))
DEFAULT_FPS = int(os.environ.get("MOTION_FPS", "30"))
DEFAULT_DURATION = float(os.environ.get("MOTION_DURATION", "8"))

MAX_DURATION = float(os.environ.get("MOTION_MAX_SECONDS", "20"))
MAX_SHORT_EDGE = int(os.environ.get("MOTION_MAX_SHORT_EDGE", "1080"))

# Obergrenze fuer die ueberabgetastete Zwischenstufe. 4096 auf der langen Kante
# haelt den ffmpeg-Speicher im dreistelligen MB-Bereich.
SUPERSAMPLE_CAP_PX = int(os.environ.get("MOTION_SUPERSAMPLE_CAP", "4096"))

# Grundzoom, der IMMER anliegt — auch bei Preset-Kombinationen ohne Fahrt.
#
# Nicht kosmetisch, sondern der Fix fuer einen echten Nahtfehler: bei Zoom
# exakt 1,0 schneidet zoompan die ueberabgetastete Vorlage pixelgenau und
# ffmpeg macht daraus eine saubere S:1-Verkleinerung ohne Resampling. Jeder
# andere Frame wird fraktional resampled und sieht minimal anders aus. Frame 0
# war dadurch der einzige „scharfe" Frame im ganzen Clip — die Schleife
# knackte sichtbar an genau einer Stelle, obwohl die Zoomkurve mathematisch
# perfekt geschlossen war. Gemessen: Naht 0,0127 gegen Nachbarschritte von
# ~0,000 in der Bildmitte.
#
# Mit einem Grundzoom liegen alle Frames im selben Resampling-Regime.
ZOOM_BASE = 1.015

# Amplituden der Presets.
ATEM_AMPLITUDE = 0.03   # +3 % Zoom im Scheitel
PUSHIN_AMPLITUDE = 0.08  # +8 % ueber die volle Laenge
LICHT_BRIGHTNESS = 0.045
LICHT_SATURATION = 0.06
STAUB_OPACITY = 0.22

# Laenge der Ueberblendung fuer `pushin`, in Sekunden.
SEAM_CROSSFADE_SECONDS = 1.2

FFMPEG_TIMEOUT = int(os.environ.get("MOTION_FFMPEG_TIMEOUT", "600"))

# Warnungen, an denen ein abgeschnittenes Bild erkennbar ist.
#
# Wichtig: das sind ffmpegs Formulierungen, nicht die von ImageMagick. Die
# lokale Pipeline erkennt den Fall an `Premature end of JPEG file` — das ist
# ImageMagick. ffmpeg 8 sagt bei genau derselben Datei stattdessen
# „EOI missing, emulating" und „component 0 is incomplete". Wer nur nach dem
# ImageMagick-Text sucht, laesst die kaputte Datei durch: verifiziert an der
# echten 16-KB-WhatsApp-Datei aus dem Berg-des-Herrn-Lauf, die exakt so
# unbemerkt durch die Pruefung lief.
TRUNCATED_MARKERS = (
    "premature end",
    "truncated",
    "eoi missing",
    "is incomplete",
    "error while decoding",
    "invalid data found",
)


class MotionError(RuntimeError):
    """Renderfehler mit einer Meldung, die direkt an den Nutzer gehen darf."""

    def __init__(self, message: str, *, detail: str = ""):
        super().__init__(message)
        self.message = message
        self.detail = detail


# ─── Binaries ─────────────────────────────────────────────────────────────────

def _binary(env_name: str, fallback: str) -> str:
    """
    ffmpeg/ffprobe-Pfad. Auf Render liegt ein statisches Build in ./bin/
    (siehe build.sh), lokal nimmt shutil.which das Homebrew-Binary.
    """
    explicit = os.environ.get(env_name)
    if explicit:
        return explicit

    vendored = Path(__file__).parent / "bin" / fallback
    if vendored.is_file() and os.access(vendored, os.X_OK):
        return str(vendored)

    found = shutil.which(fallback)
    if not found:
        raise MotionError(
            f"{fallback} ist auf diesem Server nicht verfügbar. "
            "Ohne ffmpeg kann kein Video gerendert werden.",
            detail=f"{env_name} nicht gesetzt, ./bin/{fallback} fehlt, kein PATH-Treffer.",
        )
    return found


def ffmpeg_bin() -> str:
    return _binary("FFMPEG_BIN", "ffmpeg")


def ffprobe_bin() -> str:
    return _binary("FFPROBE_BIN", "ffprobe")


def _run(cmd: Sequence[str], *, timeout: int = FFMPEG_TIMEOUT) -> str:
    """
    ffmpeg/ffprobe aufrufen. Bei Timeout wird der Prozess wirklich getoetet —
    ein aufgegebenes wait() laesst sonst einen ffmpeg auf der Instanz stehen und
    frisst die 512 MB fuer den naechsten Job mit.
    """
    try:
        proc = subprocess.run(
            list(cmd),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise MotionError(
            "Das Rendern hat zu lange gedauert und wurde abgebrochen. "
            "Versuch es mit einer kürzeren Dauer oder weniger Formaten.",
            detail=f"Timeout nach {timeout}s: {' '.join(cmd[:6])}…",
        ) from exc

    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-12:]
        raise MotionError(
            "Beim Rendern ist ein Fehler aufgetreten.",
            detail="\n".join(tail),
        )
    return proc.stdout


# ─── Quelle pruefen ───────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SourceInfo:
    width: int
    height: int

    @property
    def aspect(self) -> float:
        return self.width / self.height


def probe_source(path: Path) -> SourceInfo:
    """
    Masse lesen — und dabei abgeschnittene Dateien abfangen.

    WhatsApp legt im Cache teils unvollstaendige Progressive-JPEGs ab: Header
    meldet 1080x1350, die Datei ist aber 16 KB gross und enthaelt nur die ersten
    Scans. ffprobe meldet das als Fehler bzw. warnt mit `Premature end of JPEG
    file`. Dieser Warnung nachgehen, nicht wegklicken — sonst rendert man einen
    Loop mit farbigem Muellstreifen am Rand.
    """
    if not path.is_file() or path.stat().st_size == 0:
        raise MotionError("Die hochgeladene Datei ist leer oder nicht lesbar.")

    out = _run([
        ffprobe_bin(), "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json", str(path),
    ], timeout=30)

    try:
        streams = json.loads(out).get("streams") or []
        width = int(streams[0]["width"])
        height = int(streams[0]["height"])
    except (json.JSONDecodeError, IndexError, KeyError, TypeError, ValueError) as exc:
        raise MotionError(
            "Das Bild konnte nicht gelesen werden. Bitte lade den Flyer als "
            "JPG, PNG oder WebP erneut hoch.",
            detail=str(exc),
        ) from exc

    if width < 320 or height < 320:
        raise MotionError(
            f"Der Flyer ist mit {width}×{height} px zu klein für ein Video. "
            "Bitte lade das Original hoch, nicht die WhatsApp-Vorschau."
        )

    # Zweiter, schaerferer Durchlauf: komplett dekodieren und auf Warnungen
    # achten. Ein abgeschnittenes JPEG faellt erst hier auf — ffprobe liest nur
    # den Header und meldet brav 1080x1350, obwohl die Datei 16 KB gross ist.
    decode = subprocess.run(
        [ffmpeg_bin(), "-v", "warning", "-i", str(path), "-f", "null", "-"],
        capture_output=True, text=True, timeout=60, check=False,
    )
    stderr = (decode.stderr or "").lower()
    if decode.returncode != 0 or any(s in stderr for s in TRUNCATED_MARKERS):
        raise MotionError(
            "Die Bilddatei ist unvollständig (abgeschnitten). Das passiert oft bei "
            "Bildern aus dem WhatsApp-Cache. Bitte besorg dir das Original.",
            detail=(decode.stderr or "").strip()[-400:],
        )

    return SourceInfo(width=width, height=height)


# ─── Geometrie ────────────────────────────────────────────────────────────────

def output_size(fmt: MotionFormat, short_edge: int) -> tuple[int, int]:
    """Ausgabegroesse, beide Kanten auf gerade Zahlen gerundet (yuv420p)."""
    aw, ah = FORMAT_ASPECT[fmt]
    if aw <= ah:  # Hochformat oder quadratisch → kurze Kante ist die Breite
        width = short_edge
        height = round(short_edge * ah / aw)
    else:
        height = short_edge
        width = round(short_edge * aw / ah)
    return (width - width % 2, height - height % 2)


def supersample_factor(width: int, height: int) -> int:
    """
    Faktor S fuer die Zwischenstufe. Je groesser S, desto feiner die
    Bewegungsschritte — aber der Speicher waechst quadratisch. Deckel bei
    SUPERSAMPLE_CAP_PX auf der langen Kante.
    """
    longest = max(width, height)
    if longest <= 0:
        return 2
    return max(2, min(4, SUPERSAMPLE_CAP_PX // longest))


def banner_crop_loss(src: SourceInfo) -> float:
    """
    Anteil der Bildhoehe, der beim 16:9-Beschnitt verloren geht.

    Aus einer 4:5-Quelle bleiben nur 45 % der Hoehe uebrig — Fusszeile,
    Vordergrund und alles am oberen Rand sind weg. Die UI muss das VOR dem
    Rendern zeigen, nicht hinterher.
    """
    kept_height = src.width * 9 / 16
    return max(0.0, 1.0 - min(1.0, kept_height / src.height))


# ─── Stufe 1: Standbild im Zielformat ─────────────────────────────────────────

def build_canvas(
    src_path: Path,
    dest_path: Path,
    fmt: MotionFormat,
    src: SourceInfo,
    *,
    short_edge: int = DEFAULT_SHORT_EDGE,
    banner_offset: float = 0.5,
) -> tuple[int, int, int]:
    """
    Baut das ueberabgetastete Standbild fuer ein Format. Gibt (breite, hoehe, S)
    der Zwischenstufe zurueck.
    """
    out_w, out_h = output_size(fmt, short_edge)
    s = supersample_factor(out_w, out_h)
    tw, th = out_w * s, out_h * s

    if fmt == "story":
        # Kein Beschnitt: Flyer vollstaendig mittig, oben/unten eine stark
        # unscharfe, abgedunkelte Kopie seiner selbst. Der Blur laeuft auf einer
        # 1/8-Verkleinerung — gblur mit grossem Sigma auf voller Groesse ist auf
        # 0,1 CPU nicht bezahlbar, das Ergebnis ist visuell nicht zu unterscheiden.
        vf = (
            f"[0:v]split=2[bgsrc][fgsrc];"
            f"[bgsrc]scale={tw}:{th}:force_original_aspect_ratio=increase:flags=bilinear,"
            f"crop={tw}:{th},"
            f"scale={max(2, tw // 8)}:{max(2, th // 8)}:flags=bilinear,"
            f"gblur=sigma=8,"
            f"scale={tw}:{th}:flags=bilinear,"
            f"eq=brightness=-0.20:saturation=0.55[bg];"
            f"[fgsrc]scale={tw}:{th}:force_original_aspect_ratio=decrease:flags=lanczos[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgb24[out]"
        )
    elif fmt == "banner":
        # Volle Breite behalten, Hoehe beschneiden. banner_offset 0..1 schiebt
        # den Ausschnitt vertikal.
        scaled_h = max(th, round(tw * src.height / src.width))
        offset = min(max(banner_offset, 0.0), 1.0)
        crop_y = round((scaled_h - th) * offset)
        vf = (
            f"[0:v]scale={tw}:{scaled_h}:flags=lanczos,"
            f"crop={tw}:{th}:0:{crop_y},format=rgb24[out]"
        )
    else:  # feed — Cover-Beschnitt auf 4:5, bei 4:5-Quellen also unveraendert
        vf = (
            f"[0:v]scale={tw}:{th}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={tw}:{th},format=rgb24[out]"
        )

    _run([
        ffmpeg_bin(), "-y", "-v", "error",
        "-i", str(src_path),
        "-filter_complex", vf,
        "-map", "[out]",
        "-frames:v", "1",
        str(dest_path),
    ])

    if not dest_path.is_file() or dest_path.stat().st_size == 0:
        raise MotionError("Das Zwischenbild konnte nicht erzeugt werden.")

    return tw, th, s


# ─── Stufe 2: Bewegung ────────────────────────────────────────────────────────

def _zoom_expression(
    presets: Sequence[MotionPreset],
    loop_frames: int,
    *,
    frame_offset: int = 0,
) -> str:
    """
    Zoomkurve als zoompan-Ausdruck ueber `on` (Ausgabe-Framenummer, 0-basiert).

    Fortschritt bewusst on/N und nicht on/(N-1): Frame N waere wieder Frame 0,
    die Periode muss also ueber N Frames laufen, damit die Schleife schliesst.

    `frame_offset` verschiebt die Kurve um N Frames nach vorn. Damit laesst sich
    A(t+L) erzeugen, ohne die Datei ein zweites Mal zu lesen — siehe
    build_motion_graph().
    """
    pos = f"(on+{frame_offset})" if frame_offset else "on"
    terms: list[str] = [str(ZOOM_BASE)]
    if "atem" in presets:
        terms.append(f"{ATEM_AMPLITUDE}*(1-cos(2*PI*{pos}/{loop_frames}))/2")
    if "pushin" in presets:
        terms.append(f"{PUSHIN_AMPLITUDE}*{pos}/{loop_frames}")
    return "+".join(terms)


def _zoompan_chain(zoom: str, out_w: int, out_h: int, fps: int) -> str:
    return (
        f"zoompan=z='{zoom}'"
        f":x='iw/2-(iw/zoom/2)'"
        f":y='ih/2-(ih/zoom/2)'"
        f":d=1:s={out_w}x{out_h}:fps={fps}"
    )


def _dust_tile_height(out_h: int) -> int:
    """Kachelhoehe. Vier gestapelte Kacheln muessen das Bild plus einen vollen
    Scrollweg abdecken, also mindestens out_h + tile_h."""
    return max(2, -(-out_h // 3))  # aufgerundet


def _dust_strip(dest: Path, width: int, out_h: int) -> int:
    """
    Rendert den fertig gestapelten Staubstreifen EINMAL als PNG.

    Zwei Dinge, die vorher falsch waren:

    1. Der Stapel wurde per `vstack` im Filtergraph gebaut — also fuer jeden
       einzelnen Frame neu, obwohl er sich nie aendert. Das kostete das
       Dreifache der reinen Renderzeit. Jetzt entsteht der Streifen einmal
       vorab, und pro Frame bleibt nur noch ein `overlay`.

    2. Drei Kacheln reichen nicht. Scrollt man einen Stapel der Hoehe 3*h um
       eine volle Kachelhoehe, bleibt am unteren Rand ein Streifen der Hoehe h
       unbedeckt — dort verschwindet der Staub, und genau das riss die Naht auf
       (gemessen: 7,1× schlechter als die Bildmitte). Vier Kacheln decken
       Bild + Scrollweg vollstaendig ab.

    Die Punktverteilung kommt aus einer Hash-artigen sin/mod-Funktion ueber
    X,Y — deterministisch, also ueber alle Frames stabil. `mod(Y,tile_h)` macht
    den Streifen in sich periodisch, damit die Kachelgrenzen unsichtbar bleiben.
    """
    tile_h = _dust_tile_height(out_h)
    strip_h = tile_h * 4
    expr = (
        "255*lt(mod(abs(sin(X*12.9898+mod(Y,"
        f"{tile_h}"
        ")*78.233)*43758.5453),1),0.00055)"
    )
    _run([
        ffmpeg_bin(), "-y", "-v", "error",
        "-f", "lavfi", "-i", f"color=c=black:s={width}x{strip_h}",
        "-vf", f"format=gray,geq=lum='{expr}',gblur=sigma=0.6,format=gray",
        "-frames:v", "1", str(dest),
    ])
    return tile_h


@dataclass(frozen=True)
class MotionGraph:
    """Fertig gebauter ffmpeg-Aufruf ohne Ausgabeteil."""
    inputs: tuple[str, ...]
    filter_complex: str
    total_frames: int


def build_motion_graph(
    canvas_path: Path,
    *,
    presets: Sequence[MotionPreset],
    duration: float,
    fps: int,
    out_w: int,
    out_h: int,
    tmp_dir: Path,
) -> MotionGraph:
    """
    Baut Bewegung UND Nahtschluss in einem einzigen Filtergraph.

    Warum in einem Durchlauf: die urspruengliche Zweiteilung (erst Bewegung
    encodieren, dann die Naht auf der fertigen MP4 schliessen) kostet einen
    kompletten Zwischen-Encode und legt x264-Rauschen unter jede spaetere
    Messung. Beides faellt weg, wenn die zweite Haelfte der Ueberblendung direkt
    als zweite Bewegungskette aus demselben Standbild erzeugt wird.

    Die Ueberblendung gehoert an den ANFANG, nicht ans Ende. Fuer eine Fahrt
    A(t) gilt:

        O(t) = (1-w)*A(t) + w*A(t+L)   fuer t < X,  w faellt von 1 auf 0
        O(t) = A(t)                     danach

    Dann ist O(0) = A(L), und das schliesst stetig an O(L-) = A(L-) an. Die
    naheliegende Variante „Anfang ans Ende blenden" braeuchte A(t-L) — negative
    Zeit, existiert nicht.

    A(t+L) entsteht hier nicht durch ein zweites Einlesen mit -ss, sondern durch
    dieselbe Kette mit um L verschobener Zoomkurve. Kein `split`, kein Puffern
    von hunderten Frames — der Speicherfresser aus der lokalen Pipeline kann
    hier gar nicht erst auftreten.

    `licht` und `staub` sind periodisch (bei t und t+L identisch) und liegen
    deshalb NACH der Ueberblendung auf dem fertigen Bild. Das spart die zweite
    Auswertung und kann die Naht nicht stoeren.
    """
    loop_frames = max(2, round(duration * fps))
    needs_seam = "pushin" in presets

    inputs: list[str] = [
        "-loop", "1", "-framerate", str(fps), "-t", f"{duration:.4f}",
        "-i", str(canvas_path),
    ]
    parts: list[str] = []
    input_count = 1

    zoom_a = _zoom_expression(presets, loop_frames)
    parts.append(f"[0:v]{_zoompan_chain(zoom_a, out_w, out_h, fps)}[a]")

    if needs_seam:
        seam_frames = max(2, round(SEAM_CROSSFADE_SECONDS * fps))
        crossfade = seam_frames / fps
        inputs += [
            "-loop", "1", "-framerate", str(fps), "-t", f"{crossfade:.4f}",
            "-i", str(canvas_path),
        ]
        zoom_b = _zoom_expression(presets, loop_frames, frame_offset=loop_frames)
        parts.append(
            f"[{input_count}:v]{_zoompan_chain(zoom_b, out_w, out_h, fps)},"
            f"format=yuva420p,fade=t=out:st=0:d={crossfade:.4f}:alpha=1[b]"
        )
        parts.append("[a][b]overlay=0:0:format=auto:eof_action=pass[base]")
        stage = "[base]"
        input_count += 1
    else:
        stage = "[a]"

    if "licht" in presets:
        # (1-cos(2*PI*t/L))/2 laeuft von 0 bis 1 und ist bei t=0 und t=L
        # identisch — die Helligkeit schliesst also von selbst.
        #
        # Der Puls wird bewusst um NULL ZENTRIERT (pulse-0.5) statt bei null zu
        # starten. Grund ist ein Schnellpfad in `eq`: bei exakt neutralen
        # Parametern (brightness=0, saturation=1) ueberspringt der Filter die
        # LUT komplett und reicht den Frame unveraendert durch. Genau das traf
        # frueher nur Frame 0 — der war dadurch als einziger Frame im Clip
        # unbearbeitet und um ~1 Helligkeitsstufe heller als alle anderen. Die
        # Schleife knackte sichtbar, obwohl die Kurve mathematisch geschlossen
        # war. Gemessen: YAVG 39,98 bei Frame 0 gegen 38,89 ueberall sonst.
        #
        # Zentriert ist der Wert bei t=0 gleich -amp/2, also nie neutral, und
        # der Schnellpfad greift auf keinem Frame.
        pulse = f"((1-cos(2*PI*t/{duration}))/2-0.5)"
        parts.append(
            f"{stage}eq=brightness='{LICHT_BRIGHTNESS}*{pulse}'"
            f":saturation='1+{LICHT_SATURATION}*{pulse}':eval=frame[lit]"
        )
        stage = "[lit]"

    if "staub" in presets:
        strip = tmp_dir / f"dust_{out_w}x{out_h}.png"
        tile_h = _dust_strip(strip, out_w, out_h) if not strip.is_file() \
            else _dust_tile_height(out_h)
        inputs += [
            "-loop", "1", "-framerate", str(fps), "-t", f"{duration:.4f}",
            "-i", str(strip),
        ]
        parts.append(
            f"[{input_count}:v]format=yuva420p,"
            f"colorchannelmixer=aa={STAUB_OPACITY}[dust]"
        )
        # Ueber die Loop-Laenge um GENAU eine Kachelhoehe scrollen: bei t=0 und
        # t=L ist mod(t/L,1) beides 0, der Streifen sitzt also wieder exakt
        # gleich. Der Stapel ist 4 Kacheln hoch und deckt Bild + Scrollweg ab.
        parts.append(
            f"{stage}[dust]overlay=x=0"
            f":y='-mod(t/{duration},1)*{tile_h}'"
            f":format=auto:eof_action=repeat[dusted]"
        )
        stage = "[dusted]"
        input_count += 1

    parts.append(f"{stage}format=yuv420p[out]")

    return MotionGraph(
        inputs=tuple(inputs),
        filter_complex=";".join(parts),
        total_frames=loop_frames,
    )


def animate(graph: MotionGraph, dest_path: Path, *, fps: int) -> None:
    """Rendert den Bewegungsgraphen nach H.264."""
    _run([
        ffmpeg_bin(), "-y", "-v", "error",
        *graph.inputs,
        "-filter_complex", graph.filter_complex,
        "-map", "[out]",
        "-frames:v", str(graph.total_frames),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-pix_fmt", "yuv420p",
        "-g", str(fps * 2),
        "-movflags", "+faststart",
        "-an",
        str(dest_path),
    ])


def render_probe_frames(
    graph: MotionGraph,
    tmp_dir: Path,
    indices: Sequence[int],
) -> list[Path]:
    """
    Rendert einzelne Frames des Bewegungsgraphen verlustfrei als PNG.

    Das ist die Grundlage jeder Messung. Auf dem fertigen MP4 zu messen ist
    wertlos: Frame 0 ist ein Keyframe, Frame N-1 ein P-Frame. Der
    Quantisierungsunterschied zwischen beiden ist groesser als jeder echte
    Nahtfehler und dominiert die Messung vollstaendig — beim ersten Lauf hier
    um den Faktor 17 bis 75.
    """
    wanted = sorted(set(indices))
    # Kommas hier NICHT escapen: der Ausdruck steht bereits in einfachen
    # Anfuehrungszeichen, und `eq(n\,0)` wird darin als literales Backslash-Komma
    # gelesen. ffmpeg meldet das nicht als Fehler — es laesst dann einfach alle
    # Frames durch, und -frames:v schneidet die ersten N ab. Die Messung
    # verglich dadurch stillschweigend Frame 0 mit Frame 1 statt mit Frame N-1
    # und war wertlos, ohne je fehlzuschlagen.
    select = "+".join(f"eq(n,{i})" for i in wanted)
    pattern = tmp_dir / "probe_%03d.png"

    for stale in tmp_dir.glob("probe_*.png"):
        stale.unlink(missing_ok=True)

    _run([
        ffmpeg_bin(), "-y", "-v", "error",
        *graph.inputs,
        "-filter_complex", f"{graph.filter_complex};[out]select='{select}'[sel]",
        "-map", "[sel]",
        "-fps_mode", "passthrough",
        "-frames:v", str(len(wanted)),
        str(pattern),
    ])

    produced = [tmp_dir / f"probe_{i + 1:03d}.png" for i in range(len(wanted))]
    missing = [p for p in produced if not p.is_file()]
    if missing:
        raise MotionError(
            "Messframes konnten nicht erzeugt werden.",
            detail=f"fehlend: {[p.name for p in missing]}",
        )
    return produced


def assert_probe_selection_works(graph: MotionGraph, tmp_dir: Path) -> None:
    """
    Selbsttest der Messung: Frame 0 muss sich vom Scheitelframe unterscheiden.

    Ohne diesen Test kann `select` still ausfallen — es meldet keinen Fehler,
    laesst dann aber alle Frames durch, und `-frames:v N` schneidet die ersten N
    ab. Die Nahtmessung vergleicht in dem Fall Frame 0 mit Frame 1 statt mit
    Frame N-1 und liefert plausible, aber wertlose Zahlen. Ein Messwerkzeug, das
    nicht fehlschlagen kann, misst nichts.

    Verglichen wird bewusst gegen die Bildmitte und nicht gegen Frame N-1: bei
    einer periodischen Fahrt ist Frame N-1 dem Frame 0 legitim sehr aehnlich,
    ein Vergleich dort wuerde als Kanarienvogel fehlschlagen.
    """
    n = graph.total_frames
    if n < 8:
        return
    a = render_probe_frames(graph, tmp_dir, [0])[0].read_bytes()
    b = render_probe_frames(graph, tmp_dir, [n // 2])[0].read_bytes()
    for stale in tmp_dir.glob("probe_*.png"):
        stale.unlink(missing_ok=True)
    if a == b:
        raise MotionError(
            "Die Messung ist nicht vertrauenswürdig.",
            detail="select im Messgraphen filtert nicht — Frame 0 und der "
                   "Scheitelframe sind byte-identisch. Nahtwerte wären wertlos.",
        )


# ─── Qualitaetstore ───────────────────────────────────────────────────────────

def extract_frame(video: Path, index: int, dest: Path) -> None:
    _run([
        ffmpeg_bin(), "-y", "-v", "error",
        "-i", str(video),
        "-vf", f"select=eq(n\\,{index})",
        "-vsync", "0", "-frames:v", "1",
        str(dest),
    ], timeout=120)


def frame_count(video: Path) -> int:
    out = _run([
        ffprobe_bin(), "-v", "error",
        "-select_streams", "v:0",
        "-count_frames", "-show_entries", "stream=nb_read_frames",
        "-of", "default=nokey=1:noprint_wrappers=1", str(video),
    ], timeout=180)
    return int(out.strip())


def frame_rmse(a: Path, b: Path) -> float:
    """
    RMSE zweier Frames, 0..1. Nutzt ffmpegs psnr-Filter — kein Pillow/numpy
    noetig, also keine neue Abhaengigkeit auf der 512-MB-Instanz.
    """
    # -v info ist Pflicht: der psnr-Filter schreibt sein Ergebnis auf stderr,
    # und -v error wuerde genau diese Zeile verschlucken.
    proc = subprocess.run(
        [ffmpeg_bin(), "-v", "info", "-i", str(a), "-i", str(b),
         "-lavfi", "psnr", "-f", "null", "-"],
        capture_output=True, text=True, timeout=120, check=False,
    )
    text = (proc.stderr or "") + (proc.stdout or "")
    tokens = text.replace("\n", " ").split()

    # Aeltere ffmpeg-Versionen melden bei YUV-Eingang `mse_avg:`, ffmpeg 8
    # bei RGB nur `average:` (PSNR in dB). Beides akzeptieren.
    for token in tokens:
        if token.startswith("mse_avg:"):
            return math.sqrt(float(token.split(":", 1)[1])) / 255.0

    for token in tokens:
        if token.startswith("average:"):
            psnr_db = float(token.split(":", 1)[1])
            if psnr_db == float("inf"):
                return 0.0
            # PSNR = 20*log10(MAX/RMSE) → RMSE/MAX = 10^(-PSNR/20)
            return 10 ** (-psnr_db / 20)

    raise MotionError("Nahtmessung fehlgeschlagen.", detail=text[-400:])


SEAM_RATIO_LIMIT = 1.3

# Ein RMSE von 0,002 entspricht ~0,5 Helligkeitsstufen von 255. Darunter ist ein
# Nahtsprung auf keinem Bildschirm sichtbar; der Boden verhindert, dass eine
# perfekte Schleife (Referenz exakt 0) ein sinnloses Verhaeltnis erzeugt.
SEAM_ABSOLUTE_FLOOR = 0.002


def measure_seam(graph: MotionGraph, tmp_dir: Path) -> dict[str, float]:
    """
    Naht messbar pruefen statt hinsehen.

    Verglichen wird der Uebergang letzter → erster Frame gegen zwei normale
    Nachbarframes aus der Bildmitte. Sind beide Werte gleich gross, ist die
    Schleife nahtlos. Beim ersten Handlauf der lokalen Pipeline war die Naht
    (0,060) SCHLECHTER als die Bildmitte (0,045) — ohne diese Messung waere der
    Fehler nie aufgefallen.

    Gemessen wird bewusst auf dem FILTERGRAPHEN, nicht auf dem fertigen MP4:
    zwischen Keyframe und P-Frame liegt mehr Codec-Rauschen als jeder echte
    Nahtfehler. Die Messframes kommen deshalb verlustfrei als PNG heraus.
    """
    n = graph.total_frames
    if n < 4:
        raise MotionError("Video zu kurz für eine Nahtprüfung.")

    assert_probe_selection_works(graph, tmp_dir)

    # Referenz bewusst aus Frame 1→2 und nicht aus der Bildmitte: die Naht liegt
    # am Zyklusanfang, wo eine Cosinus-Fahrt stillsteht. Die Bildmitte steht bei
    # einem Atem-Zoom aber ebenfalls still (Scheitel), sodass die Referenz exakt
    # 0 wird und jedes Verhaeltnis „unendlich" ergibt — eine Zahl, die nichts
    # aussagt. Frame 1→2 liegt in derselben Phase wie die Naht und ist damit der
    # ehrliche Vergleich.
    quarter = max(1, n // 4)
    indices = [0, 1, 2, quarter, quarter + 1, n - 1]
    frames = render_probe_frames(graph, tmp_dir, indices)
    by_index = dict(zip(sorted(set(indices)), frames))

    seam = frame_rmse(by_index[n - 1], by_index[0])
    reference = frame_rmse(by_index[1], by_index[2])
    fastest = frame_rmse(by_index[quarter], by_index[quarter + 1])

    for frame in frames:
        frame.unlink(missing_ok=True)

    # Absoluter Boden, damit 0/0 kein „unendlich" produziert. Unterhalb von
    # SEAM_ABSOLUTE_FLOOR ist der Unterschied ohnehin unter einer
    # Helligkeitsstufe und auf keinem Bildschirm sichtbar.
    denominator = max(reference, SEAM_ABSOLUTE_FLOOR)
    ratio = seam / denominator

    return {
        "seam": seam,
        "reference": reference,
        "fastest_step": fastest,
        "ratio": ratio,
    }


def measure_sharpness(frame: Path) -> float:
    """
    Hochfrequenzenergie eines Frames: Laplace-Faltung, dann mittlere Helligkeit
    der gleichgerichteten Antwort (YAVG). Faellt der Wert ueber die Frames
    deutlich ab, hat die Bewegung die Schrift weichgezogen.

    Ausgelesen ueber ffprobe + lavfi statt ueber `metadata=print` auf stderr —
    das Ergebnis kommt so als JSON statt als Logzeile und haengt nicht am
    Loglevel. YAVG statt YSTDEV, weil signalstats je nach ffmpeg-Build kein
    YSTDEV liefert; als Kantenmass sind beide gleichwertig.
    """
    graph = (
        f"movie={_lavfi_escape(frame)},format=gray,"
        f"convolution='0 1 0 1 -4 1 0 1 0',signalstats"
    )
    out = _run([
        ffprobe_bin(), "-v", "error",
        "-f", "lavfi", "-i", graph,
        "-show_entries", "frame_tags=lavfi.signalstats.YAVG",
        "-of", "json",
    ], timeout=120)

    try:
        frames = json.loads(out).get("frames") or []
        return float(frames[0]["tags"]["lavfi.signalstats.YAVG"])
    except (json.JSONDecodeError, IndexError, KeyError, TypeError, ValueError) as exc:
        raise MotionError("Schärfemessung fehlgeschlagen.", detail=str(exc)) from exc


def _lavfi_escape(path: Path) -> str:
    """Pfad fuer die movie=-Quelle in einem lavfi-Graphen maskieren."""
    return str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def measure_text_sharpness_drift(
    graph: MotionGraph,
    tmp_dir: Path,
    *,
    region_fraction: float = 1.0,
) -> dict[str, float]:
    """
    Prueft, ob die Schrift ueber die Laufzeit weich wird.

    Bei den periodischen Presets ist Frame 0 der Referenzzustand; in der
    Bildmitte ist der Zoom maximal, dort ist also am ehesten mit
    Resampling-Verlust zu rechnen. Faellt die Hochfrequenzenergie dort deutlich
    ab, hat das Hochskalieren die Typografie gekostet — genau der Fehler, den
    man auf dem Handy erst sieht, wenn das Video schon veroeffentlicht ist.
    """
    n = graph.total_frames
    mid = n // 2
    frames = render_probe_frames(graph, tmp_dir, [0, mid])
    first, middle = frames[0], frames[1]

    sharp_first = measure_sharpness(first)
    sharp_mid = measure_sharpness(middle)

    for frame in frames:
        frame.unlink(missing_ok=True)

    retained = sharp_mid / sharp_first if sharp_first > 1e-9 else 0.0
    return {"first": sharp_first, "mid": sharp_mid, "retained": retained}


# ─── Orchestrierung ───────────────────────────────────────────────────────────

@dataclass
class RenderRequest:
    presets: tuple[MotionPreset, ...] = DEFAULT_PRESETS
    formats: tuple[MotionFormat, ...] = ALL_FORMATS
    duration: float = DEFAULT_DURATION
    fps: int = DEFAULT_FPS
    short_edge: int = DEFAULT_SHORT_EDGE
    banner_offset: float = 0.5

    def validated(self) -> "RenderRequest":
        presets = tuple(p for p in self.presets if p in ALL_PRESETS)
        if not presets:
            presets = DEFAULT_PRESETS
        formats = tuple(f for f in self.formats if f in ALL_FORMATS)
        if not formats:
            raise MotionError("Bitte wähle mindestens ein Format aus.")

        duration = min(max(float(self.duration), 3.0), MAX_DURATION)
        fps = 30 if self.fps not in (24, 25, 30) else self.fps
        short_edge = min(max(int(self.short_edge), 480), MAX_SHORT_EDGE)
        offset = min(max(float(self.banner_offset), 0.0), 1.0)

        return RenderRequest(
            presets=presets, formats=formats, duration=duration,
            fps=fps, short_edge=short_edge, banner_offset=offset,
        )


@dataclass
class RenderedClip:
    fmt: MotionFormat
    path: Path
    width: int
    height: int
    duration: float
    seconds_spent: float
    seam: dict[str, float] = field(default_factory=dict)
    sharpness: dict[str, float] = field(default_factory=dict)


def render_all(
    src_path: Path,
    tmp_dir: Path,
    req: RenderRequest,
    *,
    measure: bool = False,
    on_progress=None,
    src: SourceInfo | None = None,
) -> list[RenderedClip]:
    """
    Rendert alle gewuenschten Formate nacheinander — bewusst seriell. Zwei
    parallele ffmpeg-Prozesse reissen die 512 MB der Free-Instanz.

    `src` kann durchgereicht werden, wenn die Quelle bereits geprueft wurde.
    probe_source() dekodiert das Bild vollstaendig — auf 0,1 CPU ist ein
    zweiter Durchlauf pro Job spuerbar und bringt nichts.
    """
    req = req.validated()
    if src is None:
        src = probe_source(src_path)
    clips: list[RenderedClip] = []

    for i, fmt in enumerate(req.formats):
        if on_progress:
            on_progress(i, len(req.formats), fmt)

        started = time.monotonic()
        canvas = tmp_dir / f"canvas_{fmt}.png"
        build_canvas(
            src_path, canvas, fmt, src,
            short_edge=req.short_edge, banner_offset=req.banner_offset,
        )
        out_w, out_h = output_size(fmt, req.short_edge)

        graph = build_motion_graph(
            canvas,
            presets=req.presets, duration=req.duration, fps=req.fps,
            out_w=out_w, out_h=out_h, tmp_dir=tmp_dir,
        )

        final = tmp_dir / f"{fmt}.mp4"
        animate(graph, final, fps=req.fps)

        clip = RenderedClip(
            fmt=fmt, path=final, width=out_w, height=out_h,
            duration=req.duration, seconds_spent=time.monotonic() - started,
        )

        # Die Messung braucht den Graphen (nicht die MP4) und damit auch noch
        # das Standbild — deshalb erst danach aufraeumen.
        if measure:
            clip.seam = measure_seam(graph, tmp_dir)
            clip.sharpness = measure_text_sharpness_drift(graph, tmp_dir)

        canvas.unlink(missing_ok=True)
        clips.append(clip)

    for _dust in tmp_dir.glob("dust_*.png"):
        _dust.unlink(missing_ok=True)
    return clips
