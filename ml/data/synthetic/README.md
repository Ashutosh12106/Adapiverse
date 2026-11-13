# Synthetic Educational Dataset for Knowledge Tracing (Phase 1)

> **IMPORTANT DISCLAIMER**
> CRITICAL NOTICE: This dataset is synthetically generated using Item Response Theory (IRT) and educational learning curves for Phase 1 DKT model pre-training and hyperparameter calibration. It is strictly kept separate from real student quiz attempts in the live SQLite database. Never present synthetic-data results as real student results.

## Dataset Architecture
- **Total simulated students:** 1000
- **Train partition:** 800 students (23,986 interactions)
- **Held-out Test partition:** 200 students (6,065 interactions)
- **Concepts covered:** 20 canonical AI & ML topics
- **Generative Process:** Item Response Theory (2-PL logistic IRT) with pedagogical learning curves, concept clustering, and prerequisite mastery transfer.

## Purpose
Enables robust parameter initialization, sequence encoding calibration, and offline AUC/Accuracy evaluation for the PyTorch LSTM model prior to live student accumulation.
