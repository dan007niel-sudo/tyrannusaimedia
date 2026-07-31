import base64
import json
import unittest
from email.message import Message
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import server


def data_uri(mime_type: str, payload: bytes) -> str:
    encoded = base64.b64encode(payload).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


class UploadValidationTests(unittest.TestCase):
    def test_accepts_supported_image_under_limit(self):
        mime_type, raw = server.validate_uploaded_image(data_uri("image/png", b"ok"), 5)

        self.assertEqual(mime_type, "image/png")
        self.assertEqual(raw, b"ok")

    def test_rejects_unsupported_image_type_with_structured_error(self):
        with self.assertRaises(HTTPException) as raised:
            server.validate_uploaded_image(data_uri("image/gif", b"gif"), 1024)

        detail = json.loads(raised.exception.detail)
        self.assertEqual(raised.exception.status_code, 415)
        self.assertEqual(detail["errorType"], "UPLOAD_INVALID")
        self.assertFalse(detail["retryable"])

    def test_rejects_oversized_image_with_structured_error(self):
        with self.assertRaises(HTTPException) as raised:
            server.validate_uploaded_image(data_uri("image/jpeg", b"123456"), 5)

        detail = json.loads(raised.exception.detail)
        self.assertEqual(raised.exception.status_code, 413)
        self.assertEqual(detail["errorType"], "UPLOAD_TOO_LARGE")
        self.assertFalse(detail["retryable"])

    def test_rejects_malformed_data_uri(self):
        with self.assertRaises(ValueError):
            server.parse_data_uri("not-an-image")


class SaveImageReferenceGuardTests(unittest.TestCase):
    def setUp(self):
        self.original_supabase_url = server.SUPABASE_URL
        server.SUPABASE_URL = "https://example.supabase.co"

    def tearDown(self):
        server.SUPABASE_URL = self.original_supabase_url

    def test_rejects_non_uuid_project_id_before_storage_write(self):
        with self.assertRaises(ValueError):
            server.validate_save_image_reference_request(server.SaveImagesRequest(
                projectId="not-a-uuid",
                images={"feed": "https://example.supabase.co/storage/v1/object/public/generated-images/a.png"},
                aspectRatios={"feed": "3:4"},
            ))

    def test_rejects_non_https_image_reference(self):
        with self.assertRaises(ValueError):
            server.validate_save_image_reference_request(server.SaveImagesRequest(
                projectId="12345678-1234-5678-1234-567812345678",
                images={"feed": "http://example.supabase.co/image.png"},
                aspectRatios={"feed": "3:4"},
            ))

    def test_rejects_other_supabase_storage_bucket(self):
        with self.assertRaises(ValueError):
            server.validate_save_image_reference_request(server.SaveImagesRequest(
                projectId="12345678-1234-5678-1234-567812345678",
                images={"feed": "https://example.supabase.co/storage/v1/object/public/other/a.png"},
                aspectRatios={"feed": "3:4"},
            ))

    def test_rejects_lookalike_supabase_hostname(self):
        with self.assertRaises(ValueError):
            server.validate_save_image_reference_request(server.SaveImagesRequest(
                projectId="12345678-1234-5678-1234-567812345678",
                images={"feed": "https://example.supabase.co.evil.test/image.png"},
                aspectRatios={"feed": "3:4"},
            ))

    def test_rejects_unknown_aspect_ratio(self):
        with self.assertRaises(ValueError):
            server.validate_save_image_reference_request(server.SaveImagesRequest(
                projectId="12345678-1234-5678-1234-567812345678",
                images={"feed": "https://example.supabase.co/storage/v1/object/public/generated-images/a.png"},
                aspectRatios={"feed": "2:3"},
            ))


class HistoryAuthTests(unittest.TestCase):
    def setUp(self):
        self.original_token = server.HISTORY_ADMIN_TOKEN
        self.client = TestClient(server.app)

    def tearDown(self):
        server.HISTORY_ADMIN_TOKEN = self.original_token

    def test_projects_endpoint_rejects_missing_token(self):
        server.HISTORY_ADMIN_TOKEN = "secret"

        response = self.client.get("/api/projects")

        self.assertEqual(response.status_code, 401)

    def test_projects_endpoint_rejects_wrong_token(self):
        server.HISTORY_ADMIN_TOKEN = "secret"

        response = self.client.get("/api/projects", headers={"X-History-Token": "wrong"})

        self.assertEqual(response.status_code, 401)

    def test_projects_endpoint_accepts_correct_token(self):
        server.HISTORY_ADMIN_TOKEN = "secret"
        original_client = server.supabase_client
        server.supabase_client = None
        try:
            response = self.client.get("/api/projects", headers={"X-History-Token": "secret"})
        finally:
            server.supabase_client = original_client

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_save_images_endpoint_requires_history_token(self):
        server.HISTORY_ADMIN_TOKEN = "secret"

        response = self.client.post("/api/save-images", json={
            "projectId": "12345678-1234-5678-1234-567812345678",
            "images": {},
        })

        self.assertEqual(response.status_code, 401)


class ImageDownloadTests(unittest.TestCase):
    def setUp(self):
        self.original_supabase_url = server.SUPABASE_URL
        server.SUPABASE_URL = "https://example.supabase.co"
        self.client = TestClient(server.app)

    def tearDown(self):
        server.SUPABASE_URL = self.original_supabase_url

    def test_download_returns_real_attachment_with_safe_filename(self):
        headers = Message()
        headers["Content-Type"] = "image/png"

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return b"png-bytes"

        fake_response = FakeResponse()
        fake_response.headers = headers
        image_url = (
            "https://example.supabase.co/storage/v1/object/public/"
            "generated-images/abc.png"
        )

        with patch("server.urlopen", return_value=fake_response):
            response = self.client.get(
                "/api/download-image",
                params={"url": image_url, "filename": "../../Tyrannus Flyer.png"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"png-bytes")
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertEqual(
            response.headers["content-disposition"],
            'attachment; filename="Tyrannus-Flyer.png"',
        )
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_download_rejects_external_url_before_network_request(self):
        with patch("server.urlopen") as mocked_urlopen:
            response = self.client.get(
                "/api/download-image",
                params={
                    "url": "https://evil.test/image.png",
                    "filename": "flyer.png",
                },
            )

        self.assertEqual(response.status_code, 400)
        mocked_urlopen.assert_not_called()

    def test_embedded_download_returns_attachment(self):
        image_data = data_uri("image/webp", b"webp-bytes")
        response = self.client.post(
            "/api/download-embedded-image",
            params={"filename": "Story Export.png"},
            content=f"image_data={image_data}\r\n".encode("ascii"),
            headers={"Content-Type": "text/plain"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"webp-bytes")
        self.assertEqual(response.headers["content-type"], "image/webp")
        self.assertEqual(
            response.headers["content-disposition"],
            'attachment; filename="Story-Export.webp"',
        )
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_embedded_download_rejects_non_image_payload(self):
        image_data = data_uri("text/html", b"<script>alert(1)</script>")
        response = self.client.post(
            "/api/download-embedded-image",
            params={"filename": "unsafe.html"},
            content=f"image_data={image_data}\r\n".encode("ascii"),
            headers={"Content-Type": "text/plain"},
        )

        self.assertEqual(response.status_code, 415)

    def test_download_filename_covers_every_served_mime(self):
        """
        Jeder MIME-Typ, den die App zum Download anbietet, braucht hier einen
        Eintrag — sonst wirft der Endpunkt einen KeyError und liefert 500.

        Genau das ist passiert, als die Bewegtbild-Funktion dazukam: die
        Tabelle kannte nur Bildformate, und `video/mp4` liess den Download
        kommentarlos in einen Serverfehler laufen. Der Test haelt die Tabelle
        und die tatsaechlich ausgelieferten Typen zusammen.
        """
        served = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "video/mp4": ".mp4",
        }
        for mime, extension in served.items():
            with self.subTest(mime=mime):
                name = server.safe_download_filename("Tyrannus Export", mime)
                self.assertTrue(name.endswith(extension), name)
                self.assertTrue(name.isascii(), name)


if __name__ == "__main__":
    unittest.main()
