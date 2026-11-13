/**
 * Unit Tests for Phase 2 Tabular Q-Learning Agent and Adaptation Agent.
 */

import assert from "node:assert";
import { QLearningAgent, Q_ACTIONS, ACTION_LIST } from "../src/agents/QLearningAgent.js";
import { AdaptationAgent } from "../src/agents/AdaptationAgent.js";

function runTests() {
  console.log("Running Q-Learning & RL Personalization Unit Tests...\n");

  // 1. Actions verification
  assert.strictEqual(ACTION_LIST.length, 4, "Action list must contain exactly 4 actions");
  assert.ok(ACTION_LIST.includes(Q_ACTIONS.INCREASE_DIFFICULTY));
  assert.ok(ACTION_LIST.includes(Q_ACTIONS.MAINTAIN_DIFFICULTY));
  assert.ok(ACTION_LIST.includes(Q_ACTIONS.DECREASE_DIFFICULTY));
  assert.ok(ACTION_LIST.includes(Q_ACTIONS.REINFORCE_WEAK_CONCEPT));
  console.log("✓ Test 1: Action space contains 4 core pedagogical actions");

  const agent = new QLearningAgent({ epsilon: 0.0 }); // Pure exploitation for deterministic testing

  // 2. State Encoding with DKT Mastery
  const stateWithDKT = agent.encodeState({
    difficulty: "intermediate",
    questionsAnswered: 5,
    correctAnswers: 4,
    recentAttempts: [{ isCorrect: true }],
    dktMastery: {
      average_mastery: 0.78,
      is_cold_start: false,
    },
  });
  assert.strictEqual(
    stateWithDKT,
    "intermediate:high_mastery:correct:low",
    "DKT mastery >= 0.70 must encode as high_mastery"
  );

  const stateWithLowDKT = agent.encodeState({
    difficulty: "advanced",
    questionsAnswered: 4,
    correctAnswers: 1,
    recentAttempts: [{ isCorrect: false }, { isCorrect: false }],
    dktMastery: {
      average_mastery: 0.32,
      is_cold_start: false,
    },
  });
  assert.strictEqual(
    stateWithLowDKT,
    "advanced:low_mastery:incorrect:high",
    "DKT mastery < 0.45 with 2 misses must encode as low_mastery and struggle tier high"
  );
  console.log("✓ Test 2: State encoder accurately integrates DKT mastery predictions");

  // 3. Safe Fallback when DKT is unavailable or cold start
  const stateColdStart = agent.encodeState({
    difficulty: "beginner",
    questionsAnswered: 0,
    correctAnswers: 0,
    recentAttempts: [],
    dktMastery: {
      is_cold_start: true,
    },
  });
  assert.strictEqual(
    stateColdStart,
    "beginner:prior_mastery:none:low",
    "Cold start must safely fall back to prior_mastery"
  );

  const stateWithoutDKT = agent.encodeState({
    difficulty: "intermediate",
    questionsAnswered: 4,
    correctAnswers: 3,
    accuracy: 75,
    recentAttempts: [{ isCorrect: true }],
    dktMastery: null,
  });
  assert.strictEqual(
    stateWithoutDKT,
    "intermediate:high_mastery:correct:low",
    "Null DKT must safely fall back to accuracy-based tier (75% -> high_mastery)"
  );
  console.log("✓ Test 3: Safe fallback functions cleanly when DKT is cold-start or absent");

  // 4. Reward Function Verification
  // 4a. Inappropriate difficulty increase during struggle receives severe penalty
  const struggleState = {
    difficulty: "intermediate",
    questionsAnswered: 5,
    correctAnswers: 1,
    recentAttempts: [{ isCorrect: false }, { isCorrect: false }],
  };
  const overloadReward = agent.calculateReward(
    struggleState,
    { isCorrect: false },
    Q_ACTIONS.INCREASE_DIFFICULTY
  );
  assert.ok(overloadReward <= -7.0, "Increasing difficulty during struggle must be penalized");

  // 4b. Targeted remediation during struggle receives positive alignment reward
  const remediationReward = agent.calculateReward(
    struggleState,
    { isCorrect: true },
    Q_ACTIONS.REINFORCE_WEAK_CONCEPT
  );
  assert.ok(remediationReward >= 5.0, "Reinforcing weak concept successfully must earn positive reward");
  console.log("✓ Test 4: Pedagogical reward function penalizes overload and rewards remediation");

  // 5. Bellman Q-Value Update
  const s0 = "intermediate:med_mastery:correct:low";
  const s1 = "intermediate:high_mastery:correct:low";
  agent.qTable[s1] = {
    [Q_ACTIONS.INCREASE_DIFFICULTY]: 4.0,
    [Q_ACTIONS.MAINTAIN_DIFFICULTY]: 2.0,
    [Q_ACTIONS.DECREASE_DIFFICULTY]: -1.0,
    [Q_ACTIONS.REINFORCE_WEAK_CONCEPT]: 1.0,
  };
  // Q(s0, a) init 0.0, r = +5.0, gamma = 0.85, alpha = 0.15
  // target = 5.0 + 0.85 * 4.0 = 8.4
  // newQ = 0.0 + 0.15 * (8.4 - 0.0) = 1.26
  const updateResult = agent.updateQValue(s0, Q_ACTIONS.INCREASE_DIFFICULTY, 5.0, s1);
  return updateResult.then((info) => {
    assert.strictEqual(info.qValue, 1.26, "Bellman update should compute Q = 1.26");
    console.log("✓ Test 5: Bellman equation updates Q-values correctly");

    // 6. AdaptationAgent Target Topic Propagation
    const adaptAgent = new AdaptationAgent({ qLearning: agent });
    const mockStudent = {
      difficulty: "intermediate",
      questionsAnswered: 3,
      correctAnswers: 1,
      weakTopic: "A* Search & Heuristics",
      dktMastery: {
        average_mastery: 0.35,
        weakest_concept: "A* Search & Heuristics",
        is_cold_start: false,
      },
    };

    // Force agent to select REINFORCE_WEAK_CONCEPT for testing
    agent.qTable["intermediate:low_mastery:correct:low"] = {
      [Q_ACTIONS.INCREASE_DIFFICULTY]: -2.0,
      [Q_ACTIONS.MAINTAIN_DIFFICULTY]: 0.0,
      [Q_ACTIONS.DECREASE_DIFFICULTY]: 0.5,
      [Q_ACTIONS.REINFORCE_WEAK_CONCEPT]: 5.0,
    };

    return adaptAgent.decideNextStep(mockStudent, { isCorrect: true, correctAnswer: "Opt A" }).then((decision) => {
      assert.strictEqual(decision.qLearningMeta.action, Q_ACTIONS.REINFORCE_WEAK_CONCEPT);
      assert.strictEqual(decision.targetTopic, "A* Search & Heuristics", "Target topic must match weakest concept");
      assert.ok(decision.qLearningMeta.dktActive, "dktActive flag must be true");
      console.log("✓ Test 6: AdaptationAgent properly propagates targeted topic from DKT");
      console.log("\nAll Q-Learning & RL Personalization tests passed successfully!\n");
    });
  });
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
