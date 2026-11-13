"""
Unit Tests for DKTNet PyTorch Model Architecture.
"""

import unittest
from pathlib import Path
import torch

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from ml.config import NUM_CONCEPTS, MODEL_CONFIG
from ml.model import DKTNet


class TestDKTNet(unittest.TestCase):
    def setUp(self):
        self.num_concepts = NUM_CONCEPTS
        self.model = DKTNet(
            num_concepts=self.num_concepts,
            embed_dim=MODEL_CONFIG["embed_dim"],
            hidden_dim=MODEL_CONFIG["hidden_dim"],
            num_layers=MODEL_CONFIG["num_layers"],
            dropout=0.0,
        )

    def test_forward_pass_dimensions(self):
        batch_size = 4
        seq_len = 10
        # interaction tokens in [0, 2 * num_concepts]
        dummy_inputs = torch.randint(0, 2 * self.num_concepts, (batch_size, seq_len))
        
        probs, (hn, cn) = self.model(dummy_inputs)
        
        self.assertEqual(probs.shape, (batch_size, seq_len, self.num_concepts))
        self.assertTrue(torch.all(probs >= 0.0) and torch.all(probs <= 1.0))
        self.assertEqual(hn.shape, (1, batch_size, MODEL_CONFIG["hidden_dim"]))

    def test_single_interaction(self):
        input_token = torch.tensor([[5]], dtype=torch.long)
        probs, _ = self.model(input_token)
        self.assertEqual(probs.shape, (1, 1, self.num_concepts))

    def test_interaction_id_helper(self):
        # concept 3 incorrect (0) -> 3
        self.assertEqual(self.model.get_interaction_id(3, False), 3)
        # concept 3 correct (1) -> 3 + 20 = 23
        self.assertEqual(self.model.get_interaction_id(3, True), 3 + self.num_concepts)


if __name__ == "__main__":
    unittest.main()
