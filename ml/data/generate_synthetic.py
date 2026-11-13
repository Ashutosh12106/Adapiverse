"""
Synthetic Educational Dataset Generator for Deep Knowledge Tracing (DKT).

CRITICAL NOTICE & DISCLAIMER:
This module generates synthetically simulated student quiz response sequences based on
item response theory (IRT) and educational learning curves.
It is used exclusively for DKT model architecture validation, pre-training, and calibration
when the live SQLite database has sparse real attempts.
THESE SYNTHETIC RESULTS ARE CLEARLY SEPARATED AND ARE NEVER PRESENTED AS REAL STUDENT RESULTS.
"""

import json
import random
import math
from pathlib import Path
import numpy as np

# Import concept mappings
import sys
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from ml.config import (
    CANONICAL_CONCEPTS,
    CONCEPT_TO_ID,
    SYNTHETIC_DATA_DIR,
    TRAINING_CONFIG,
)

# Concept difficulty calibration (difficulty parameter b_c in IRT)
# Higher value = more challenging concept
CONCEPT_DIFFICULTIES = {
    "A* Search & Heuristics": 0.80,
    "Search Algorithms": 0.20,
    "Turing Test": -0.60,
    "Intelligent Agents": -0.30,
    "AI Principles": -0.70,
    "Core Fundamentals": -0.80,
    "Supervised Learning": -0.10,
    "Unsupervised Learning": 0.30,
    "Reinforcement Learning": 0.90,
    "Classification & Regression": 0.00,
    "Clustering Algorithms": 0.40,
    "Decision Trees & Ensembles": 0.20,
    "Machine Learning Fundamentals": -0.50,
    "ML Concepts": -0.60,
    "Neural Networks": 0.60,
    "Backpropagation & Optimization": 1.00,
    "Loss Functions": 0.30,
    "Overfitting & Regularization": 0.30,
    "Natural Language Processing": 0.50,
    "Computer Vision": 0.60,
}

# Concept relationships/clusters
CONCEPT_CLUSTERS = {
    "AI_CORE": ["AI Principles", "Core Fundamentals", "Intelligent Agents", "Turing Test"],
    "SEARCH": ["Search Algorithms", "A* Search & Heuristics"],
    "ML_CORE": ["Machine Learning Fundamentals", "ML Concepts", "Supervised Learning", "Unsupervised Learning", "Classification & Regression"],
    "ML_ADVANCED": ["Clustering Algorithms", "Decision Trees & Ensembles", "Reinforcement Learning"],
    "DEEP_LEARNING": ["Neural Networks", "Backpropagation & Optimization", "Loss Functions", "Overfitting & Regularization", "Natural Language Processing", "Computer Vision"],
}


def simulate_student_sequence(student_id: int, rng: random.Random, num_interactions: int = 30):
    """
    Simulates a sequence of quiz questions and answers for a single student.
    Uses an educational state transition model where:
    - Each student has a baseline general ability theta ~ N(0, 0.8)
    - Each student tracks their current knowledge state per concept k_c in [0, 1]
    - Answering questions provides learning updates: k_c <- k_c + lr * (1 - k_c)
    """
    ability = rng.gauss(0.0, 1.2)
    
    # Initial knowledge state per concept
    knowledge = {}
    for concept in CANONICAL_CONCEPTS:
        diff = CONCEPT_DIFFICULTIES.get(concept, 0.3)
        # Prior probability based on student ability vs concept difficulty
        logit = ability - diff + rng.gauss(0, 0.3)
        p_init = 1.0 / (1.0 + math.exp(-logit))
        knowledge[concept] = max(0.05, min(0.95, p_init))

    # Pedagogical curriculum selection:
    # Interactions tend to cluster in topics or follow a curriculum progression
    interactions = []
    
    # Pick a random starting focus
    clusters = list(CONCEPT_CLUSTERS.keys())
    current_cluster_idx = rng.randint(0, len(clusters) - 1)

    for step in range(num_interactions):
        # 70% chance stay in current cluster, 30% pick random cluster
        if rng.random() < 0.30:
            current_cluster_idx = rng.randint(0, len(clusters) - 1)
        
        cluster_name = clusters[current_cluster_idx]
        concept = rng.choice(CONCEPT_CLUSTERS[cluster_name])
        concept_id = CONCEPT_TO_ID[concept]

        # In IRT/BKT, probability of correct response directly reflects latent mastery
        # with realistic slip (s=0.08) and guess (g=0.15) parameters:
        # P(C) = (1 - s) * k + g * (1 - k)
        k = knowledge[concept]
        p_correct = 0.90 * k + 0.15 * (1.0 - k)

        is_correct = 1 if rng.random() < p_correct else 0

        interactions.append({
            "step": step,
            "concept": concept,
            "concept_id": concept_id,
            "is_correct": is_correct,
            "latent_mastery": round(k, 4),
        })

        # Knowledge update (learning gain upon attempt):
        # A correct answer reinforces learning; an incorrect answer with feedback also increases knowledge
        gain = 0.22 if is_correct else 0.12
        knowledge[concept] = min(0.98, knowledge[concept] + gain * (1.0 - knowledge[concept]))

        # Prerequisite knowledge transfer to related concepts in same cluster
        for rel_concept in CONCEPT_CLUSTERS[cluster_name]:
            if rel_concept != concept:
                knowledge[rel_concept] = min(0.96, knowledge[rel_concept] + (gain * 0.35) * (1.0 - knowledge[rel_concept]))

    return {
        "student_id": f"synthetic_student_{student_id:04d}",
        "dataset_type": "SYNTHETIC_EDUCATIONAL_BENCHMARK",
        "num_interactions": len(interactions),
        "interactions": interactions,
    }


def generate_dataset(num_students: int = 1000, seed: int = 42):
    """Generates synthetic educational dataset partitioned by student."""
    rng = random.Random(seed)
    students = []
    for i in range(num_students):
        length = rng.randint(15, 45)
        student = simulate_student_sequence(i + 1, rng, num_interactions=length)
        students.append(student)

    # Train/Test Split (student-level separation)
    split_idx = int(num_students * TRAINING_CONFIG["train_split"])
    train_students = students[:split_idx]
    test_students = students[split_idx:]

    train_path = SYNTHETIC_DATA_DIR / "train_sequences.json"
    test_path = SYNTHETIC_DATA_DIR / "test_sequences.json"
    summary_path = SYNTHETIC_DATA_DIR / "dataset_summary.json"
    readme_path = SYNTHETIC_DATA_DIR / "README.md"

    disclaimer = (
        "CRITICAL NOTICE: This dataset is synthetically generated using Item Response Theory (IRT) "
        "and educational learning curves for Phase 1 DKT model pre-training and hyperparameter calibration. "
        "It is strictly kept separate from real student quiz attempts in the live SQLite database. "
        "Never present synthetic-data results as real student results."
    )

    with open(train_path, "w", encoding="utf-8") as f:
        json.dump({
            "disclaimer": disclaimer,
            "dataset_type": "SYNTHETIC_TRAIN",
            "num_students": len(train_students),
            "total_interactions": sum(s["num_interactions"] for s in train_students),
            "students": train_students,
        }, f, indent=2)

    with open(test_path, "w", encoding="utf-8") as f:
        json.dump({
            "disclaimer": disclaimer,
            "dataset_type": "SYNTHETIC_TEST",
            "num_students": len(test_students),
            "total_interactions": sum(s["num_interactions"] for s in test_students),
            "students": test_students,
        }, f, indent=2)

    summary = {
        "disclaimer": disclaimer,
        "total_students": num_students,
        "train_students": len(train_students),
        "test_students": len(test_students),
        "train_interactions": sum(s["num_interactions"] for s in train_students),
        "test_interactions": sum(s["num_interactions"] for s in test_students),
        "num_concepts": len(CANONICAL_CONCEPTS),
        "concepts": CANONICAL_CONCEPTS,
    }

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(f"""# Synthetic Educational Dataset for Knowledge Tracing (Phase 1)

> **IMPORTANT DISCLAIMER**
> {disclaimer}

## Dataset Architecture
- **Total simulated students:** {num_students}
- **Train partition:** {len(train_students)} students ({sum(s["num_interactions"] for s in train_students):,} interactions)
- **Held-out Test partition:** {len(test_students)} students ({sum(s["num_interactions"] for s in test_students):,} interactions)
- **Concepts covered:** {len(CANONICAL_CONCEPTS)} canonical AI & ML topics
- **Generative Process:** Item Response Theory (2-PL logistic IRT) with pedagogical learning curves, concept clustering, and prerequisite mastery transfer.

## Purpose
Enables robust parameter initialization, sequence encoding calibration, and offline AUC/Accuracy evaluation for the PyTorch LSTM model prior to live student accumulation.
""")

    print(f"Generated {len(train_students)} train students ({summary['train_interactions']} interactions)")
    print(f"Generated {len(test_students)} test students ({summary['test_interactions']} interactions)")
    print(f"Files saved to {SYNTHETIC_DATA_DIR}")
    return summary


if __name__ == "__main__":
    generate_dataset()
