import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from main import health, require_service_auth


class ServiceAuthenticationTests(unittest.TestCase):
    def test_bearer_auth_rejects_missing_and_wrong_credentials(self):
        with patch.dict(os.environ, {"AI_SERVICE_TOKEN": "a" * 64}):
            for authorization in (None, "Basic " + "a" * 64, "Bearer " + "b" * 64):
                with self.subTest(authorization=authorization):
                    with self.assertRaises(HTTPException) as raised:
                        require_service_auth(authorization)
                    self.assertEqual(raised.exception.status_code, 401)
            self.assertTrue(require_service_auth("Bearer " + "a" * 64))

    def test_short_token_is_unavailable_not_accepted(self):
        with patch.dict(os.environ, {"AI_SERVICE_TOKEN": "too-short"}):
            with self.assertRaises(HTTPException) as raised:
                require_service_auth("Bearer too-short")
            self.assertEqual(raised.exception.status_code, 503)

    def test_public_health_does_not_expose_service_token(self):
        response = str(health())
        token = os.getenv("AI_SERVICE_TOKEN", "")
        if token:
            self.assertNotIn(token, response)


if __name__ == "__main__":
    unittest.main()
