/**
 * QLearningAgent - Local Reinforcement Learning Agent for Adaptive Learning.
 *
 * Implements tabular Q-learning with:
 * - Deterministic discrete state encoder
 * - Configurable educational action space
 * - Epsilon-greedy action selection
 * - Grounded reward function
 * - SQLite backend persistence with local fallback
 *
 * Bellman update rule:
 * Q(s, a) = Q(s, a) + α * [r + γ * max_a'(Q(s', a')) - Q(s, a)]
 */

export const Q_ACTIONS = {
  INCREASE_DIFFICULTY: "increase_difficulty",
  MAINTAIN_DIFFICULTY: "maintain_difficulty",
  DECREASE_DIFFICULTY: "decrease_difficulty",
  REINFORCE_WEAK_CONCEPT: "reinforce_weak_concept",
  // Backward compatibility aliases
  EXPLAIN: "reinforce_weak_concept",
  REVIEW: "reinforce_weak_concept",
};

export const ACTION_LIST = [
  Q_ACTIONS.INCREASE_DIFFICULTY,
  Q_ACTIONS.MAINTAIN_DIFFICULTY,
  Q_ACTIONS.DECREASE_DIFFICULTY,
  Q_ACTIONS.REINFORCE_WEAK_CONCEPT,
];

export const DEFAULT_HYPERPARAMETERS = {
  learningRate: 0.15, // α: rate of value adjustment
  discountFactor: 0.85, // γ: value of future expected rewards
  epsilon: 0.15, // ε: exploration probability in ε-greedy
  baseUrl: "http://localhost:3001",
};

export class QLearningAgent {
  constructor(config = {}) {
    this.learningRate =
      typeof config.learningRate === "number"
        ? config.learningRate
        : DEFAULT_HYPERPARAMETERS.learningRate;
    this.discountFactor =
      typeof config.discountFactor === "number"
        ? config.discountFactor
        : DEFAULT_HYPERPARAMETERS.discountFactor;
    this.epsilon =
      typeof config.epsilon === "number"
        ? config.epsilon
        : DEFAULT_HYPERPARAMETERS.epsilon;
    this.baseUrl = config.baseUrl || DEFAULT_HYPERPARAMETERS.baseUrl;

    // In-memory Q-Table: { [stateKey: string]: { [action: string]: number } }
    this.qTable = {};
    this.isLoaded = false;
    this.lastTelemetry = {
      state: "init",
      action: "none",
      reward: 0,
      qValue: 0,
      epsilon: this.epsilon,
      dktActive: false,
      timestamp: new Date().toISOString(),
    };

    // Auto-load persisted Q-table
    this.loadQTable();
  }

  /**
   * Encodes student state into a discrete, deterministic string representation.
   * Features:
   * 1. Difficulty: "beginner" | "intermediate" | "advanced"
   * 2. Predicted Mastery (via Phase 1 DKT model or safe accuracy fallback):
   *    "high_mastery" (>= 0.70) | "med_mastery" (0.45 - 0.69) | "low_mastery" (< 0.45) | "prior_mastery"
   * 3. Recent Performance: "correct" | "incorrect" | "none"
   * 4. Struggle Trend: "low" | "med" | "high" (consecutive incorrect answers)
   *
   * State format: `${difficulty}:${masteryTier}:${recentResult}:${struggleTier}`
   *
   * @param {Object} studentState
   * @param {Object} [evaluation]
   * @returns {string}
   */
  encodeState(studentState = {}, evaluation = null) {
    const difficulty =
      studentState.currentDifficulty || studentState.difficulty || "beginner";

    // 1. Mastery Tier: Try Phase 1 Deep Knowledge Tracing (DKT) first
    let masteryTier = "prior_mastery";
    const dkt = studentState.dktMastery;

    if (
      dkt &&
      !dkt.is_cold_start &&
      typeof dkt.average_mastery === "number" &&
      !Number.isNaN(dkt.average_mastery)
    ) {
      const avg = dkt.average_mastery;
      if (avg >= 0.70) masteryTier = "high_mastery";
      else if (avg >= 0.45) masteryTier = "med_mastery";
      else masteryTier = "low_mastery";
    } else {
      // Safe Fallback: Derive mastery tier from historical accuracy
      const answered = studentState.questionsAnswered || 0;
      const accuracy =
        answered === 0
          ? 0
          : studentState.accuracy !== undefined
            ? studentState.accuracy
            : Math.round(((studentState.correctAnswers || 0) / answered) * 100);

      if (answered > 0) {
        if (accuracy >= 75) masteryTier = "high_mastery";
        else if (accuracy >= 50) masteryTier = "med_mastery";
        else masteryTier = "low_mastery";
      } else {
        masteryTier = "prior_mastery";
      }
    }

    // 2. Recent Result
    let recentResult = "none";
    if (evaluation && typeof evaluation.isCorrect === "boolean") {
      recentResult = evaluation.isCorrect ? "correct" : "incorrect";
    } else if (
      Array.isArray(studentState.recentAttempts) &&
      studentState.recentAttempts.length > 0
    ) {
      recentResult = studentState.recentAttempts[0].isCorrect
        ? "correct"
        : "incorrect";
    }

    // 3. Struggle Tier (consecutive incorrect answers)
    let consecutiveIncorrect = 0;
    if (Array.isArray(studentState.recentAttempts)) {
      for (const attempt of studentState.recentAttempts) {
        if (!attempt.isCorrect) consecutiveIncorrect += 1;
        else break;
      }
    }
    if (
      evaluation &&
      evaluation.isCorrect === false &&
      recentResult === "incorrect"
    ) {
      consecutiveIncorrect = Math.max(1, consecutiveIncorrect);
    }

    let struggleTier = "low";
    if (consecutiveIncorrect >= 2) struggleTier = "high";
    else if (consecutiveIncorrect === 1) struggleTier = "med";

    return `${difficulty}:${masteryTier}:${recentResult}:${struggleTier}`;
  }

  /**
   * Helper to decompose state key into descriptive parts for UI presentation.
   *
   * @param {string} stateKey
   * @returns {{ difficulty: string, masteryTier: string, recentResult: string, struggleTier: string }}
   */
  parseState(stateKey = "") {
    const parts = (stateKey || "beginner:prior_mastery:none:low").split(":");
    return {
      difficulty: parts[0] || "beginner",
      masteryTier: parts[1] || "prior_mastery",
      recentResult: parts[2] || "none",
      struggleTier: parts[3] || "low",
    };
  }

  /**
   * Initializes default Q-values (0.0) for unseen state.
   *
   * @param {string} stateKey
   */
  ensureStateInitialized(stateKey) {
    if (!this.qTable[stateKey]) {
      this.qTable[stateKey] = {};
      for (const action of ACTION_LIST) {
        this.qTable[stateKey][action] = 0.0;
      }
    }
  }

  /**
   * Returns the Q-value for a given state-action pair.
   *
   * @param {string} stateKey
   * @param {string} action
   * @returns {number}
   */
  getQValue(stateKey, action) {
    this.ensureStateInitialized(stateKey);
    return this.qTable[stateKey][action] ?? 0.0;
  }

  /**
   * Returns all Q-values for a given state.
   *
   * @param {string} stateKey
   * @returns {Object}
   */
  getQValuesForState(stateKey) {
    this.ensureStateInitialized(stateKey);
    return { ...this.qTable[stateKey] };
  }

  /**
   * Finds max_a' Q(state', a') for the next state.
   *
   * @param {string} nextStateKey
   * @returns {number}
   */
  getMaxQ(nextStateKey) {
    this.ensureStateInitialized(nextStateKey);
    const values = Object.values(this.qTable[nextStateKey]);
    return values.length > 0 ? Math.max(...values) : 0.0;
  }

  /**
   * Selects an action using ε-greedy strategy.
   *
   * @param {string} stateKey
   * @param {boolean} [explore=true] - Whether to allow exploration
   * @returns {{ action: string, isExploration: boolean, qValue: number }}
   */
  selectAction(stateKey, explore = true) {
    this.ensureStateInitialized(stateKey);

    const isExploration = explore && Math.random() < this.epsilon;

    if (isExploration) {
      const randomIndex = Math.floor(Math.random() * ACTION_LIST.length);
      const action = ACTION_LIST[randomIndex];
      const qValue = this.getQValue(stateKey, action);

      return {
        action,
        isExploration: true,
        qValue,
      };
    }

    // Exploitation: Pick action with highest Q-value
    const stateActions = this.qTable[stateKey];
    let bestAction = ACTION_LIST[0];
    let maxQ = -Infinity;

    for (const action of ACTION_LIST) {
      const qVal = stateActions[action] ?? 0.0;
      if (qVal > maxQ) {
        maxQ = qVal;
        bestAction = action;
      }
    }

    return {
      action: bestAction,
      isExploration: false,
      qValue: maxQ === -Infinity ? 0.0 : maxQ,
    };
  }

  /**
   * Calculates the pedagogical reward function based on educational outcome and policy alignment.
   *
   * Reward Design:
   * 1. Direct Outcome:
   *    - Correct response: +3.0
   *    - Incorrect response: -3.0
   * 2. Mastery & Learning Dynamics:
   *    - High mastery demonstrated (>= 0.70): +2.0
   *    - Repeated struggle (>= 2 misses): -2.5 penalty
   *    - DKT Mastery delta (M_t+1 - M_t): +4.0 * deltaM (when available)
   * 3. Pedagogical Action Alignment:
   *    - Action INCREASE_DIFFICULTY:
   *        * When student demonstrated high mastery: +2.5
   *        * When student is struggling (low mastery or repeated miss): -4.0 (penalize cognitive overload)
   *    - Action DECREASE_DIFFICULTY:
   *        * When student is struggling: +2.5 (reward cognitive relief)
   *        * When student has high mastery: -2.0 (penalize regression)
   *    - Action REINFORCE_WEAK_CONCEPT:
   *        * When student missed a question or has weak concept: +3.0 (reward targeted remediation)
   *        * When student subsequently answers correctly on reinforced concept: +1.5
   *    - Action MAINTAIN_DIFFICULTY:
   *        * In moderate mastery zone (0.45 - 0.70): +2.0 (reward ZPD consolidation)
   *
   * @param {Object} studentState
   * @param {Object} evaluation - { isCorrect: boolean }
   * @param {string} selectedAction
   * @param {number} [masteryDelta=0]
   * @returns {number}
   */
  calculateReward(
    studentState = {},
    evaluation = {},
    selectedAction = "",
    masteryDelta = 0,
  ) {
    const isCorrect = Boolean(evaluation.isCorrect);
    let reward = 0;

    // 1. Direct Outcome
    reward += isCorrect ? 3.0 : -3.0;

    // 2. Mastery & Struggle Analysis
    const dkt = studentState.dktMastery;
    const avgMastery = dkt?.average_mastery ?? (studentState.accuracy ? studentState.accuracy / 100 : 0.5);
    const isHighMastery = avgMastery >= 0.70;
    const isLowMastery = avgMastery < 0.45;

    const recentAttempts = studentState.recentAttempts || [];
    const consecutiveMisses = recentAttempts.filter((a) => !a.isCorrect).length;
    const isStruggling = consecutiveMisses >= 2 || (!isCorrect && isLowMastery);

    if (isHighMastery) {
      reward += 2.0;
    }
    if (isStruggling) {
      reward -= 2.5;
    }

    // Dynamic DKT Mastery gain reward
    if (typeof masteryDelta === "number" && !Number.isNaN(masteryDelta)) {
      reward += Math.max(-2.0, Math.min(4.0, masteryDelta * 4.0));
    }

    // 3. Action-to-State Alignment
    switch (selectedAction) {
      case Q_ACTIONS.INCREASE_DIFFICULTY:
        if (isCorrect && isHighMastery) {
          reward += 2.5; // Timely difficulty scaling
        } else if (isStruggling) {
          reward -= 4.0; // Inappropriate cognitive overload
        }
        break;

      case Q_ACTIONS.DECREASE_DIFFICULTY:
        if (isStruggling) {
          reward += 2.5; // Appropriate cognitive load relief
        } else if (isHighMastery && isCorrect) {
          reward -= 2.0; // Unnecessary challenge reduction
        }
        break;

      case Q_ACTIONS.REINFORCE_WEAK_CONCEPT:
        if (!isCorrect || isStruggling || studentState.weakTopic) {
          reward += 3.0; // Targeted remediation of conceptual weakness
        }
        if (isCorrect) {
          reward += 1.5; // Successfully mastered reinforced concept
        }
        break;

      case Q_ACTIONS.MAINTAIN_DIFFICULTY:
      default:
        if (!isHighMastery && !isLowMastery) {
          reward += 2.0; // Zone of Proximal Development consolidation
        }
        break;
    }

    return Math.round(reward * 100) / 100;
  }

  /**
   * Updates the Q-value using Bellman Equation and persists the update.
   *
   * Q(s, a) = Q(s, a) + α * [r + γ * max_a'(Q(s', a')) - Q(s, a)]
   *
   * @param {string} stateKey - Current state
   * @param {string} action - Action executed
   * @param {number} reward - Calculated reward
   * @param {string} nextStateKey - Subsequent state
   * @returns {Promise<{ qValue: number, priorQ: number, delta: number }>}
   */
  async updateQValue(stateKey, action, reward, nextStateKey) {
    this.ensureStateInitialized(stateKey);
    this.ensureStateInitialized(nextStateKey);

    const priorQ = this.getQValue(stateKey, action);
    const maxNextQ = this.getMaxQ(nextStateKey);

    const target = reward + this.discountFactor * maxNextQ;
    const delta = this.learningRate * (target - priorQ);
    const newQ = Math.round((priorQ + delta) * 10000) / 10000;

    this.qTable[stateKey][action] = newQ;

    // Update telemetry
    this.lastTelemetry = {
      state: stateKey,
      action,
      reward,
      qValue: newQ,
      epsilon: this.epsilon,
      timestamp: new Date().toISOString(),
    };

    // Asynchronously persist to SQLite
    this.persistQValue(stateKey, action, newQ).catch((err) => {
      console.warn("QLearningAgent: Async Q-table sync notice:", err.message);
    });

    return {
      qValue: newQ,
      priorQ,
      delta,
    };
  }

  /**
   * Asynchronously saves an updated Q-value to the backend SQLite table.
   *
   * @param {string} stateKey
   * @param {string} action
   * @param {number} qValue
   */
  async persistQValue(stateKey, action, qValue) {
    try {
      const response = await fetch(`${this.baseUrl}/api/qlearning/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stateKey,
          action,
          qValue,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      // Fallback to local storage if available in browser context
      if (typeof window !== "undefined" && window.localStorage) {
        try {
          const cacheKey = `ql_${stateKey}_${action}`;
          window.localStorage.setItem(cacheKey, String(qValue));
        } catch {
          // ignore localstorage errors
        }
      }
    }
  }

  /**
   * Loads the full Q-table from the backend SQLite store.
   *
   * @returns {Promise<boolean>}
   */
  async loadQTable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/qlearning/table`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.table && typeof data.table === "object") {
          for (const [sKey, actions] of Object.entries(data.table)) {
            this.ensureStateInitialized(sKey);
            for (const [aKey, val] of Object.entries(actions)) {
              this.qTable[sKey][aKey] = Number(val);
            }
          }
          this.isLoaded = true;
          return true;
        }
      }
    } catch (error) {
      console.info("QLearningAgent: Starting with initialized in-memory Q-table.");
    }
    return false;
  }

  /**
   * Retrieves the latest learning telemetry for presentation/UI display.
   */
  getTelemetry() {
    return { ...this.lastTelemetry };
  }
}

export const qLearningAgent = new QLearningAgent();
export default qLearningAgent;
