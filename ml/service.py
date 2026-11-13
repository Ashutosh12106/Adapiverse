"""
AdaptiveVerse Deep Knowledge Tracing (DKT) Local Microservice API.

Provides local HTTP endpoints on port 5001 for real-time knowledge tracing:
- GET  /api/dkt/status      - Model metadata, evaluation metrics & synthetic disclaimer
- POST /api/dkt/predict     - Predict next-question correctness probability & topic mastery
- GET  /api/dkt/real-mastery - Computes DKT knowledge tracing on real SQLite attempts
"""

import os
import json
import sqlite3
from pathlib import Path
from flask import Flask, request, jsonify

# Project imports
import sys
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

from ml.config import (
    SERVICE_CONFIG,
    METRICS_SAVE_PATH,
    METADATA_SAVE_PATH,
    CONCEPT_MAP_PATH,
)
from ml.inference import DKTInference

app = Flask(__name__)

# Cache inference engine
engine = DKTInference.get_instance()
DB_PATH = BASE_DIR / "proxy-server" / "data" / "adaptiveverse.db"


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


@app.route("/health", methods=["GET"])
@app.route("/api/dkt/status", methods=["GET"])
def get_status():
    """Returns model health, architecture details, evaluation metrics, and disclaimer."""
    metrics = {}
    if METRICS_SAVE_PATH.exists():
        with open(METRICS_SAVE_PATH, "r", encoding="utf-8") as f:
            metrics = json.load(f)

    metadata = {}
    if METADATA_SAVE_PATH.exists():
        with open(METADATA_SAVE_PATH, "r", encoding="utf-8") as f:
            metadata = json.load(f)

    return jsonify({
        "status": "online",
        "service": "AdaptiveVerse DKT Inference Service",
        "model_name": metadata.get("model_name", "AdaptiveVerse-DKT-LSTM"),
        "hardware": "MacBook Air M1 (Lightweight PyTorch CPU Inference)",
        "parameter_count": metadata.get("parameter_count", 27700),
        "evaluation_metrics": metrics.get("best_epoch_metrics", {}),
        "training_data_info": metadata.get("training_data", {}),
        "synthetic_disclaimer": (
            "Model parameters pre-trained on pedagogical benchmark sequences. "
            "Real student mastery is calculated strictly from live SQLite quiz attempts."
        ),
    })


@app.route("/api/dkt/predict", methods=["POST", "OPTIONS"])
def predict():
    """Predicts next-question correctness probability and estimated topic mastery."""
    if request.method == "OPTIONS":
        return jsonify({"ok": True}), 200

    data = request.get_json(silent=True) or {}
    interactions = data.get("interactions", [])
    next_concept = data.get("next_concept")

    try:
        prediction = engine.predict(interactions, next_concept=next_concept)
        return jsonify({
            "success": True,
            **prediction,
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
        }), 500


@app.route("/api/dkt/real-mastery", methods=["GET"])
def get_real_mastery():
    """
    Reads the real student quiz attempts from the SQLite database,
    traces them through the DKT LSTM model, and returns estimated topic mastery.
    """
    next_concept = request.args.get("next_concept", None)

    if not DB_PATH.exists():
        prediction = engine.predict([], next_concept=next_concept)
        return jsonify({
            "success": True,
            "real_attempts_count": 0,
            **prediction,
        })

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("""
            SELECT id, subject, difficulty, question, is_correct, timestamp
            FROM quiz_attempts
            ORDER BY id ASC
        """)
        rows = c.fetchall()
        conn.close()

        interactions = []
        for r in rows:
            interactions.append({
                "concept": r["question"],
                "is_correct": bool(r["is_correct"]),
                "difficulty": r["difficulty"],
                "subject": r["subject"],
            })

        prediction = engine.predict(interactions, next_concept=next_concept)
        return jsonify({
            "success": True,
            "real_attempts_count": len(interactions),
            **prediction,
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to compute real student mastery: {str(e)}",
        }), 500


if __name__ == "__main__":
    host = SERVICE_CONFIG["host"]
    port = SERVICE_CONFIG["port"]
    print(f"Starting AdaptiveVerse DKT Service on http://{host}:{port} ...")
    app.run(host=host, port=port, debug=False)
