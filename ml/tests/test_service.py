"""
Unit and Integration Tests for Flask DKT Microservice API.
"""

import unittest
import json
from pathlib import Path

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from ml.service import app


class TestDKTService(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_status_endpoint(self):
        res = self.client.get("/api/dkt/status")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["status"], "online")
        self.assertIn("parameter_count", data)
        self.assertIn("synthetic_disclaimer", data)

    def test_predict_endpoint(self):
        payload = {
            "interactions": [
                {"concept": "Supervised Learning", "is_correct": True},
                {"concept": "Decision Trees & Ensembles", "is_correct": False},
            ],
            "next_concept": "Classification & Regression",
        }
        res = self.client.post(
            "/api/dkt/predict",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertIn("predicted_next_prob", data)
        self.assertIn("topic_mastery", data)

    def test_real_mastery_endpoint(self):
        res = self.client.get("/api/dkt/real-mastery")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertIn("topic_mastery", data)
        self.assertIn("real_attempts_count", data)


if __name__ == "__main__":
    unittest.main()
