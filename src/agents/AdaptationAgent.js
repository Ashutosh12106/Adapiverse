import {
  QLearningAgent,
  qLearningAgent,
  Q_ACTIONS,
} from "./QLearningAgent.js";

/**
 * AdaptationAgent - Adaptive pedagogical agent powered by local Reinforcement Learning (Q-Learning).
 *
 * Replaces deterministic difficulty rules with a trained Q-Learning policy that optimizes
 * educational actions (difficulty scaling, conceptual explanations, foundational reviews)
 * based on student state and reward feedback.
 */
export const DIFFICULTY_LEVELS = ["beginner", "intermediate", "advanced"];

/**
 * Generates human-readable explanation strictly derived from Q-learning state, action, and reward.
 */
export function generateAdaptiveDecisionExplanation({
  stateKey,
  action,
  reward,
  currentDifficulty,
  nextDifficulty,
  isCorrect,
  targetTopic,
}) {
  const parts = (stateKey || "beginner:prior_mastery:none:low").split(":");
  const diffTier = parts[0] || currentDifficulty || "beginner";
  const masteryTier = parts[1] || "prior_mastery";
  const recentResult = parts[2] || "none";
  const struggleTier = parts[3] || "low";

  const curFormatted =
    diffTier.charAt(0).toUpperCase() + diffTier.slice(1);
  const nextFormatted =
    (nextDifficulty || diffTier).charAt(0).toUpperCase() +
    (nextDifficulty || diffTier).slice(1);

  const formattedReward =
    (reward ?? 0) >= 0 ? `+${reward ?? 0}` : `${reward}`;

  const wasCorrect =
    typeof isCorrect === "boolean" ? isCorrect : recentResult === "correct";

  switch (action) {
    case Q_ACTIONS.INCREASE_DIFFICULTY:
      if (wasCorrect) {
        if (nextFormatted !== curFormatted) {
          return `Advance to ${nextFormatted} — student demonstrated high mastery (${masteryTier}) and answered correctly (Reward: ${formattedReward}).`;
        }
        return `Maintain Advanced — student is excelling at top challenge tier with consistent mastery (${formattedReward} reward).`;
      }
      return `Explore Higher Challenge — system policy is probing adaptive tolerance at ${nextFormatted} (Reward: ${formattedReward}).`;

    case Q_ACTIONS.DECREASE_DIFFICULTY:
      if (nextFormatted !== curFormatted) {
        return `Decrease to ${nextFormatted} — struggle trend [${struggleTier}] detected, reducing difficulty to relieve cognitive load (Reward: ${formattedReward}).`;
      }
      return `Reinforce Beginner — consolidating core concepts to rebuild confidence (Reward: ${formattedReward}).`;

    case Q_ACTIONS.REINFORCE_WEAK_CONCEPT:
      return targetTopic
        ? `Reinforce Weak Concept — Q-learning policy prioritized targeted practice on "${targetTopic}" (Reward: ${formattedReward}).`
        : `Reinforce Weak Concept — student encountered struggle points, pivoting to foundational reinforcement.`;

    case Q_ACTIONS.MAINTAIN_DIFFICULTY:
    default:
      if (masteryTier === "med_mastery") {
        return `Maintain ${curFormatted} — consolidating mastery within Zone of Proximal Development (Reward: ${formattedReward}).`;
      }
      if (masteryTier === "high_mastery") {
        return `Maintain ${curFormatted} — strong performance observed, consolidating mastery at this level.`;
      }
      if (struggleTier === "high" || struggleTier === "med") {
        return `Maintain ${curFormatted} — student is adjusting to current concepts, maintaining level before scaling.`;
      }
      return `Maintain ${curFormatted} — steady progression, building conceptual consistency at current difficulty.`;
  }
}

export class AdaptationAgent {
  constructor(options = {}) {
    this.difficultyLevels = options.difficultyLevels || DIFFICULTY_LEVELS;
    this.qLearning = options.qLearning || qLearningAgent;
  }

  /**
   * Helper to clamp and shift difficulty levels.
   *
   * @param {string} currentDifficulty
   * @param {number} delta - +1 for increase, -1 for decrease, 0 for maintain
   * @returns {string}
   */
  shiftDifficulty(currentDifficulty, delta) {
    const currentIndex = this.difficultyLevels.indexOf(currentDifficulty);
    const validIndex = currentIndex >= 0 ? currentIndex : 0;
    const targetIndex = Math.min(
      Math.max(validIndex + delta, 0),
      this.difficultyLevels.length - 1,
    );
    return this.difficultyLevels[targetIndex];
  }

  /**
   * Decides the next educational action using the local Q-Learning policy,
   * computes reward feedback, updates the Q-table, and returns the decision.
   *
   * @param {Object} studentState - Centralized student state.
   * @param {Object} evaluation - { isCorrect: boolean, correctAnswer?: string }
   * @returns {Promise<{
   *   nextDifficulty: string,
   *   recommendedSubject: string,
   *   recommendedAction: string,
   *   reason: string,
   *   feedbackMessage: string,
   *   qLearningMeta: Object
   * }>}
   */
  async decideNextStep(studentState = {}, evaluation = {}) {
    const currentDifficulty =
      studentState.currentDifficulty || studentState.difficulty || "beginner";
    const selectedSubject =
      studentState.selectedSubject || "Artificial Intelligence";
    const isCorrect = Boolean(evaluation.isCorrect);
    const correctAnswer = evaluation.correctAnswer || "";

    // 1. Encode current state
    const stateKey = this.qLearning.encodeState(studentState, evaluation);

    // 2. Select action via Q-learning policy (ε-greedy)
    const selection = this.qLearning.selectAction(stateKey, true);
    const action = selection.action;

    // 3. Map Q-learning action to pedagogical application outcome
    let nextDifficulty = currentDifficulty;
    let recommendedAction = "quiz";
    let targetTopic = null;
    let reason = "";
    let feedbackMessage = "";

    // Identify weak concept candidate if remediation is chosen
    const dktWeakest = studentState.dktMastery?.weakest_concept;
    const sqliteWeak =
      studentState.weakTopic &&
      studentState.weakTopic !== "No quiz data yet" &&
      studentState.weakTopic !== "None (High Mastery)"
        ? studentState.weakTopic
        : null;
    const identifiedWeakTopic =
      dktWeakest ||
      sqliteWeak ||
      studentState.weakConcepts?.[0]?.concept ||
      (selectedSubject === "Machine Learning"
        ? "Supervised Learning"
        : "A* Search & Heuristics");

    switch (action) {
      case Q_ACTIONS.INCREASE_DIFFICULTY:
        nextDifficulty = this.shiftDifficulty(currentDifficulty, 1);
        recommendedAction = "quiz";
        reason = `Q-Learning policy selected [${action}] (Q=${selection.qValue.toFixed(4)}) based on state [${stateKey}].`;
        if (isCorrect) {
          feedbackMessage =
            nextDifficulty !== currentDifficulty
              ? `Correct! Q-Learning policy advanced your challenge to ${nextDifficulty}!`
              : "Correct! Outstanding mastery at the advanced level!";
        } else {
          feedbackMessage = `Incorrect. Correct answer: ${correctAnswer}. Q-Learning is testing higher difficulty adaptation.`;
        }
        break;

      case Q_ACTIONS.DECREASE_DIFFICULTY:
        nextDifficulty = this.shiftDifficulty(currentDifficulty, -1);
        recommendedAction = "quiz";
        reason = `Q-Learning policy selected [${action}] (Q=${selection.qValue.toFixed(4)}) to relieve cognitive strain.`;
        if (isCorrect) {
          feedbackMessage = `Correct! Q-Learning consolidated learning at ${nextDifficulty} difficulty.`;
        } else {
          feedbackMessage = `Incorrect. Correct answer: ${correctAnswer}. Q-Learning stepped down difficulty to ${nextDifficulty} for core reinforcement.`;
        }
        break;

      case Q_ACTIONS.REINFORCE_WEAK_CONCEPT: {
        targetTopic = identifiedWeakTopic;
        recommendedAction = "reinforce";
        // Consolidate at current level or step down if student had consecutive misses
        const consecutiveIncorrect = Array.isArray(studentState.recentAttempts)
          ? studentState.recentAttempts.filter((a) => !a.isCorrect).length
          : 0;
        nextDifficulty =
          consecutiveIncorrect >= 2
            ? this.shiftDifficulty(currentDifficulty, -1)
            : currentDifficulty;

        reason = `Q-Learning policy selected [${action}] (Q=${selection.qValue.toFixed(4)}) targeting weak concept "${targetTopic}".`;
        feedbackMessage = isCorrect
          ? `Correct! Great progress on ${targetTopic} — reinforcing this concept to ensure complete mastery.`
          : `Incorrect. Correct answer: ${correctAnswer}. Q-Learning identified "${targetTopic}" as needing reinforcement and will provide targeted practice.`;
        break;
      }

      case Q_ACTIONS.MAINTAIN_DIFFICULTY:
      default:
        nextDifficulty = currentDifficulty;
        recommendedAction = "quiz";
        reason = `Q-Learning policy selected [${action}] (Q=${selection.qValue.toFixed(4)}) to build consistency at current difficulty.`;
        feedbackMessage = isCorrect
          ? `Correct! Reinforcing proficiency at the ${currentDifficulty} level.`
          : `Incorrect. Correct answer: ${correctAnswer}. Let's try another question at ${currentDifficulty} level.`;
        break;
    }

    // 4. Calculate reward with DKT mastery gain awareness
    const currentMastery =
      studentState.dktMastery?.average_mastery ??
      (studentState.accuracy ? studentState.accuracy / 100 : 0.5);
    const priorMastery =
      evaluation.priorMastery !== undefined
        ? evaluation.priorMastery
        : currentMastery - (isCorrect ? 0.05 : -0.05);
    const masteryDelta = Math.round((currentMastery - priorMastery) * 1000) / 1000;

    const reward = this.qLearning.calculateReward(
      studentState,
      evaluation,
      action,
      masteryDelta,
    );

    // 5. Predict next state and perform Bellman Q-value update
    const predictedNextState = {
      ...studentState,
      currentDifficulty: nextDifficulty,
      difficulty: nextDifficulty,
      questionsAnswered: (studentState.questionsAnswered || 0) + 1,
      correctAnswers: (studentState.correctAnswers || 0) + (isCorrect ? 1 : 0),
    };
    const nextStateKey = this.qLearning.encodeState(predictedNextState, null);

    const updateInfo = await this.qLearning.updateQValue(
      stateKey,
      action,
      reward,
      nextStateKey,
    );

    const decisionReason = generateAdaptiveDecisionExplanation({
      stateKey,
      action,
      reward,
      currentDifficulty,
      nextDifficulty,
      isCorrect,
      targetTopic,
    });

    const isDKTActive = Boolean(
      studentState.dktMastery && !studentState.dktMastery.is_cold_start,
    );

    return {
      activeAgent: "Adaptation Agent",
      selectedRLAction: action,
      predictedMastery: currentMastery,
      nextDifficulty,
      targetTopic,
      recommendedSubject: selectedSubject,
      recommendedAction,
      reason: decisionReason,
      feedbackMessage,
      qLearningMeta: {
        mode: "Q-Learning (Phase 3 Loop)",
        state: stateKey,
        stateComponents: this.qLearning.parseState(stateKey),
        action,
        targetTopic,
        isExploration: selection.isExploration,
        reward,
        qValue: updateInfo.qValue,
        priorQ: updateInfo.priorQ,
        delta: updateInfo.delta,
        epsilon: this.qLearning.epsilon,
        learningRate: this.qLearning.learningRate,
        discountFactor: this.qLearning.discountFactor,
        dktActive: isDKTActive,
        reason: decisionReason,
        nextDifficulty,
        currentDifficulty,
        activeAgent: "Adaptation Agent",
        predictedMastery: currentMastery,
      },
    };
  }

  /**
   * Generates a proactive learning recommendation using the Q-learning policy.
   *
   * @param {Object} studentState
   * @returns {Object}
   */
  recommendLearningAction(studentState = {}) {
    const stateKey = this.qLearning.encodeState(studentState);
    const selection = this.qLearning.selectAction(stateKey, false); // greedy exploitation
    const currentDifficulty =
      studentState.currentDifficulty || studentState.difficulty || "beginner";

    let nextDifficulty = currentDifficulty;
    let recommendedAction = "quiz";
    let targetTopic = null;

    if (selection.action === Q_ACTIONS.INCREASE_DIFFICULTY) {
      nextDifficulty = this.shiftDifficulty(currentDifficulty, 1);
    } else if (selection.action === Q_ACTIONS.DECREASE_DIFFICULTY) {
      nextDifficulty = this.shiftDifficulty(currentDifficulty, -1);
    } else if (selection.action === Q_ACTIONS.REINFORCE_WEAK_CONCEPT) {
      targetTopic =
        studentState.dktMastery?.weakest_concept ||
        (studentState.weakTopic && studentState.weakTopic !== "No quiz data yet"
          ? studentState.weakTopic
          : "Core Fundamentals");
      recommendedAction = "reinforce";
    }

    const decisionReason = generateAdaptiveDecisionExplanation({
      stateKey,
      action: selection.action,
      reward: 0,
      currentDifficulty,
      nextDifficulty,
      targetTopic,
    });

    const isDKTActive = Boolean(
      studentState.dktMastery && !studentState.dktMastery.is_cold_start,
    );

    const avgMastery =
      studentState.dktMastery?.average_mastery ??
      (studentState.accuracy ? studentState.accuracy / 100 : 0.5);

    return {
      activeAgent: "Adaptation Agent",
      selectedRLAction: selection.action,
      predictedMastery: avgMastery,
      nextDifficulty,
      targetTopic,
      recommendedSubject:
        studentState.selectedSubject || "Artificial Intelligence",
      recommendedAction,
      reason: decisionReason,
      qLearningMeta: {
        mode: "Q-Learning (Phase 3 Loop)",
        state: stateKey,
        stateComponents: this.qLearning.parseState(stateKey),
        action: selection.action,
        targetTopic,
        qValue: selection.qValue,
        epsilon: this.qLearning.epsilon,
        dktActive: isDKTActive,
        reward: 0,
        reason: decisionReason,
        nextDifficulty,
        currentDifficulty,
        activeAgent: "Adaptation Agent",
        predictedMastery: avgMastery,
      },
    };
  }
}

export default AdaptationAgent;
