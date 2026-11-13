"""
Model Evaluation and Metrics Reporting for AdaptiveVerse DKT.
Loads the trained checkpoint, runs evaluation on the held-out test dataset,
and prints a detailed performance report.
"""

import json
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader
from sklearn.metrics import (
    roc_auc_score,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    log_loss,
)

# Project imports
import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
from ml.config import (
    NUM_CONCEPTS,
    MODEL_CONFIG,
    SYNTHETIC_DATA_DIR,
    MODEL_SAVE_PATH,
    CONCEPT_MAP_PATH,
    METRICS_SAVE_PATH,
)
from ml.model import DKTNet
from ml.train import DKTSequenceDataset, collate_dkt_batch


def run_evaluation(model_path=MODEL_SAVE_PATH, test_data_path=None):
    """Evaluates trained model on held-out test data and prints comprehensive metrics."""
    if test_data_path is None:
        test_data_path = SYNTHETIC_DATA_DIR / "test_sequences.json"

    if not model_path.exists():
        raise FileNotFoundError(f"Model checkpoint not found at {model_path}. Please run train.py first.")

    device = torch.device("cpu")
    checkpoint = torch.load(model_path, map_location=device, weights_only=False)

    model = DKTNet(
        num_concepts=checkpoint.get("num_concepts", NUM_CONCEPTS),
        embed_dim=checkpoint.get("model_config", {}).get("embed_dim", 32),
        hidden_dim=checkpoint.get("model_config", {}).get("hidden_dim", 64),
        num_layers=checkpoint.get("model_config", {}).get("num_layers", 1),
        dropout=0.0,
    ).to(device)

    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    test_dataset = DKTSequenceDataset(test_data_path, NUM_CONCEPTS)
    padding_token = 2 * NUM_CONCEPTS
    test_loader = DataLoader(
        test_dataset,
        batch_size=32,
        shuffle=False,
        collate_fn=lambda b: collate_dkt_batch(b, padding_token),
    )

    all_preds = []
    all_targets = []
    concept_preds = {i: [] for i in range(NUM_CONCEPTS)}
    concept_targets = {i: [] for i in range(NUM_CONCEPTS)}

    with torch.no_grad():
        for batch in test_loader:
            inputs = batch["inputs"].to(device)
            target_concepts = batch["target_concepts"].to(device)
            target_correctness = batch["target_correctness"].to(device)
            mask = batch["mask"].to(device)

            probs, _ = model(inputs)
            pred_for_target = torch.gather(probs, 2, target_concepts.unsqueeze(2)).squeeze(2)

            batch_mask = mask.cpu().numpy()
            batch_preds = pred_for_target.cpu().numpy()
            batch_targets = target_correctness.cpu().numpy()
            batch_concepts = target_concepts.cpu().numpy()

            for b in range(inputs.size(0)):
                for t in range(inputs.size(1)):
                    if batch_mask[b, t]:
                        p = float(batch_preds[b, t])
                        y = float(batch_targets[b, t])
                        c = int(batch_concepts[b, t])
                        all_preds.append(p)
                        all_targets.append(y)
                        concept_preds[c].append(p)
                        concept_targets[c].append(y)

    y_true = np.array(all_targets)
    y_pred = np.array(all_preds)
    y_pred_bin = (y_pred >= 0.5).astype(int)

    auc = roc_auc_score(y_true, y_pred)
    acc = accuracy_score(y_true, y_pred_bin)
    prec = precision_score(y_true, y_pred_bin, zero_division=0)
    rec = recall_score(y_true, y_pred_bin, zero_division=0)
    f1 = f1_score(y_true, y_pred_bin, zero_division=0)
    bce = log_loss(y_true, y_pred)
    cm = confusion_matrix(y_true, y_pred_bin)

    report = {
        "model_path": str(model_path),
        "total_test_interactions": len(all_targets),
        "num_test_students": len(test_dataset),
        "metrics": {
            "roc_auc": round(float(auc), 4),
            "accuracy": round(float(acc), 4),
            "precision": round(float(prec), 4),
            "recall": round(float(rec), 4),
            "f1_score": round(float(f1), 4),
            "bce_loss": round(float(bce), 4),
        },
        "confusion_matrix": {
            "true_negatives": int(cm[0, 0]) if cm.shape == (2, 2) else 0,
            "false_positives": int(cm[0, 1]) if cm.shape == (2, 2) else 0,
            "false_negatives": int(cm[1, 0]) if cm.shape == (2, 2) else 0,
            "true_positives": int(cm[1, 1]) if cm.shape == (2, 2) else 0,
        },
    }

    print("\n=======================================================")
    print("   ADAPTIVEVERSE DEEP KNOWLEDGE TRACING (DKT) REPORT   ")
    print("=======================================================")
    print(f"Evaluated Interactions: {report['total_test_interactions']:,} across {report['num_test_students']} students")
    print(f"ROC-AUC:               {report['metrics']['roc_auc']:.4f}")
    print(f"Binary Accuracy:       {report['metrics']['accuracy']:.4f}")
    print(f"Precision:             {report['metrics']['precision']:.4f}")
    print(f"Recall:                {report['metrics']['recall']:.4f}")
    print(f"F1-Score:              {report['metrics']['f1_score']:.4f}")
    print(f"BCE Loss:              {report['metrics']['bce_loss']:.4f}")
    print("Confusion Matrix:")
    print(f"  TN: {report['confusion_matrix']['true_negatives']} | FP: {report['confusion_matrix']['false_positives']}")
    print(f"  FN: {report['confusion_matrix']['false_negatives']} | TP: {report['confusion_matrix']['true_positives']}")
    print("=======================================================\n")

    return report


if __name__ == "__main__":
    run_evaluation()
