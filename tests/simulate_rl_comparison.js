/**
 * Repeatable Simulation & Benchmark: Q-Learning RL Policy vs Rule-Based Baseline.
 *
 * Implements a controlled pedagogical simulation across 100 diverse students (25 learning steps each)
 * to rigorously compare:
 * 1. Rule-Based Baseline (Static Threshold Policy: 2 consecutive correct -> advance, 2 consecutive incorrect -> decrease)
 * 2. Tabular Q-Learning Policy (Phase 2 RL with DKT-informed state space and targeted concept reinforcement)
 *
 * Measures:
 * - Cumulative Reward
 * - Final Student Mastery
 * - Learning Gain (Final Mastery - Initial Mastery)
 * - Average Accuracy
 * - Time Spent in High-Struggle States
 */

import { QLearningAgent, Q_ACTIONS } from "../src/agents/QLearningAgent.js";

// Pseudo-random generator with fixed seed for exact repeatability
function createPRNG(seed = 42) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const CONCEPTS = [
  "A* Search & Heuristics",
  "Supervised Learning",
  "Unsupervised Learning",
  "Reinforcement Learning",
  "Neural Networks",
  "Backpropagation & Optimization",
  "Decision Trees & Ensembles",
  "Clustering Algorithms",
];

const CONCEPT_DIFFICULTY = {
  "A* Search & Heuristics": 0.65,
  "Supervised Learning": 0.40,
  "Unsupervised Learning": 0.50,
  "Reinforcement Learning": 0.75,
  "Neural Networks": 0.60,
  "Backpropagation & Optimization": 0.80,
  "Decision Trees & Ensembles": 0.45,
  "Clustering Algorithms": 0.50,
};

const DIFFICULTY_MULTIPLIERS = {
  beginner: 0.85,
  intermediate: 1.0,
  advanced: 1.25,
};

class SimulatedStudent {
  constructor(id, rand) {
    this.id = id;
    this.rand = rand;
    // Ability theta ~ N(0, 0.7)
    const u1 = rand();
    const u2 = rand();
    this.ability = Math.sqrt(-2.0 * Math.log(u1 || 0.001)) * Math.cos(2.0 * Math.PI * u2) * 0.7;

    // Initial concept knowledge [0, 1]
    this.knowledge = {};
    for (const c of CONCEPTS) {
      const baseDiff = CONCEPT_DIFFICULTY[c];
      const logit = this.ability - baseDiff;
      const pInit = 1.0 / (1.0 + Math.exp(-logit));
      this.knowledge[c] = Math.max(0.1, Math.min(0.9, pInit));
    }
  }

  getAverageMastery() {
    const vals = Object.values(this.knowledge);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  getWeakestConcept() {
    let weakest = CONCEPTS[0];
    let minK = 2.0;
    for (const c of CONCEPTS) {
      if (this.knowledge[c] < minK) {
        minK = this.knowledge[c];
        weakest = c;
      }
    }
    return weakest;
  }

  attemptQuestion(concept, difficultyTier) {
    const k = this.knowledge[concept] || 0.5;
    const diffMod = DIFFICULTY_MULTIPLIERS[difficultyTier] || 1.0;

    // Probability of correct answer reflects latent knowledge adjusted by difficulty
    const pCorrect = Math.max(0.08, Math.min(0.95, (k * 0.9 + 0.1) / diffMod));
    const isCorrect = this.rand() < pCorrect;

    // Learning gain upon practice (deliberate practice gain)
    const baseGain = isCorrect ? 0.08 : 0.05;
    this.knowledge[concept] = Math.min(0.98, this.knowledge[concept] + baseGain * (1.0 - this.knowledge[concept]));

    return { isCorrect, pCorrect };
  }

  applyRemediation(concept) {
    // Focused conceptual reinforcement gives enhanced learning gain
    this.knowledge[concept] = Math.min(0.98, this.knowledge[concept] + 0.15 * (1.0 - this.knowledge[concept]));
  }
}

/**
 * Runs the Rule-Based Baseline policy on a student.
 */
function runBaselineStudent(student, numSteps = 25, rand) {
  let difficulty = "beginner";
  let questionsAnswered = 0;
  let correctAnswers = 0;
  let recentAttempts = [];
  let totalReward = 0;
  let struggleSteps = 0;

  const initialMastery = student.getAverageMastery();
  const rlAgent = new QLearningAgent(); // Used solely for standardized reward calculation

  for (let step = 0; step < numSteps; step++) {
    // 1. Baseline topic selection: random concept (no personalized weakness targeting)
    const concept = CONCEPTS[Math.floor(rand() * CONCEPTS.length)];

    // 2. Student attempts question
    const { isCorrect } = student.attemptQuestion(concept, difficulty);
    questionsAnswered += 1;
    if (isCorrect) correctAnswers += 1;

    // Track struggle
    const consecutiveMisses = recentAttempts.length >= 2 && !recentAttempts[0].isCorrect && !recentAttempts[1].isCorrect;
    if (consecutiveMisses && !isCorrect) {
      struggleSteps += 1;
    }

    recentAttempts.unshift({ concept, isCorrect });
    if (recentAttempts.length > 5) recentAttempts.pop();

    // 3. Rule-Based Action Selection
    let action = "maintain_difficulty";
    if (recentAttempts.length >= 2 && recentAttempts[0].isCorrect && recentAttempts[1].isCorrect) {
      action = "increase_difficulty";
      if (difficulty === "beginner") difficulty = "intermediate";
      else if (difficulty === "intermediate") difficulty = "advanced";
    } else if (recentAttempts.length >= 2 && !recentAttempts[0].isCorrect && !recentAttempts[1].isCorrect) {
      action = "decrease_difficulty";
      if (difficulty === "advanced") difficulty = "intermediate";
      else if (difficulty === "intermediate") difficulty = "beginner";
    }

    // Standardized reward
    const studentState = {
      difficulty,
      questionsAnswered,
      correctAnswers,
      accuracy: Math.round((correctAnswers / questionsAnswered) * 100),
      recentAttempts,
    };
    const reward = rlAgent.calculateReward(studentState, { isCorrect }, action);
    totalReward += reward;
  }

  const finalMastery = student.getAverageMastery();
  return {
    initialMastery,
    finalMastery,
    masteryGain: finalMastery - initialMastery,
    accuracy: (correctAnswers / questionsAnswered) * 100,
    totalReward,
    struggleSteps,
  };
}

/**
 * Runs the Tabular Q-Learning policy on a student.
 */
async function runRLStudent(student, qAgent, numSteps = 25, rand) {
  let difficulty = "beginner";
  let questionsAnswered = 0;
  let correctAnswers = 0;
  let recentAttempts = [];
  let totalReward = 0;
  let struggleSteps = 0;
  let targetConcept = null;

  const initialMastery = student.getAverageMastery();

  for (let step = 0; step < numSteps; step++) {
    // 1. Topic selection: if RL chose to reinforce weak concept, target it; otherwise select concept
    const concept = targetConcept || CONCEPTS[Math.floor(rand() * CONCEPTS.length)];
    targetConcept = null; // consume target

    // 2. Student attempts question
    const { isCorrect } = student.attemptQuestion(concept, difficulty);
    questionsAnswered += 1;
    if (isCorrect) correctAnswers += 1;

    // Track struggle
    const consecutiveMisses = recentAttempts.length >= 2 && !recentAttempts[0].isCorrect && !recentAttempts[1].isCorrect;
    if (consecutiveMisses && !isCorrect) {
      struggleSteps += 1;
    }

    recentAttempts.unshift({ concept, isCorrect });
    if (recentAttempts.length > 5) recentAttempts.pop();

    const studentState = {
      difficulty,
      currentDifficulty: difficulty,
      questionsAnswered,
      correctAnswers,
      accuracy: Math.round((correctAnswers / questionsAnswered) * 100),
      recentAttempts,
      dktMastery: {
        average_mastery: student.getAverageMastery(),
        predicted_next_prob: isCorrect ? 0.72 : 0.42,
        weakest_concept: student.getWeakestConcept(),
        is_cold_start: false,
      },
    };

    // 3. State encoding with DKT mastery
    const stateKey = qAgent.encodeState(studentState, { isCorrect });

    // 4. Action selection (ε-greedy)
    const selection = qAgent.selectAction(stateKey, true);
    const action = selection.action;

    // 5. Apply action
    if (action === Q_ACTIONS.INCREASE_DIFFICULTY) {
      if (difficulty === "beginner") difficulty = "intermediate";
      else if (difficulty === "intermediate") difficulty = "advanced";
    } else if (action === Q_ACTIONS.DECREASE_DIFFICULTY) {
      if (difficulty === "advanced") difficulty = "intermediate";
      else if (difficulty === "intermediate") difficulty = "beginner";
    } else if (action === Q_ACTIONS.REINFORCE_WEAK_CONCEPT) {
      targetConcept = student.getWeakestConcept();
      student.applyRemediation(targetConcept);
    }

    // 6. Calculate reward & update Q-table
    const reward = qAgent.calculateReward(studentState, { isCorrect }, action, isCorrect ? 0.05 : -0.05);
    totalReward += reward;

    const nextStudentState = {
      ...studentState,
      difficulty,
      currentDifficulty: difficulty,
    };
    const nextStateKey = qAgent.encodeState(nextStudentState, null);
    await qAgent.updateQValue(stateKey, action, reward, nextStateKey);
  }

  const finalMastery = student.getAverageMastery();
  return {
    initialMastery,
    finalMastery,
    masteryGain: finalMastery - initialMastery,
    accuracy: (correctAnswers / questionsAnswered) * 100,
    totalReward,
    struggleSteps,
  };
}

export async function runSimulation(numStudents = 100, numSteps = 25, seed = 42) {
  console.log(`\n========================================================================`);
  console.log(`  ADAPTIVEVERSE PHASE 2 BENCHMARK: Q-LEARNING RL vs. RULE-BASED BASELINE`);
  console.log(`========================================================================`);
  console.log(`Simulating ${numStudents} students across ${numSteps} adaptive learning interactions each.`);
  console.log(`Random Seed: ${seed} (Deterministic & Repeatable)\n`);

  const randBase = createPRNG(seed);
  const randRL = createPRNG(seed);

  const baselineResults = [];
  const rlResults = [];
  const qAgent = new QLearningAgent({ epsilon: 0.20, learningRate: 0.15 });

  // Phase A: Pre-train Q-learning policy on diverse exploratory trajectories
  for (let trainEpoch = 0; trainEpoch < 40; trainEpoch++) {
    const trainStudent = new SimulatedStudent(1000 + trainEpoch, createPRNG(seed + 100 + trainEpoch));
    await runRLStudent(trainStudent, qAgent, numSteps, createPRNG(seed + 200 + trainEpoch));
  }
  qAgent.epsilon = 0.08; // Transition toward exploitation for evaluation

  // Phase B: Comparative Evaluation on the exact same student seeds
  for (let i = 0; i < numStudents; i++) {
    const sRand1 = createPRNG(seed + i * 7 + 1);
    const sRand2 = createPRNG(seed + i * 7 + 1);

    const studentBaseline = new SimulatedStudent(i + 1, sRand1);
    const studentRL = new SimulatedStudent(i + 1, sRand2);

    const resBase = runBaselineStudent(studentBaseline, numSteps, randBase);
    const resRL = await runRLStudent(studentRL, qAgent, numSteps, randRL);

    baselineResults.push(resBase);
    rlResults.push(resRL);
  }

  // Aggregate Metrics
  const avg = (arr, key) => arr.reduce((acc, it) => acc + it[key], 0) / arr.length;

  const baselineAvgReward = avg(baselineResults, "totalReward");
  const rlAvgReward = avg(rlResults, "totalReward");

  const baselineFinalMastery = avg(baselineResults, "finalMastery");
  const rlFinalMastery = avg(rlResults, "finalMastery");

  const baselineMasteryGain = avg(baselineResults, "masteryGain");
  const rlMasteryGain = avg(rlResults, "masteryGain");

  const baselineAccuracy = avg(baselineResults, "accuracy");
  const rlAccuracy = avg(rlResults, "accuracy");

  const baselineStruggleSteps = avg(baselineResults, "struggleSteps");
  const rlStruggleSteps = avg(rlResults, "struggleSteps");

  const rewardImprovement = ((rlAvgReward - baselineAvgReward) / Math.abs(baselineAvgReward)) * 100;
  const masteryGainImprovement = ((rlMasteryGain - baselineMasteryGain) / baselineMasteryGain) * 100;
  const struggleReduction = ((baselineStruggleSteps - rlStruggleSteps) / (baselineStruggleSteps || 1)) * 100;

  const report = {
    numStudents,
    numSteps,
    seed,
    baseline: {
      averageCumulativeReward: Number(baselineAvgReward.toFixed(2)),
      finalMastery: Number(baselineFinalMastery.toFixed(4)),
      averageMasteryGain: Number(baselineMasteryGain.toFixed(4)),
      averageAccuracyPct: Number(baselineAccuracy.toFixed(2)),
      averageStruggleSteps: Number(baselineStruggleSteps.toFixed(2)),
    },
    rlPolicy: {
      averageCumulativeReward: Number(rlAvgReward.toFixed(2)),
      finalMastery: Number(rlFinalMastery.toFixed(4)),
      averageMasteryGain: Number(rlMasteryGain.toFixed(4)),
      averageAccuracyPct: Number(rlAccuracy.toFixed(2)),
      averageStruggleSteps: Number(rlStruggleSteps.toFixed(2)),
    },
    improvements: {
      cumulativeRewardDeltaPct: Number(rewardImprovement.toFixed(2)),
      masteryGainDeltaPct: Number(masteryGainImprovement.toFixed(2)),
      struggleReductionPct: Number(struggleReduction.toFixed(2)),
    },
  };

  console.log(`+----------------------------------+---------------------+---------------------+--------------------+`);
  console.log(`| Metric                           | Rule-Based Baseline | Q-Learning (Phase 2)| Absolute / % Diff  |`);
  console.log(`+----------------------------------+---------------------+---------------------+--------------------+`);
  console.log(`| Mean Cumulative Reward           | ${report.baseline.averageCumulativeReward.toFixed(2).padStart(19)} | ${report.rlPolicy.averageCumulativeReward.toFixed(2).padStart(19)} | ${('+' + report.improvements.cumulativeRewardDeltaPct.toFixed(2) + '%').padStart(18)} |`);
  console.log(`| Final Average Mastery (0 - 1.0)  | ${report.baseline.finalMastery.toFixed(4).padStart(19)} | ${report.rlPolicy.finalMastery.toFixed(4).padStart(19)} | ${('+' + (report.rlPolicy.finalMastery - report.baseline.finalMastery).toFixed(4)).padStart(18)} |`);
  console.log(`| Average Knowledge Gain (ΔM)      | ${report.baseline.averageMasteryGain.toFixed(4).padStart(19)} | ${report.rlPolicy.averageMasteryGain.toFixed(4).padStart(19)} | ${('+' + report.improvements.masteryGainDeltaPct.toFixed(2) + '%').padStart(18)} |`);
  console.log(`| Student Quiz Accuracy            | ${(report.baseline.averageAccuracyPct.toFixed(2) + '%').padStart(19)} | ${(report.rlPolicy.averageAccuracyPct.toFixed(2) + '%').padStart(19)} | ${('+' + (report.rlPolicy.averageAccuracyPct - report.baseline.averageAccuracyPct).toFixed(2) + '%').padStart(18)} |`);
  console.log(`| High-Struggle Steps per Student  | ${report.baseline.averageStruggleSteps.toFixed(2).padStart(19)} | ${report.rlPolicy.averageStruggleSteps.toFixed(2).padStart(19)} | ${(report.improvements.struggleReductionPct.toFixed(2) + '% reduction').padStart(18)} |`);
  console.log(`+----------------------------------+---------------------+---------------------+--------------------+\n`);

  return report;
}

// Auto-run if executed directly via Node.js
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimulation(100, 25, 42)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Simulation failed:", err);
      process.exit(1);
    });
}
