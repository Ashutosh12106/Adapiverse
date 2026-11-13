"""
Inference Interface for AdaptiveVerse Deep Knowledge Tracing (DKT).

Provides a simple, high-performance interface to predict:
1. The probability that a student will answer the next question correctly.
2. Estimated topic mastery across all 20 canonical curriculum concepts.
"""

import os
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional, Union
import torch

# Project imports
import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
from ml.config import (
    CANONICAL_CONCEPTS,
    CONCEPT_TO_ID,
    ID_TO_CONCEPT,
    NUM_CONCEPTS,
    MODEL_SAVE_PATH,
    CONCEPT_MAP_PATH,
    METADATA_SAVE_PATH,
)
from ml.model import DKTNet


class DKTInference:
    """
    Lightweight inference wrapper for DKTNet.
    Runs on CPU with minimal memory footprint (< 10 MB total).
    """
    _instance = None

    def __init__(self, model_path: Path = MODEL_SAVE_PATH):
        self.device = torch.device("cpu")
        self.model_path = Path(model_path)
        self.model = None
        self.concept_to_id = CONCEPT_TO_ID
        self.id_to_concept = ID_TO_CONCEPT
        self.num_concepts = NUM_CONCEPTS
        self._load_model()

    @classmethod
    def get_instance(cls, model_path: Path = MODEL_SAVE_PATH):
        if cls._instance is None:
            cls._instance = cls(model_path)
        return cls._instance

    def _load_model(self):
        """Loads model weights from checkpoint into eval mode."""
        if not self.model_path.exists():
            raise FileNotFoundError(
                f"DKT model checkpoint not found at {self.model_path}. "
                "Please run `python ml/train.py` first."
            )

        checkpoint = torch.load(self.model_path, map_location=self.device, weights_only=False)
        model_config = checkpoint.get("model_config", {})
        
        self.model = DKTNet(
            num_concepts=checkpoint.get("num_concepts", self.num_concepts),
            embed_dim=model_config.get("embed_dim", 32),
            hidden_dim=model_config.get("hidden_dim", 64),
            num_layers=model_config.get("num_layers", 1),
            dropout=0.0,
        ).to(self.device)

        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

    def resolve_concept_id(self, concept_name_or_id: Union[str, int]) -> int:
        """Resolves fuzzy concept strings or IDs into canonical concept ID [0, C-1]."""
        if isinstance(concept_name_or_id, int):
            return max(0, min(concept_name_or_id, self.num_concepts - 1))

        if not concept_name_or_id or not isinstance(concept_name_or_id, str):
            return 0

        # Exact match
        if concept_name_or_id in self.concept_to_id:
            return self.concept_to_id[concept_name_or_id]

        c_lower = concept_name_or_id.lower()
        for c_name, c_id in self.concept_to_id.items():
            if c_lower in c_name.lower() or c_name.lower() in c_lower:
                return c_id

        # Fallback keywords
        if "heuristic" in c_lower or "a*" in c_lower:
            return self.concept_to_id.get("A* Search & Heuristics", 0)
        if "reinforce" in c_lower or "q-learning" in c_lower or "rl" in c_lower:
            return self.concept_to_id.get("Reinforcement Learning", 8)
        if "neural" in c_lower or "deep" in c_lower:
            return self.concept_to_id.get("Neural Networks", 14)
        if "backprop" in c_lower or "gradient" in c_lower:
            return self.concept_to_id.get("Backpropagation & Optimization", 15)
        if "tree" in c_lower or "forest" in c_lower:
            return self.concept_to_id.get("Decision Trees & Ensembles", 11)
        if "cluster" in c_lower:
            return self.concept_to_id.get("Clustering Algorithms", 10)
        if "vision" in c_lower or "cnn" in c_lower:
            return self.concept_to_id.get("Computer Vision", 19)
        if "nlp" in c_lower or "language" in c_lower:
            return self.concept_to_id.get("Natural Language Processing", 18)
        if "supervised" in c_lower:
            return self.concept_to_id.get("Supervised Learning", 6)

        return 0

    def predict(
        self,
        interactions: List[Dict[str, Any]],
        next_concept: Optional[Union[str, int]] = None,
    ) -> Dict[str, Any]:
        """
        Runs DKT inference on a student interaction sequence.

        Args:
            interactions: List of dicts, each with keys:
                - concept / concept_id / topic / question
                - is_correct (bool or 0/1)
            next_concept: Optional upcoming concept to predict probability for.

        Returns:
            Dict containing:
                - predicted_next_prob: float (0.0 to 1.0)
                - topic_mastery: Dict[concept_name, float]
                - strongest_concept: str
                - weakest_concept: str
                - average_mastery: float
                - num_attempts_traced: int
                - is_cold_start: bool
        """
        valid_tokens = []
        for it in interactions:
            concept_key = it.get("concept") or it.get("topic") or it.get("question") or it.get("concept_id")
            c_id = self.resolve_concept_id(concept_key)
            is_corr = bool(it.get("is_correct", False) or it.get("isCorrect", False))
            token = c_id + (self.num_concepts if is_corr else 0)
            valid_tokens.append(token)

        # Baseline / cold start handling
        if len(valid_tokens) == 0:
            default_mastery = {}
            for c_id, c_name in self.id_to_concept.items():
                default_mastery[c_name] = 0.50

            target_c_id = self.resolve_concept_id(next_concept) if next_concept else 0
            target_c_name = self.id_to_concept.get(target_c_id, CANONICAL_CONCEPTS[0])

            return {
                "predicted_next_prob": 0.50,
                "target_concept": target_c_name,
                "target_concept_id": target_c_id,
                "topic_mastery": default_mastery,
                "average_mastery": 0.50,
                "strongest_concept": CANONICAL_CONCEPTS[0],
                "weakest_concept": CANONICAL_CONCEPTS[0],
                "num_attempts_traced": 0,
                "is_cold_start": True,
                "note": "Awaiting student quiz attempts; baseline prior active.",
            }

        input_tensor = torch.tensor([valid_tokens], dtype=torch.long, device=self.device)

        with torch.no_grad():
            probs, _ = self.model(input_tensor)  # (1, seq_len, num_concepts)
            last_step_probs = probs[0, -1].cpu().numpy()  # (num_concepts,)

        topic_mastery = {}
        for c_id in range(self.num_concepts):
            c_name = self.id_to_concept.get(c_id, f"Concept_{c_id}")
            topic_mastery[c_name] = round(float(last_step_probs[c_id]), 4)

        target_c_id = self.resolve_concept_id(next_concept) if next_concept else None
        if target_c_id is not None:
            pred_next = round(float(last_step_probs[target_c_id]), 4)
            target_name = self.id_to_concept.get(target_c_id, "Unknown")
        else:
            # Default to average mastery if no specific next concept specified
            pred_next = round(float(last_step_probs.mean()), 4)
            target_name = "Overall / General"

        sorted_topics = sorted(topic_mastery.items(), key=lambda item: item[1], reverse=True)
        strongest = sorted_topics[0][0]
        weakest = sorted_topics[-1][0]
        avg_mastery = round(float(last_step_probs.mean()), 4)

        return {
            "predicted_next_prob": pred_next,
            "target_concept": target_name,
            "target_concept_id": target_c_id,
            "topic_mastery": topic_mastery,
            "average_mastery": avg_mastery,
            "strongest_concept": strongest,
            "weakest_concept": weakest,
            "num_attempts_traced": len(valid_tokens),
            "is_cold_start": False,
        }


def main():
    """CLI support for testing or IPC execution."""
    parser = argparse.ArgumentParser(description="AdaptiveVerse DKT Inference")
    parser.add_argument("--json", type=str, help="JSON string with interactions and next_concept")
    parser.add_argument("--test", action="store_true", help="Run a quick built-in test inference")
    args = parser.parse_args()

    engine = DKTInference.get_instance()

    if args.test:
        sample_interactions = [
            {"concept": "Machine Learning Fundamentals", "is_correct": 1},
            {"concept": "Supervised Learning", "is_correct": 1},
            {"concept": "Decision Trees & Ensembles", "is_correct": 1},
            {"concept": "A* Search & Heuristics", "is_correct": 0},
            {"concept": "Reinforcement Learning", "is_correct": 0},
        ]
        result = engine.predict(sample_interactions, next_concept="A* Search & Heuristics")
        print(json.dumps(result, indent=2))
        return

    if args.json:
        data = json.loads(args.json)
        interactions = data.get("interactions", [])
        next_concept = data.get("next_concept")
        result = engine.predict(interactions, next_concept)
        print(json.dumps(result))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
