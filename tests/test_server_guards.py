import base64
import json
import unittest
from email.message import Message
from unittest.mock import AsyncMock, MagicMock, patch

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

    def test_accepts_feed_four_five(self):
        """4:5 ist seit dem 10.09.2026 das Feed-Format (Modell-Migration).

        Die Allowlist ist die einzige Stelle, an der ein Format lautlos
        verschwinden kann: faellt 4:5 heraus, generiert die App weiter, aber
        das Speichern der Bildreferenz scheitert — und zwar erst beim Nutzer.
        Alle anderen Tests hier pruefen Ablehnung; dieser prueft Annahme.
        """
        server.validate_save_image_reference_request(server.SaveImagesRequest(
            projectId="12345678-1234-5678-1234-567812345678",
            images={"feed": "https://example.supabase.co/storage/v1/object/public/generated-images/a.png"},
            aspectRatios={"feed": "4:5"},
        ))


class BillingResilienceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.original_uncertain = server.credit_estimate_uncertain
        self.original_runtime_confirmation = server.credit_estimate_confirmed_this_process

    def tearDown(self):
        server.credit_estimate_uncertain = self.original_uncertain
        server.credit_estimate_confirmed_this_process = self.original_runtime_confirmation

    def test_payment_required_wins_over_resource_exhausted(self):
        error = Exception("402 RESOURCE_EXHAUSTED: Your prepayment credits are depleted")

        classified = server.classify_gemini_error(error)
        detail = json.loads(classified.detail)

        self.assertEqual(classified.status_code, 402)
        self.assertEqual(detail["errorType"], "BILLING_REQUIRED")
        self.assertFalse(detail["retryable"])
        self.assertIn("Guthaben", detail["message"])

    def test_plain_resource_exhausted_remains_retryable_rate_limit(self):
        classified = server.classify_gemini_error(Exception("429 RESOURCE_EXHAUSTED quota per minute"))
        detail = json.loads(classified.detail)

        self.assertEqual(classified.status_code, 429)
        self.assertEqual(detail["errorType"], "RATE_LIMITED")
        self.assertTrue(detail["retryable"])

    def test_brainstorm_returns_non_retryable_402_without_real_provider_call(self):
        class ProviderPaymentError(Exception):
            status_code = 402

        fake_client = MagicMock()
        fake_client.aio.models.generate_content = AsyncMock(
            side_effect=ProviderPaymentError("RESOURCE_EXHAUSTED")
        )
        with patch.object(server, "client", fake_client), \
             patch.object(server, "reserve_credit_usage") as reserve, \
             patch.object(server, "mark_credit_provider_result") as mark_result:
            response = self.client.post("/api/brainstorm", json={
                "verse": "Römer 12,2",
                "theme": "Erneuerung",
                "userVision": "",
                "styleMode": "classic",
                "referenceImage": None,
            })

        self.assertEqual(response.status_code, 402)
        detail = json.loads(response.json()["detail"])
        self.assertEqual(detail["errorType"], "BILLING_REQUIRED")
        self.assertFalse(detail["retryable"])
        reserve.assert_called_once_with("brainstorm")
        mark_result.assert_called_once()
        self.assertFalse(mark_result.call_args.args[0])

    def test_public_credit_status_is_honestly_unknown_without_persistence(self):
        with patch.object(server, "supabase_client", None):
            response = self.client.get("/api/credit-status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "unknown")
        self.assertIsNone(response.json()["estimatedReserveUsd"])
        self.assertIn("andere Apps", response.json()["caveat"])

    def test_restart_hides_persisted_numeric_estimate_until_admin_reconfirms(self):
        fake_supabase = MagicMock()
        fake_supabase.rpc.return_value.execute.return_value = MagicMock(data={
            "state": "estimated", "estimatedReserveUsd": 19.0,
            "warningThresholdUsd": 5.0, "lastConfirmedAt": "2026-10-07T12:00:00Z",
            "staleAfterHours": 72, "reason": None,
        })
        server.credit_estimate_confirmed_this_process = False
        with patch.object(server, "supabase_client", fake_supabase):
            status = server.get_credit_estimate(expose_amounts=True)

        self.assertEqual(status["state"], "unknown")
        self.assertEqual(status["reason"], "requires_runtime_confirmation")
        self.assertIsNone(status["estimatedReserveUsd"])

    def test_public_credit_status_never_exposes_balance_amounts(self):
        fake_supabase = MagicMock()
        fake_supabase.rpc.return_value.execute.return_value = MagicMock(data={
            "state": "warning", "estimatedReserveUsd": 2.0,
            "warningThresholdUsd": 5.0, "lastConfirmedAt": "2026-10-07T12:00:00Z",
            "staleAfterHours": 72, "reason": None,
        })
        server.credit_estimate_confirmed_this_process = True
        with patch.object(server, "supabase_client", fake_supabase):
            response = self.client.get("/api/credit-status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "warning")
        self.assertIsNone(response.json()["estimatedReserveUsd"])
        self.assertIsNone(response.json()["warningThresholdUsd"])
        self.assertIsNone(response.json()["lastConfirmedAt"])

    def test_all_image_billing_failures_return_402(self):
        with patch.object(
            server, "_generate_single_image",
            new=AsyncMock(side_effect=Exception("402 prepayment credits are depleted")),
        ), patch.object(server, "supabase_client", None), patch.object(server, "client", MagicMock()):
            response = self.client.post("/api/generate-images", json={
                "metaphorPrompt": "visual",
                "imageSize": "1K",
                "requests": [{"key": "feed", "ratio": "4:5"}],
            })

        self.assertEqual(response.status_code, 402)
        detail = json.loads(response.json()["detail"])
        self.assertEqual(detail["errorType"], "BILLING_REQUIRED")
        self.assertFalse(detail["retryable"])

    def test_partial_image_billing_failure_keeps_success_and_detail(self):
        async def generate(_prompt, _size, ratio, _style, _reference):
            if ratio == "9:16":
                raise Exception("402 prepayment credits are depleted")
            return data_uri("image/png", b"successful-image")

        with patch.object(server, "_generate_single_image", new=generate), \
             patch.object(server, "supabase_client", None), \
             patch.object(server, "client", MagicMock()):
            response = self.client.post("/api/generate-images", json={
                "metaphorPrompt": "visual",
                "imageSize": "1K",
                "requests": [
                    {"key": "feed", "ratio": "4:5"},
                    {"key": "story", "ratio": "9:16"},
                ],
            })

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["images"]["feed"].startswith("data:image/png"))
        self.assertIsNone(body["images"]["story"])
        self.assertEqual(body["errors"]["story"]["errorType"], "BILLING_REQUIRED")
        self.assertFalse(body["errors"]["story"]["retryable"])

    def test_admin_credit_update_uses_token_and_atomic_rpc(self):
        fake_supabase = MagicMock()
        confirm_result = MagicMock(data=None)
        estimate_result = MagicMock(data={
            "state": "estimated", "estimatedReserveUsd": 19.0,
            "warningThresholdUsd": 5.0, "lastConfirmedAt": "2026-10-07T12:00:00Z",
            "staleAfterHours": 72, "reason": None,
        })
        fake_supabase.rpc.return_value.execute.side_effect = [confirm_result, estimate_result]
        payload = {
            "confirmedBalanceUsd": 20,
            "warningThresholdUsd": 5,
            "brainstormAllowanceUsd": 0.01,
            "image1kAllowanceUsd": 0.10,
            "image2kAllowanceUsd": 0.15,
            "image4kAllowanceUsd": 0.20,
            "editAllowanceUsd": 0.15,
            "staleAfterHours": 72,
        }
        with patch.object(server, "HISTORY_ADMIN_TOKEN", "secret"), \
             patch.object(server, "supabase_client", fake_supabase):
            rejected = self.client.put("/api/admin/credit-estimate", json=payload)
            accepted = self.client.put(
                "/api/admin/credit-estimate", json=payload,
                headers={"X-History-Token": "secret"},
            )

        self.assertEqual(rejected.status_code, 401)
        self.assertEqual(accepted.status_code, 200)
        self.assertTrue(accepted.json()["saved"])
        self.assertEqual(accepted.json()["status"]["estimatedReserveUsd"], 19.0)
        first_rpc = fake_supabase.rpc.call_args_list[0]
        self.assertEqual(first_rpc.args[0], "confirm_credit_estimate")

    def test_credit_reservation_and_settlement_use_durable_event_id(self):
        fake_supabase = MagicMock()
        fake_supabase.rpc.return_value.execute.return_value = MagicMock(
            data={"reservationId": "12345678-1234-5678-1234-567812345678"}
        )
        with patch.object(server, "supabase_client", fake_supabase):
            reservation_id = server.reserve_credit_usage("image", "2K")
            server.finish_credit_usage(reservation_id, "uncertain")

        self.assertEqual(reservation_id, "12345678-1234-5678-1234-567812345678")
        self.assertEqual(fake_supabase.rpc.call_args_list[0].args[0], "reserve_credit_usage")
        self.assertEqual(fake_supabase.rpc.call_args_list[1].args[0], "finish_credit_usage")

    def test_admin_confirmation_rejects_inflight_provider_calls(self):
        fake_supabase = MagicMock()
        fake_supabase.rpc.return_value.execute.side_effect = Exception("credit_calls_in_flight")
        payload = {
            "confirmedBalanceUsd": 20, "warningThresholdUsd": 5,
            "brainstormAllowanceUsd": 0.01, "image1kAllowanceUsd": 0.10,
            "image2kAllowanceUsd": 0.15, "image4kAllowanceUsd": 0.20,
            "editAllowanceUsd": 0.15, "staleAfterHours": 72,
        }
        with patch.object(server, "HISTORY_ADMIN_TOKEN", "secret"), \
             patch.object(server, "supabase_client", fake_supabase):
            response = self.client.put(
                "/api/admin/credit-estimate", json=payload,
                headers={"X-History-Token": "secret"},
            )

        self.assertEqual(response.status_code, 409)
        detail = json.loads(response.json()["detail"])
        self.assertTrue(detail["retryable"])
        self.assertIn("KI-Anfragen", detail["message"])


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
