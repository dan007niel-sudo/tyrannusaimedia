"""
Smoke-Tests fuer die Bewegtbild-Endpunkte.

Der Renderer selbst ist in test_motion_render.py abgedeckt. Hier geht es um die
Torwaechter: Auth, Demo-Sperre, Ueberlastschutz, Eingabepruefung und darum, dass
kein Nutzerstring in einen Dateipfad geraet. Diese Tests rendern absichtlich
nichts — sie duerfen schnell sein.
"""

import base64
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import server


def png_data_uri() -> str:
    """Kleinstes gueltiges PNG, reicht fuer die MIME-Pruefung."""
    raw = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    return "data:image/png;base64," + base64.b64encode(raw).decode()


def detail_of(response) -> dict:
    """Die App verpackt strukturierte Fehler als JSON-String in `detail`."""
    body = response.json()
    return json.loads(body["detail"])


class MotionEndpointGuards(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        server._motion_jobs.clear()
        self.addCleanup(server._motion_jobs.clear)

    # ─── Demo-Modus ──────────────────────────────────────────────────────────

    def test_demo_mode_is_rejected_before_any_work(self):
        """
        Die Besucher-Vorschau darf keine Rechenzeit verbrennen. Auf 0,1 CPU ist
        das kein Schoenheitsfehler, sondern der Unterschied zwischen einer
        bedienbaren und einer stehenden App.
        """
        response = self.client.post(
            "/api/motion/jobs",
            json={"image": png_data_uri()},
            headers={"X-Demo-Mode": "1"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(detail_of(response)["errorType"], "DEMO_MODE")
        self.assertEqual(len(server._motion_jobs), 0)

    # ─── Ueberlastschutz ─────────────────────────────────────────────────────

    def test_too_many_active_jobs_returns_429(self):
        for i in range(server.MOTION_MAX_ACTIVE_JOBS):
            server._motion_jobs[f"job-{i}"] = {
                "id": f"job-{i}", "dir": "/tmp/does-not-exist", "status": "running",
                "progress": {}, "presets": [], "results": [], "error": None,
                "created_at": 0, "finished_at": None, "task": None,
            }
        response = self.client.post("/api/motion/jobs", json={"image": png_data_uri()})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(detail_of(response)["errorType"], "MOTION_BUSY")
        self.assertTrue(detail_of(response)["retryable"])

    def test_oversized_body_is_rejected_before_parsing(self):
        """
        Der Ueberlastschutz muss VOR dem Einlesen greifen. Sonst liegen Rohbody,
        geparster String und dekodierte Bytes gleichzeitig im Speicher — auf
        einer 512-MB-Instanz reichen wenige gleichzeitige Uploads fuer den
        OOM-Kill des einzigen Workers.
        """
        response = self.client.post(
            "/api/motion/jobs",
            content=b"x" * 64,
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(server.MOTION_MAX_BODY_BYTES + 1),
            },
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(detail_of(response)["errorType"], "UPLOAD_TOO_LARGE")

    # ─── Eingabepruefung ─────────────────────────────────────────────────────

    def test_non_image_payload_is_rejected(self):
        response = self.client.post(
            "/api/motion/jobs",
            json={"image": "data:text/html;base64," + base64.b64encode(b"<b>x").decode()},
        )
        self.assertEqual(response.status_code, 415)

    def test_unparseable_body_returns_structured_error(self):
        response = self.client.post(
            "/api/motion/jobs",
            content=b"kein json",
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(detail_of(response)["errorType"], "MOTION_INVALID")

    # ─── Status und Auslieferung ─────────────────────────────────────────────

    def test_unknown_job_returns_structured_404(self):
        response = self.client.get("/api/motion/jobs/gibt-es-nicht")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(detail_of(response)["errorType"], "MOTION_JOB_GONE")

    def test_video_rejects_unknown_format_before_touching_the_filesystem(self):
        """
        `format` landet im Dateipfad. Der Wert muss gegen die Enum geprueft
        werden, bevor er dort ankommt — sonst waere das ein Pfad-Traversal.
        """
        server._motion_jobs["j1"] = {
            "id": "j1", "dir": "/tmp/does-not-exist", "status": "done",
            "progress": {}, "presets": [], "results": [], "error": None,
            "created_at": 0, "finished_at": 0, "task": None,
        }
        for bad in ("../../etc/passwd", "feed/../../../etc/passwd", "unbekannt"):
            with self.subTest(format=bad):
                response = self.client.get("/api/motion/jobs/j1/video", params={"format": bad})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(detail_of(response)["errorType"], "MOTION_INVALID")

    def test_video_reports_pending_when_file_not_written_yet(self):
        server._motion_jobs["j2"] = {
            "id": "j2", "dir": "/tmp/does-not-exist", "status": "running",
            "progress": {}, "presets": [], "results": [], "error": None,
            "created_at": 0, "finished_at": None, "task": None,
        }
        response = self.client.get("/api/motion/jobs/j2/video", params={"format": "feed"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(detail_of(response)["errorType"], "MOTION_PENDING")

    # ─── Aufraeumen ──────────────────────────────────────────────────────────

    def test_cleanup_never_touches_running_or_queued_jobs(self):
        """
        Der wichtigste Test dieser Datei.

        Wuerde nach `created_at` aufgeraeumt, risse man einem laufenden Job das
        Arbeitsverzeichnis unter den Fuessen weg: ffmpeg liefe weiter und
        verbrauchte die einzige CPU, der Client bekaeme ab da 404. Bei
        Semaphore(1) und 0,1 CPU kann ein Job laenger warten als die TTL lang
        ist — der Fall ist also der Normalfall, nicht die Ausnahme.
        """
        uralt = 0  # 1970, also weit jenseits jeder TTL
        for status in ("queued", "running", "done", "failed"):
            server._motion_jobs[status] = {
                "id": status, "dir": "/tmp/does-not-exist", "status": status,
                "progress": {}, "presets": [], "results": [], "error": None,
                "created_at": uralt, "finished_at": uralt, "task": None,
            }

        server._motion_cleanup_expired()

        self.assertIn("queued", server._motion_jobs)
        self.assertIn("running", server._motion_jobs)
        self.assertNotIn("done", server._motion_jobs)
        self.assertNotIn("failed", server._motion_jobs)

    def test_cleanup_measures_ttl_from_completion_not_creation(self):
        """Ein gerade fertig gewordener Job bleibt abrufbar, auch wenn er
        lange in der Warteschlange stand."""
        import time
        server._motion_jobs["frisch"] = {
            "id": "frisch", "dir": "/tmp/does-not-exist", "status": "done",
            "progress": {}, "presets": [], "results": [], "error": None,
            "created_at": 0, "finished_at": time.time(), "task": None,
        }
        server._motion_cleanup_expired()
        self.assertIn("frisch", server._motion_jobs)

    # ─── Auth ────────────────────────────────────────────────────────────────

    def test_bench_requires_admin_token(self):
        """
        `/api/motion/bench` rendert zwei Clips und blockiert dabei die einzige
        Renderschleife. Ohne Token waere das ein offener Hebel, um die Instanz
        lahmzulegen.
        """
        with patch.object(server, "HISTORY_ADMIN_TOKEN", "geheim"):
            self.assertEqual(self.client.get("/api/motion/bench").status_code, 401)
            self.assertEqual(
                self.client.get(
                    "/api/motion/bench", headers={"X-History-Token": "falsch"},
                ).status_code,
                401,
            )

    # ─── Verfuegbarkeit ──────────────────────────────────────────────────────

    def test_health_reports_motion_availability(self):
        body = self.client.get("/api/health").json()
        self.assertIn("motion_available", body)

    def test_missing_ffmpeg_is_reported_as_unavailable_not_as_crash(self):
        with patch.object(server, "motion_available", return_value=False):
            response = self.client.post("/api/motion/jobs", json={"image": png_data_uri()})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(detail_of(response)["errorType"], "MOTION_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
