"""
AdaptiveVerse Deep Knowledge Tracing (DKT) - Configuration & Concept Mappings
Lightweight PyTorch model configuration optimized for local inference on Apple Silicon M1.
"""

import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SYNTHETIC_DATA_DIR = DATA_DIR / "synthetic"
ARTIFACTS_DIR = BASE_DIR / "artifacts"

# Ensure directories exist
SYNTHETIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

MODEL_SAVE_PATH = ARTIFACTS_DIR / "dkt_model.pth"
CONCEPT_MAP_PATH = ARTIFACTS_DIR / "concept_map.json"
METRICS_SAVE_PATH = ARTIFACTS_DIR / "metrics.json"
METADATA_SAVE_PATH = ARTIFACTS_DIR / "metadata.json"

# Canonical Concepts in AdaptiveVerse Curriculum
CANONICAL_CONCEPTS = [
    # Artificial Intelligence Fundamentals & Algorithms
    "A* Search & Heuristics",
    "Search Algorithms",
    "Turing Test",
    "Intelligent Agents",
    "AI Principles",
    "Core Fundamentals",
    
    # Machine Learning Paradigms & Core Techniques
    "Supervised Learning",
    "Unsupervised Learning",
    "Reinforcement Learning",
    "Classification & Regression",
    "Clustering Algorithms",
    "Decision Trees & Ensembles",
    "Machine Learning Fundamentals",
    "ML Concepts",
    
    # Deep Learning & Neural Architectures
    "Neural Networks",
    "Backpropagation & Optimization",
    "Loss Functions",
    "Overfitting & Regularization",
    "Natural Language Processing",
    "Computer Vision",
]

# Concept mappings
CONCEPT_TO_ID = {concept: idx for idx, concept in enumerate(CANONICAL_CONCEPTS)}
ID_TO_CONCEPT = {idx: concept for idx, concept in enumerate(CANONICAL_CONCEPTS)}
NUM_CONCEPTS = len(CANONICAL_CONCEPTS)

# Model Hyperparameters (optimized for M1 MacBook Air / 8GB RAM)
MODEL_CONFIG = {
    "num_concepts": NUM_CONCEPTS,
    "embed_dim": 32,
    "hidden_dim": 64,
    "num_layers": 1,
    "dropout": 0.1,
}

TRAINING_CONFIG = {
    "batch_size": 32,
    "learning_rate": 0.003,
    "epochs": 15,
    "weight_decay": 1e-4,
    "train_split": 0.8,
    "random_seed": 42,
}

# Service Configuration
SERVICE_CONFIG = {
    "host": "127.0.0.1",
    "port": 5001,
}
