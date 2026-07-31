"""
Qualitaetstore fuer den Motion-Renderer.

Diese Tests pruefen nicht, ob der Code laeuft, sondern ob das Ergebnis stimmt.
Jeder einzelne steht fuer einen Fehler, der real aufgetreten ist und den man
dem fertigen Video nicht ansieht, bevor es veroeffentlicht ist.

Ausfuehren:  python3 -m pytest tests/test_motion_render.py -v
Braucht ffmpeg (lokal Homebrew, auf Render das Build aus ./bin/).
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import pytest

import motion_render as m


# ─── Hilfen ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def flyer(tmp_path_factory) -> Path:
    """Synthetische 4:5-Quelle mit feinen Strukturen (fuer die Schaerfemessung)."""
    path = tmp_path_factory.mktemp("src") / "flyer.png"
    m._run([
        m.ffmpeg_bin(), "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=s=1080x1350",
        "-frames:v", "1", str(path),
    ])
    return path


def _graph(flyer: Path, tmp: Path, presets, fmt="feed", short_edge=480, duration=4):
    info = m.probe_source(flyer)
    canvas = tmp / f"canvas_{fmt}.png"
    m.build_canvas(flyer, canvas, fmt, info, short_edge=short_edge)
    w, h = m.output_size(fmt, short_edge)
    return m.build_motion_graph(
        canvas, presets=presets, duration=duration, fps=24,
        out_w=w, out_h=h, tmp_dir=tmp,
    )


# ─── Geometrie ────────────────────────────────────────────────────────────────

def test_banner_crop_loss_matches_hand_calculation():
    """
    Aus einer 4:5-Quelle bleiben beim 16:9-Beschnitt nur 45 % der Hoehe.

    Die Zahl steht so in der UI. Wenn sie hier kippt, verspricht die Oberflaeche
    dem Social-Media-Team etwas anderes, als der Renderer liefert.
    """
    loss = m.banner_crop_loss(m.SourceInfo(width=1080, height=1350))
    assert loss == pytest.approx(0.55, abs=0.01)


def test_output_sizes_are_even():
    """yuv420p braucht gerade Kantenlaengen — sonst bricht libx264 ab."""
    for fmt in m.ALL_FORMATS:
        for edge in (480, 720, 1080):
            w, h = m.output_size(fmt, edge)
            assert w % 2 == 0 and h % 2 == 0, f"{fmt}@{edge} → {w}x{h}"


# ─── Die Messung selbst ───────────────────────────────────────────────────────

def test_probe_selection_actually_filters(flyer):
    """
    Der Kanarienvogel fuer alle anderen Tests.

    `select` im Messgraphen ist einmal still ausgefallen: mit escapten UND
    gequoteten Kommas laesst ffmpeg alle Frames durch, meldet aber keinen
    Fehler, und `-frames:v N` schneidet die ersten N ab. Die Nahtmessung
    verglich dadurch Frame 0 mit Frame 1 statt mit Frame N-1 und lieferte
    plausible, aber wertlose Zahlen.

    Ohne diesen Test kann jeder folgende Test gruen sein, ohne etwas zu pruefen.
    """
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        graph = _graph(flyer, tmp, ("atem",))
        first = m.render_probe_frames(graph, tmp, [0])[0].read_bytes()
        peak = m.render_probe_frames(graph, tmp, [graph.total_frames // 2])[0].read_bytes()
        assert first != peak, "select filtert nicht — alle Nahtwerte wären wertlos"


# ─── Naht ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("presets", [
    ("atem",),
    ("licht",),
    ("atem", "licht"),
])
def test_periodic_presets_loop_exactly(flyer, presets):
    """
    Cosinus-periodische Presets muessen bit-genau schliessen, nicht nur „fast".

    Zwei Fehler haben das frueher gebrochen, beide unsichtbar in der Formel:
      * Zoom exakt 1,0 umgeht das Resampling → Frame 0 war der einzige
        unbehandelte Frame im Clip.
      * `eq` ueberspringt sich bei neutralen Parametern → Frame 0 war der
        einzige Frame ohne Lichtkurve.
    Beide Male war die Mathematik korrekt und die Schleife trotzdem sichtbar
    kaputt.
    """
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        graph = _graph(flyer, tmp, presets)
        seam = m.measure_seam(graph, tmp)
        assert seam["seam"] < m.SEAM_ABSOLUTE_FLOOR, (
            f"Naht {seam['seam']:.5f} bei {presets} — Schleife knackt"
        )


@pytest.mark.parametrize("presets", [("pushin",), ("atem", "staub")])
def test_non_periodic_presets_stay_under_seam_limit(flyer, presets):
    """
    `pushin` (linear, per Ueberblendung geschlossen) und `staub` erreichen keine
    bit-genaue Naht. Sie muessen aber unter dem Grenzwert bleiben — der Sprung
    darf nicht groesser sein als ein normaler Bewegungsschritt.
    """
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        graph = _graph(flyer, tmp, presets)
        seam = m.measure_seam(graph, tmp)
        assert seam["ratio"] <= m.SEAM_RATIO_LIMIT, (
            f"Naht {seam['ratio']:.2f}× schlechter als ein normaler Schritt bei {presets}"
        )


def test_dust_covers_the_full_frame_after_scrolling(flyer):
    """
    Der Staubstreifen muss Bild UND Scrollweg abdecken.

    Mit nur drei gestapelten Kacheln blieb nach einem Scroll um eine volle
    Kachelhoehe unten ein Streifen ohne Staub — die Naht war dadurch 7×
    schlechter als die Bildmitte. Vier Kacheln decken beides ab.
    """
    out_h = 900
    tile_h = m._dust_tile_height(out_h)
    assert tile_h * 4 >= out_h + tile_h, "Stapel deckt Bild + Scrollweg nicht ab"


# ─── Schaerfe ─────────────────────────────────────────────────────────────────

def test_typography_does_not_get_soft(flyer):
    """
    Die Hochfrequenzenergie darf ueber die Laufzeit nicht einbrechen.

    Das ist das Sicherheitsnetz fuer den eigentlichen Zweck: Schrift auf dem
    Flyer muss scharf bleiben. Faellt der Wert, hat das Hochskalieren die
    Typografie gekostet — sichtbar wird das erst auf dem Handy, wenn das Video
    schon veroeffentlicht ist.
    """
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        graph = _graph(flyer, tmp, ("atem", "licht"))
        sharp = m.measure_text_sharpness_drift(graph, tmp)
        assert sharp["retained"] > 0.75, (
            f"Schärfe auf {sharp['retained'] * 100:.0f} % gefallen"
        )


# ─── Quellpruefung ────────────────────────────────────────────────────────────

def test_truncated_jpeg_is_rejected(tmp_path):
    """
    Abgeschnittene Progressive-JPEGs muessen als Fehler zurueckkommen.

    WhatsApp legt im Cache Dateien ab, deren Header 1080x1350 meldet, die aber
    nur 16 KB gross sind und nur die ersten Scans enthalten — mit farbigem
    Muellstreifen am rechten Rand. Ohne diese Pruefung rendert die App daraus
    klaglos ein kaputtes Video.
    """
    whole = tmp_path / "whole.jpg"
    m._run([
        m.ffmpeg_bin(), "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=s=1080x1350",
        "-frames:v", "1", str(whole),
    ])
    data = whole.read_bytes()
    truncated = tmp_path / "truncated.jpg"
    truncated.write_bytes(data[: len(data) // 4])

    with pytest.raises(m.MotionError) as exc:
        m.probe_source(truncated)
    assert "unvollständig" in exc.value.message or "nicht gelesen" in exc.value.message

    # Eine intakte Datei darf NICHT abgewiesen werden — sonst ist die Pruefung
    # nur ein Generalverdacht.
    assert m.probe_source(whole).width == 1080


@pytest.mark.skipif(
    not (Path.home() / "Movies/Berg-des-Herrn-Loop/src/_whatsapp_partial.jpg").is_file(),
    reason="echte WhatsApp-Teildatei nicht vorhanden",
)
def test_real_whatsapp_partial_is_rejected():
    """
    Der Fall aus der Praxis: 1080x1350 laut Header, 16 KB gross.

    Diese Datei lief zuerst klaglos durch die Pruefung. Grund: die Erkennung
    suchte nach ImageMagicks `Premature end of JPEG file`, ffmpeg meldet
    denselben Defekt aber als `EOI missing, emulating` und `component 0 is
    incomplete`. Der Test haelt genau diese Verwechslung fest.
    """
    partial = Path.home() / "Movies/Berg-des-Herrn-Loop/src/_whatsapp_partial.jpg"
    with pytest.raises(m.MotionError, match="unvollständig"):
        m.probe_source(partial)


def test_tiny_source_is_rejected(tmp_path):
    """Eine WhatsApp-Vorschau ergibt kein brauchbares Video."""
    small = tmp_path / "small.png"
    m._run([
        m.ffmpeg_bin(), "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=s=200x250",
        "-frames:v", "1", str(small),
    ])
    with pytest.raises(m.MotionError, match="zu klein"):
        m.probe_source(small)


# ─── Eingabepruefung ──────────────────────────────────────────────────────────

def test_request_validation_clamps_and_defaults():
    req = m.RenderRequest(
        presets=("unsinn",), formats=("feed", "quatsch"),
        duration=999, short_edge=99999, banner_offset=5.0,
    ).validated()
    assert req.presets == m.DEFAULT_PRESETS   # unbekannte Presets → Default
    assert req.formats == ("feed",)           # unbekanntes Format faellt raus
    assert req.duration == m.MAX_DURATION
    assert req.short_edge == m.MAX_SHORT_EDGE
    assert req.banner_offset == 1.0


def test_request_without_valid_format_is_rejected():
    with pytest.raises(m.MotionError, match="mindestens ein Format"):
        m.RenderRequest(formats=("quatsch",)).validated()


# ─── Encodierte Ausgabe ───────────────────────────────────────────────────────

def test_rendered_file_is_playable_h264(flyer, tmp_path):
    """Die fertige Datei muss H.264/yuv420p sein — sonst spielt sie auf dem
    iPhone nicht ab."""
    req = m.RenderRequest(
        presets=("atem",), formats=("feed",), duration=3, short_edge=480,
    )
    clips = m.render_all(flyer, tmp_path, req)
    out = subprocess.run(
        [m.ffprobe_bin(), "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name,pix_fmt,width,height",
         "-of", "default=nokey=1:noprint_wrappers=1", str(clips[0].path)],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    assert out[0] == "h264"
    assert out[3] == "yuv420p"
