"""
Deep Knowledge Tracing (DKT) Neural Network Model in PyTorch.
Implements an LSTM-based knowledge tracing architecture that maps student interaction
sequences (concept_id, correctness) to latent mastery states and predicts the probability
of correct response on future questions.
"""

import torch
import torch.nn as nn


class DKTNet(nn.Module):
    """
    Lightweight LSTM-based Knowledge Tracing Network.
    
    Inputs:
        interaction_ids: Tensor of shape (batch_size, seq_len)
            where interaction_id = concept_id + correctness * num_concepts
            Special padding index: -1 (or handled via mask)
    Outputs:
        predictions: Tensor of shape (batch_size, seq_len, num_concepts)
            representing probability of answering correctly on each concept at the next step.
    """
    def __init__(
        self,
        num_concepts: int = 20,
        embed_dim: int = 32,
        hidden_dim: int = 64,
        num_layers: int = 1,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.num_concepts = num_concepts
        self.embed_dim = embed_dim
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        # Interaction embedding: 2 * num_concepts combinations:
        # 0 to C-1: concept_id answered INCORRECTLY (r=0)
        # C to 2C-1: concept_id answered CORRECTLY (r=1)
        # +1 for padding token (index 2*C)
        self.padding_idx = 2 * num_concepts
        self.embedding = nn.Embedding(
            num_embeddings=2 * num_concepts + 1,
            embedding_dim=embed_dim,
            padding_idx=self.padding_idx,
        )

        self.dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()

        self.lstm = nn.LSTM(
            input_size=embed_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )

        self.fc = nn.Linear(hidden_dim, num_concepts)
        self.sigmoid = nn.Sigmoid()

    def forward(self, interaction_seq, hidden_state=None):
        """
        Forward pass.
        Args:
            interaction_seq: Tensor of shape (batch_size, seq_len) with values in [0, 2*C]
            hidden_state: Optional tuple (h_0, c_0)
        Returns:
            probs: Tensor of shape (batch_size, seq_len, num_concepts)
            hidden_state: Final (h_n, c_n)
        """
        # Embed interactions
        embedded = self.embedding(interaction_seq)  # (batch_size, seq_len, embed_dim)
        embedded = self.dropout(embedded)

        # Run LSTM
        lstm_out, hidden_state = self.lstm(embedded, hidden_state)  # (batch_size, seq_len, hidden_dim)

        # Project to concept probabilities
        logits = self.fc(lstm_out)  # (batch_size, seq_len, num_concepts)
        probs = self.sigmoid(logits)

        return probs, hidden_state

    def get_interaction_id(self, concept_id: int, is_correct: bool) -> int:
        """Helper to convert (concept_id, correctness) into integer interaction token."""
        return int(concept_id) + (self.num_concepts if is_correct else 0)
