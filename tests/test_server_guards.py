import base64
import json
import unittest

from fastapi import HTTPException

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

    def test_rejects_unknown_aspect_ratio(self):
        with self.assertRaises(ValueError):
            server.validate_save_image_reference_request(server.SaveImagesRequest(
                projectId="12345678-1234-5678-1234-567812345678",
                images={"feed": "https://example.supabase.co/storage/v1/object/public/generated-images/a.png"},
                aspectRatios={"feed": "2:3"},
            ))


if __name__ == "__main__":
    unittest.main()
