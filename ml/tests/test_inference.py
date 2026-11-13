"""
Unit Tests for DKTInference Interface.
"""

import unittest
from pathlib import Path
import json

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from ml.config import CANONICAL_CONCEPTS, NUM_CONCEPTS
from ml.inference import DKTInference


class TestDKTInference(unittest.TestCase):
    def setUp(self):
        self.engine = DKTInference.get_instance()

    def test_cold_start_prediction(self):
        result = self.engine.predict([], next_concept="A* Search & Heuristics")
        self.assertTrue(result["is_cold_start"])
        self.assertEqual(result["num_attempts_traced"], 0)
        self.assertIn("A* Search & Heuristics", result["topic_mastery"])
        self.assertAlmostEqual(result["predicted_next_prob"], 0.50, delta=0.01)

    def test_sequence_prediction(self):
        interactions = [
            {"concept": "Supervised Learning", "is_correct": True},
            {"concept": "Supervised Learning", "is_correct": True},
            {"concept": "Neural Networks", "is_correct": False},
        ]
        result = self.engine.predict(interactions, next_concept="Supervised Learning")
        
        self.assertFalse(result["is_cold_start"])
        self.assertEqual(result["num_attempts_traced"], 3)
        self.assertTrue(0.0 <= result["predicted_next_prob"] <= 1.0)
        self.assertEqual(len(result["topic_mastery"]), NUM_CONCEPTS)
        for concept in CANONICAL_CONCEPTS:
            self.assertIn(concept, result["topic_mastery"])
            self.assertTrue(0.0 <= result["topic_mastery"][concept] <= 1.0)

    def test_concept_resolution(self):
        # Fuzzy and exact matching
        c_id1 = self.engine.resolve_concept_id("A* Search & Heuristics")
        self.assertEqual(c_id1, 0)
        c_id2 = self.engine.resolve_concept_id("neural network backpropagation")
        self.assertIsInstance(c_id2, int)


if __name__ == "__main__":
    unittest.main()
