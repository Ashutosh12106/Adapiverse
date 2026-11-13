const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
let Database;
try {
  const nodeSqlite = require("node:sqlite");
  if (nodeSqlite && nodeSqlite.DatabaseSync) {
    Database = nodeSqlite.DatabaseSync;
  }
} catch (e) { /* fallback to better-sqlite3 if node:sqlite unavailable */ }

if (!Database) {
  Database = require("better-sqlite3");
}
const { execFile } = require("child_process");

dotenv.config();
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

app.use(cors());
app.use(express.json());

// Resolve Python executable for local DKT inference
function getPythonExecutable() {
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  const candidates = [
    "/opt/anaconda3/bin/python",
    "/usr/local/bin/python3",
    "python3",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "python3";
}

const pythonExecutable = getPythonExecutable();
const dktScriptPath = path.join(__dirname, "..", "ml", "inference.py");
const dktMicroserviceUrl = process.env.DKT_SERVICE_URL || "http://127.0.0.1:5001";
const dktMetadataPath = path.join(__dirname, "..", "ml", "artifacts", "metadata.json");
const dktMetricsPath = path.join(__dirname, "..", "ml", "artifacts", "metrics.json");

function getDKTColdStartFallback(nextConcept = null) {
  const defaultConcepts = [
    "A* Search & Heuristics", "Search Algorithms", "Turing Test", "Intelligent Agents",
    "AI Principles", "Core Fundamentals", "Supervised Learning", "Unsupervised Learning",
    "Reinforcement Learning", "Classification & Regression", "Clustering Algorithms",
    "Decision Trees & Ensembles", "Machine Learning Fundamentals", "ML Concepts",
    "Neural Networks", "Backpropagation & Optimization", "Loss Functions",
    "Overfitting & Regularization", "Natural Language Processing", "Computer Vision"
  ];
  const topicMastery = {};
  defaultConcepts.forEach(c => { topicMastery[c] = 0.50; });
  return {
    success: true,
    predicted_next_prob: 0.50,
    target_concept: nextConcept || "General AI/ML",
    topic_mastery: topicMastery,
    average_mastery: 0.50,
    strongest_concept: defaultConcepts[0],
    weakest_concept: defaultConcepts[0],
    num_attempts_traced: 0,
    is_cold_start: true,
    note: "Awaiting quiz attempts to trace knowledge. Baseline calibrated."
  };
}

async function queryDKT(interactions, nextConcept = null) {
  // 1. Try local microservice if running
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600);
    const resp = await fetch(`${dktMicroserviceUrl}/api/dkt/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interactions: interactions || [], next_concept: nextConcept }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.success) return data;
    }
  } catch (err) {
    // Microservice offline/timeout; fallback to direct Python CLI execution
  }

  // 2. Direct Python process fallback
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      interactions: interactions || [],
      next_concept: nextConcept || null,
    });
    execFile(
      pythonExecutable,
      [dktScriptPath, "--json", payload],
      { timeout: 5000 },
      (error, stdout) => {
        if (error) {
          console.warn("DKT CLI fallback warning:", error.message);
          resolve(getDKTColdStartFallback(nextConcept));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve({ success: true, ...parsed });
        } catch (parseErr) {
          console.warn("DKT CLI parse warning:", parseErr.message);
          resolve(getDKTColdStartFallback(nextConcept));
        }
      }
    );
  });
}

async function getDKTRealMastery(nextConcept = null) {
  try {
    const rows = db
      .prepare(`
        SELECT question, subject, difficulty, is_correct
        FROM quiz_attempts
        ORDER BY id ASC
      `)
      .all();

    const interactions = rows.map((r) => ({
      concept: extractConceptFromQuestion(r.question, r.subject),
      is_correct: Boolean(r.is_correct),
      difficulty: r.difficulty,
      subject: r.subject,
    }));

    const result = await queryDKT(interactions, nextConcept);
    return {
      ...result,
      realAttemptsCount: interactions.length,
    };
  } catch (err) {
    console.error("Error computing DKT real mastery:", err);
    return getDKTColdStartFallback(nextConcept);
  }
}

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, "adaptiveverse.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    question TEXT NOT NULL,
    selected_answer TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS q_learning_state (
    state_key TEXT NOT NULL,
    action TEXT NOT NULL,
    q_value REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (state_key, action)
  );
`);

// Safe schema migration for quiz_attempts to support extended dataset fields
try {
  const tableInfo = db.prepare("PRAGMA table_info(quiz_attempts)").all();
  const existingCols = new Set(tableInfo.map((c) => c.name));

  if (!existingCols.has("session_id")) {
    db.exec("ALTER TABLE quiz_attempts ADD COLUMN session_id TEXT;");
  }
  if (!existingCols.has("topic")) {
    db.exec("ALTER TABLE quiz_attempts ADD COLUMN topic TEXT;");
  }
  if (!existingCols.has("response_time_seconds")) {
    db.exec("ALTER TABLE quiz_attempts ADD COLUMN response_time_seconds REAL;");
  }
  if (!existingCols.has("dkt_mastery")) {
    db.exec("ALTER TABLE quiz_attempts ADD COLUMN dkt_mastery REAL;");
  }
  if (!existingCols.has("rl_action")) {
    db.exec("ALTER TABLE quiz_attempts ADD COLUMN rl_action TEXT;");
  }
} catch (migErr) {
  console.warn("Notice during table migration:", migErr.message);
}

const supportedSubjects = ["Artificial Intelligence", "Machine Learning"];

function extractConceptFromQuestion(questionText, subject) {
  if (!questionText || typeof questionText !== "string") {
    return subject || "Core Fundamentals";
  }
  const q = questionText.toLowerCase();

  if (q.includes("a*") || q.includes("heuristic")) return "A* Search & Heuristics";
  if (q.includes("supervised") && !q.includes("unsupervised")) return "Supervised Learning";
  if (q.includes("unsupervised")) return "Unsupervised Learning";
  if (q.includes("reinforcement") || q.includes("q-learning") || q.includes("bellman") || q.includes("markov")) return "Reinforcement Learning";
  if (q.includes("backpropagation") || q.includes("gradient descent")) return "Backpropagation & Optimization";
  if (q.includes("neural network") || q.includes("perceptron") || q.includes("deep learning")) return "Neural Networks";
  if (q.includes("overfitting") || q.includes("regularization") || q.includes("dropout") || q.includes("underfitting")) return "Overfitting & Regularization";
  if (q.includes("decision tree") || q.includes("random forest")) return "Decision Trees & Ensembles";
  if (q.includes("loss function") || q.includes("cost function")) return "Loss Functions";
  if (q.includes("breadth-first") || q.includes("depth-first") || q.includes("bfs") || q.includes("dfs")) return "Search Algorithms";
  if (q.includes("turing test")) return "Turing Test";
  if (q.includes("intelligent agent") || q.includes("rational agent") || q.includes("sensor")) return "Intelligent Agents";
  if (q.includes("classification") || q.includes("regression")) return "Classification & Regression";
  if (q.includes("clustering") || q.includes("k-means")) return "Clustering Algorithms";
  if (q.includes("natural language") || q.includes("nlp") || q.includes("tokenization")) return "Natural Language Processing";
  if (q.includes("computer vision") || q.includes("cnn") || q.includes("convolutional")) return "Computer Vision";
  if (q.includes("machine learning")) return "Machine Learning Fundamentals";
  if (q.includes("artificial intelligence")) return "AI Principles";

  const quotedMatch = questionText.match(/["']([^"']{3,35})["']/);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1].trim();
  }

  return subject === "Machine Learning" ? "ML Concepts" : "AI Fundamentals";
}

function getStudentLearningContext(selectedSubject) {
  try {
    const totalRow = db
      .prepare("SELECT COUNT(*) as count FROM quiz_attempts")
      .get();
    const correctRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM quiz_attempts WHERE is_correct = 1",
      )
      .get();

    const totalQuestions = totalRow ? Number(totalRow.count) : 0;
    const correctAnswers = correctRow ? Number(correctRow.count) : 0;
    const overallAccuracy =
      totalQuestions === 0
        ? 0
        : Math.round((correctAnswers / totalQuestions) * 100);

    const subjectTotalRow = db
      .prepare("SELECT COUNT(*) as count FROM quiz_attempts WHERE subject = ?")
      .get(selectedSubject);
    const subjectCorrectRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM quiz_attempts WHERE subject = ? AND is_correct = 1",
      )
      .get(selectedSubject);

    const subjectAttempts = subjectTotalRow ? Number(subjectTotalRow.count) : 0;
    const subjectCorrect = subjectCorrectRow
      ? Number(subjectCorrectRow.count)
      : 0;
    const subjectAccuracy =
      subjectAttempts === 0
        ? 0
        : Math.round((subjectCorrect / subjectAttempts) * 100);

    const recentAttempts = db
      .prepare(
        `
        SELECT subject, difficulty, question, selected_answer, correct_answer, is_correct
        FROM quiz_attempts
        ORDER BY id DESC
        LIMIT 6
      `,
      )
      .all();

    const recentIncorrect = db
      .prepare(
        `
        SELECT subject, difficulty, question, selected_answer, correct_answer
        FROM quiz_attempts
        WHERE is_correct = 0
        ORDER BY id DESC
        LIMIT 4
      `,
      )
      .all();

    let contextSummary = `STUDENT LEARNING CONTEXT (from past quiz history):
- Overall performance: ${totalQuestions} questions attempted, ${correctAnswers} correct, overall accuracy ${overallAccuracy}%.
- Subject performance for "${selectedSubject}": ${subjectAttempts} questions attempted, ${subjectCorrect} correct, accuracy ${subjectAccuracy}%.`;

    if (recentAttempts.length > 0) {
      contextSummary +=
        `\n- Recent quiz attempts:\n` +
        recentAttempts
          .map(
            (a, i) =>
              `  ${i + 1}. [${a.subject} - ${a.difficulty}] Q: "${a.question}" -> Result: ${
                a.is_correct
                  ? "CORRECT"
                  : `INCORRECT (student selected "${a.selected_answer}", correct was "${a.correct_answer}")`
              }`,
          )
          .join("\n");
    }

    if (recentIncorrect.length > 0) {
      contextSummary +=
        `\n- Recent struggle points / concepts missed:\n` +
        recentIncorrect
          .map(
            (a) =>
              `  * [${a.subject} (${a.difficulty})] "${a.question}" -> Student missed answer: "${a.selected_answer}", correct answer: "${a.correct_answer}"`,
          )
          .join("\n");
    } else if (totalQuestions > 0 && correctAnswers === totalQuestions) {
      contextSummary += `\n- The student has answered all recent questions correctly, exhibiting high mastery.`;
    }

    return {
      totalQuestions,
      correctAnswers,
      overallAccuracy,
      subjectAttempts,
      subjectCorrect,
      subjectAccuracy,
      recentAttempts,
      recentIncorrect,
      contextSummary,
    };
  } catch (error) {
    console.error("Error generating learning context:", error);
    return {
      totalQuestions: 0,
      correctAnswers: 0,
      overallAccuracy: 0,
      subjectAttempts: 0,
      subjectCorrect: 0,
      subjectAccuracy: 0,
      recentAttempts: [],
      recentIncorrect: [],
      contextSummary: "No previous quiz history available.",
    };
  }
}

const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
].filter(Boolean);

// Diverse, multi-tier curriculum question bank for graceful offline fallback
const FALLBACK_QUESTION_BANK = [
  // --- Artificial Intelligence: Beginner ---
  {
    subject: "Artificial Intelligence",
    difficulty: "beginner",
    topic: "A* Search & Heuristics",
    question: "In pathfinding and state space search, what is the defining property of an admissible heuristic in A* search?",
    options: [
      "It never overestimates the true lowest cost from the current state to the goal",
      "It guarantees that every state in the search space is expanded exactly once",
      "It transforms the search graph into an unweighted directed acyclic graph",
      "It forces the search to explore in pure depth-first order"
    ],
    correctAnswer: "It never overestimates the true lowest cost from the current state to the goal"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "beginner",
    topic: "Turing Test",
    question: "What is the primary objective of the classic Turing Test proposed by Alan Turing?",
    options: [
      "To evaluate whether a machine can exhibit conversational behavior indistinguishable from a human",
      "To benchmark the raw clock cycle throughput of high-performance silicon chips",
      "To verify whether a computer program can solve any NP-complete problem in polynomial time",
      "To measure whether a neural network can converge without gradient backpropagation"
    ],
    correctAnswer: "To evaluate whether a machine can exhibit conversational behavior indistinguishable from a human"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "beginner",
    topic: "Intelligent Agents",
    question: "In artificial intelligence agent design, what does the PEAS environment framework represent?",
    options: [
      "Performance measure, Environment, Actuators, Sensors",
      "Processors, Energy, Architecture, Storage",
      "Prediction, Execution, Adaptation, Supervision",
      "Planning, Evaluation, Allocation, Simulation"
    ],
    correctAnswer: "Performance measure, Environment, Actuators, Sensors"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "beginner",
    topic: "Search Algorithms",
    question: "Which data structure is fundamentally utilized by Breadth-First Search (BFS) to maintain the exploration frontier?",
    options: [
      "A First-In-First-Out (FIFO) Queue",
      "A Last-In-First-Out (LIFO) Stack",
      "A Fibonacci Min-Heap priority queue",
      "A hash table with linear probing"
    ],
    correctAnswer: "A First-In-First-Out (FIFO) Queue"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "beginner",
    topic: "AI Principles",
    question: "In intelligent agent architectures, what distinguishes a 'reflex agent with state' from a 'simple reflex agent'?",
    options: [
      "It tracks internal state history to handle partially observable environments",
      "It uses deep reinforcement learning with offline experience replay",
      "It completely replaces condition-action rules with random exploration",
      "It executes actions without reading any sensor inputs"
    ],
    correctAnswer: "It tracks internal state history to handle partially observable environments"
  },

  // --- Artificial Intelligence: Intermediate ---
  {
    subject: "Artificial Intelligence",
    difficulty: "intermediate",
    topic: "Search Algorithms",
    question: "Which of the following describes the fundamental trade-off between Breadth-First Search (BFS) and Depth-First Search (DFS)?",
    options: [
      "BFS guarantees finding the shallowest goal but has exponential memory complexity; DFS uses linear memory",
      "BFS requires O(1) space complexity while DFS always requires exponential memory storage",
      "BFS can only be applied to cyclic graphs whereas DFS requires directed acyclic trees",
      "DFS is always guaranteed to find the optimal path in graphs with positive edge weights"
    ],
    correctAnswer: "BFS guarantees finding the shallowest goal but has exponential memory complexity; DFS uses linear memory"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "intermediate",
    topic: "Minimax & Game Theory",
    question: "In adversarial zero-sum two-player game trees, what is the role of Alpha-Beta pruning?",
    options: [
      "It prunes branches that cannot influence the final minimax decision, without altering the optimal outcome",
      "It replaces minimax values with heuristic approximations that guarantee faster non-optimal decisions",
      "It converts the adversarial tree into an unweighted uniform-cost graph search problem",
      "It eliminates the need to evaluate leaf node utility functions"
    ],
    correctAnswer: "It prunes branches that cannot influence the final minimax decision, without altering the optimal outcome"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "intermediate",
    topic: "Constraint Satisfaction",
    question: "In Constraint Satisfaction Problems (CSPs), how does Forward Checking optimize backtracking search?",
    options: [
      "It detects impending dead ends early by removing inconsistent domain values for unassigned variables",
      "It relaxes constraints into soft penalties solved using gradient ascent",
      "It eliminates all cycle dependencies in the constraint graph by reordering variables randomly",
      "It assigns values to all remaining variables simultaneously using a genetic mutation step"
    ],
    correctAnswer: "It detects impending dead ends early by removing inconsistent domain values for unassigned variables"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "intermediate",
    topic: "Knowledge Representation",
    question: "In rule-based knowledge representation, what distinguishes forward chaining from backward chaining?",
    options: [
      "Forward chaining is data-driven starting from known premises; backward chaining is goal-driven starting from hypotheses",
      "Forward chaining only works with propositional logic; backward chaining works exclusively with fuzzy sets",
      "Forward chaining operates backwards in time through an explicit episodic memory replay buffer",
      "Backward chaining guarantees polynomial runtime whereas forward chaining is undecidable"
    ],
    correctAnswer: "Forward chaining is data-driven starting from known premises; backward chaining is goal-driven starting from hypotheses"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "intermediate",
    topic: "A* Search & Heuristics",
    question: "If heuristic h1(n) and heuristic h2(n) are both admissible and h1(n) >= h2(n) for all states n, which statement is true?",
    options: [
      "h1 dominates h2 and A* using h1 will expand no more nodes than A* using h2",
      "h2 dominates h1 because smaller heuristic values are strictly less conservative",
      "Both heuristics will expand identical sets of nodes because both are admissible",
      "A* using h1 will produce sub-optimal paths because h1 values are too large"
    ],
    correctAnswer: "h1 dominates h2 and A* using h1 will expand no more nodes than A* using h2"
  },

  // --- Artificial Intelligence: Advanced ---
  {
    subject: "Artificial Intelligence",
    difficulty: "advanced",
    topic: "A* Search & Heuristics",
    question: "What condition must a heuristic function h(n) satisfy to guarantee that A* graph search (with a closed list) never needs to reopen a visited node?",
    options: [
      "Consistency (monotonicity): h(n) <= c(n, a, n') + h(n') for all transitions",
      "Linearity: h(n) must be a strictly linear combination of Euclidean coordinates",
      "Sub-additivity: h(n) must sum to 1.0 across all leaf nodes in the search tree",
      "Stochasticity: h(n) must sample from an invariant uniform probability distribution"
    ],
    correctAnswer: "Consistency (monotonicity): h(n) <= c(n, a, n') + h(n') for all transitions"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "advanced",
    topic: "Constraint Satisfaction",
    question: "In the AC-3 algorithm for Constraint Satisfaction Problems, what does establishing arc consistency between variable Xi and Xj guarantee?",
    options: [
      "For every remaining value in the domain of Xi, there exists at least one allowable value in the domain of Xj",
      "The complete constraint graph is guaranteed to have a valid global solution without backtracking",
      "All binary constraints are converted into unary constraints with constant time lookups",
      "The domain sizes of both variables become strictly equal to 1"
    ],
    correctAnswer: "For every remaining value in the domain of Xi, there exists at least one allowable value in the domain of Xj"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "advanced",
    topic: "Markov Decision Processes",
    question: "In infinite-horizon discounted Markov Decision Processes (MDPs), what mathematical property ensures that Value Iteration converges to a unique optimal value function?",
    options: [
      "The Bellman backup operator is a contraction mapping under the infinity norm with factor gamma < 1",
      "The state transition probability matrix is guaranteed to be skew-symmetric and orthogonal",
      "The reward function must be strictly convex with respect to the state transition vectors",
      "The discount factor gamma must be equal to 1.0 to eliminate asymptotic variance"
    ],
    correctAnswer: "The Bellman backup operator is a contraction mapping under the infinity norm with factor gamma < 1"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "advanced",
    topic: "Search Algorithms",
    question: "In Monte Carlo Tree Search (MCTS), how does the UCT (Upper Confidence bounds applied to Trees) formula address the exploration-exploitation dilemma?",
    options: [
      "It balances win rates with a bonus proportional to the square root of ln(N)/n where N is parent visits and n is child visits",
      "It applies softmax exploration where temperatures decrease monotonically according to an exponential schedule",
      "It prunes branches whose visit counts fall below the median visit count of the entire search tree",
      "It selects nodes with maximum variance regardless of cumulative rewards"
    ],
    correctAnswer: "It balances win rates with a bonus proportional to the square root of ln(N)/n where N is parent visits and n is child visits"
  },
  {
    subject: "Artificial Intelligence",
    difficulty: "advanced",
    topic: "Planning & Logic",
    question: "In classical STRIPS automated planning, what causes the 'delete relaxation' heuristic (h+) to be admissible for state-space search?",
    options: [
      "Ignoring delete effects removes negative interactions, guaranteeing the relaxed plan is at most as costly as the true optimal plan",
      "It converts all multi-agent actions into deterministic zero-cost transitions",
      "It guarantees every intermediate state is an absorbing goal state",
      "It enforces full propositional satisfiability on each time step"
    ],
    correctAnswer: "Ignoring delete effects removes negative interactions, guaranteeing the relaxed plan is at most as costly as the true optimal plan"
  },

  // --- Machine Learning: Beginner ---
  {
    subject: "Machine Learning",
    difficulty: "beginner",
    topic: "Supervised Learning",
    question: "What defines the supervised learning paradigm in machine learning?",
    options: [
      "Training algorithms on labeled dataset pairs consisting of input features and ground-truth targets",
      "Discovering hidden clusters in unlabeled datasets without explicit feedback",
      "Optimizing behavior exclusively through environmental reward and penalty signals",
      "Generating synthetic samples directly without using prior data"
    ],
    correctAnswer: "Training algorithms on labeled dataset pairs consisting of input features and ground-truth targets"
  },
  {
    subject: "Machine Learning",
    difficulty: "beginner",
    topic: "Reinforcement Learning",
    question: "In reinforcement learning, what is the fundamental purpose of the discount factor (gamma) in the Bellman equation?",
    options: [
      "To balance the value of immediate rewards against future expected cumulative rewards",
      "To normalize stochastic gradient descent step sizes during neural parameter updates",
      "To constrain decision tree estimators to a fixed maximum leaf depth",
      "To impute missing categorical features before policy iteration"
    ],
    correctAnswer: "To balance the value of immediate rewards against future expected cumulative rewards"
  },
  {
    subject: "Machine Learning",
    difficulty: "beginner",
    topic: "Overfitting & Regularization",
    question: "What is the primary motivation for partitioning data into training, validation, and test subsets?",
    options: [
      "To evaluate generalization performance on unseen data and tune hyperparameters without test data leakage",
      "To ensure matrix multiplication operations fit into GPU memory buffers",
      "To eliminate the need for calculating gradient vectors during training",
      "To convert continuous numeric features into binary categorical indicators"
    ],
    correctAnswer: "To evaluate generalization performance on unseen data and tune hyperparameters without test data leakage"
  },
  {
    subject: "Machine Learning",
    difficulty: "beginner",
    topic: "Evaluation Metrics",
    question: "In binary classification with imbalanced classes, which metric measures the proportion of actual positive cases that were correctly identified?",
    options: [
      "Recall (Sensitivity)",
      "Accuracy",
      "Precision (Positive Predictive Value)",
      "Specificity"
    ],
    correctAnswer: "Recall (Sensitivity)"
  },
  {
    subject: "Machine Learning",
    difficulty: "beginner",
    topic: "Machine Learning Fundamentals",
    question: "Which of the following scenarios is a typical application of unsupervised learning?",
    options: [
      "Customer market segmentation based on purchasing patterns using k-means clustering",
      "Predicting house sale prices from square footage and location using linear regression",
      "Detecting fraudulent transactions using a labeled database of historical fraud cases",
      "Training an autonomous agent to play chess via win-loss terminal rewards"
    ],
    correctAnswer: "Customer market segmentation based on purchasing patterns using k-means clustering"
  },

  // --- Machine Learning: Intermediate ---
  {
    subject: "Machine Learning",
    difficulty: "intermediate",
    topic: "Overfitting & Regularization",
    question: "How does L2 regularization (Ridge) penalize model complexity compared to L1 regularization (Lasso)?",
    options: [
      "L2 penalizes the squared magnitude of weights driving them toward zero, whereas L1 penalizes absolute magnitudes promoting sparse weights",
      "L2 forces weights to be strictly zero, whereas L1 penalizes only negative weights",
      "L2 applies dropout masks to random neurons, whereas L1 adjusts the learning rate schedule",
      "L2 can only be applied to logistic regression, whereas L1 works exclusively with decision forests"
    ],
    correctAnswer: "L2 penalizes the squared magnitude of weights driving them toward zero, whereas L1 penalizes absolute magnitudes promoting sparse weights"
  },
  {
    subject: "Machine Learning",
    difficulty: "intermediate",
    topic: "Neural Networks",
    question: "Why are non-linear activation functions (e.g. ReLU, GELU, Sigmoid) essential in multi-layer neural networks?",
    options: [
      "Without non-linear activations, multi-layer networks collapse mathematically into a single linear transformation regardless of depth",
      "They guarantee that backpropagation gradients never vanish across deep architectures",
      "They eliminate the need to calculate loss gradients during gradient descent",
      "They convert matrix multiplication operations into scalar arithmetic"
    ],
    correctAnswer: "Without non-linear activations, multi-layer networks collapse mathematically into a single linear transformation regardless of depth"
  },
  {
    subject: "Machine Learning",
    difficulty: "intermediate",
    topic: "Bias-Variance Tradeoff",
    question: "A machine learning model exhibits very low training error but high test error. What does this behavior indicate?",
    options: [
      "High variance (overfitting): the model has memorized training noise and fails to generalize",
      "High bias (underfitting): the model is too simple to capture the underlying data patterns",
      "The dataset has an excessively large regularization penalty term lambda",
      "The learning rate was set to zero throughout model optimization"
    ],
    correctAnswer: "High variance (overfitting): the model has memorized training noise and fails to generalize"
  },
  {
    subject: "Machine Learning",
    difficulty: "intermediate",
    topic: "Decision Trees & Ensembles",
    question: "What is the primary difference between Bagging (e.g. Random Forest) and Boosting (e.g. XGBoost, AdaBoost)?",
    options: [
      "Bagging trains independent base estimators in parallel on bootstrap samples; Boosting trains sequential estimators correcting previous errors",
      "Bagging is used only for linear regression; Boosting is used exclusively for unsupervised dimensionality reduction",
      "Bagging minimizes bias while Boosting exclusively minimizes data variance",
      "Bagging prunes trees to depth 1, whereas Boosting requires fully unpruned decision trees"
    ],
    correctAnswer: "Bagging trains independent base estimators in parallel on bootstrap samples; Boosting trains sequential estimators correcting previous errors"
  },
  {
    subject: "Machine Learning",
    difficulty: "intermediate",
    topic: "Loss Functions",
    question: "Why is Binary Cross-Entropy preferable to Mean Squared Error (MSE) when training neural network classification models with Sigmoid output?",
    options: [
      "Cross-entropy avoids vanishing gradients in output neurons when predictions are confidently wrong, maintaining strong gradient signals",
      "MSE is computationally undecidable when inputs are normalized between 0 and 1",
      "Cross-entropy produces strictly non-differentiable step loss landscapes",
      "MSE requires an exponential number of training epochs to compute"
    ],
    correctAnswer: "Cross-entropy avoids vanishing gradients in output neurons when predictions are confidently wrong, maintaining strong gradient signals"
  },

  // --- Machine Learning: Advanced ---
  {
    subject: "Machine Learning",
    difficulty: "advanced",
    topic: "Backpropagation & Optimization",
    question: "In stochastic gradient optimization with Adam, what do the first (m_t) and second (v_t) moment vectors estimate?",
    options: [
      "m_t estimates the exponential moving average of gradients; v_t estimates the uncentered gradient variance (second raw moment)",
      "m_t estimates the validation accuracy; v_t estimates training loss curvature",
      "m_t estimates network parameter count; v_t estimates GPU memory allocation",
      "m_t estimates empirical categorical entropy; v_t estimates prediction confidence bounds"
    ],
    correctAnswer: "m_t estimates the exponential moving average of gradients; v_t estimates the uncentered gradient variance (second raw moment)"
  },
  {
    subject: "Machine Learning",
    difficulty: "advanced",
    topic: "Neural Networks",
    question: "How do residual connections (skip connections) in architectures like ResNet mitigate the vanishing gradient problem in very deep networks?",
    options: [
      "They allow gradients to propagate directly through the identity shortcut (dF/dx + 1), preventing gradient signals from diminishing to zero",
      "They compress all layer weights into orthogonal matrices with eigenvalues strictly greater than 2",
      "They replace backpropagation through time with closed-form matrix inversions",
      "They eliminate non-linear activations across all intermediate layers"
    ],
    correctAnswer: "They allow gradients to propagate directly through the identity shortcut (dF/dx + 1), preventing gradient signals from diminishing to zero"
  },
  {
    subject: "Machine Learning",
    difficulty: "advanced",
    topic: "Transformers & Attention",
    question: "In the Transformer scaled dot-product self-attention mechanism Attention(Q, K, V), why is the dot product QK^T scaled by 1/sqrt(d_k)?",
    options: [
      "To prevent dot products from growing excessively large for high dimensions, which would push softmax into regions with tiny gradients",
      "To enforce strict orthogonality between Query and Key projection manifolds",
      "To reduce the computational time complexity from quadratic O(N^2) to linear O(N)",
      "To ensure attention weights sum to zero across all sequence positions"
    ],
    correctAnswer: "To prevent dot products from growing excessively large for high dimensions, which would push softmax into regions with tiny gradients"
  },
  {
    subject: "Machine Learning",
    difficulty: "advanced",
    topic: "Overfitting & Regularization",
    question: "During training, how does Batch Normalization reduce Internal Covariate Shift and accelerate neural network convergence?",
    options: [
      "By normalizing layer inputs across the mini-batch to zero mean and unit variance, followed by learnable scale (gamma) and shift (beta) parameters",
      "By randomly zeroing 50% of weight connections between fully connected layers",
      "By freezing all convolutional kernels after the initial training epoch",
      "By converting continuous activations into quantized 8-bit integer representations"
    ],
    correctAnswer: "By normalizing layer inputs across the mini-batch to zero mean and unit variance, followed by learnable scale (gamma) and shift (beta) parameters"
  },
  {
    subject: "Machine Learning",
    difficulty: "advanced",
    topic: "Reinforcement Learning",
    question: "What core innovation differentiates Deep Q-Networks (DQN) from classical tabular Q-learning to ensure stable convergence when using neural approximations?",
    options: [
      "The use of an Experience Replay buffer (breaking correlation between consecutive samples) and a separate periodic Target Network",
      "The complete elimination of the discount factor gamma and learning rate alpha",
      "Replacing the Bellman equation with unconstrained supervised Monte Carlo regression",
      "Training strictly on on-policy trajectory distributions without exploratory epsilon-greedy actions"
    ],
    correctAnswer: "The use of an Experience Replay buffer (breaking correlation between consecutive samples) and a separate periodic Target Network"
  }
];

// Circular history tracking to guarantee fallback questions rotate smoothly without repeating
const recentFallbackQuestionIndices = new Set();
const MAX_RECENT_FALLBACK_HISTORY = 15;

function getFallbackQuizQuestion(selectedSubject, difficulty, targetTopic) {
  // 1. Filter candidates matching subject, difficulty, and optional topic
  let candidates = FALLBACK_QUESTION_BANK.map((q, idx) => ({ ...q, originalIndex: idx })).filter(q => {
    const subjMatch = q.subject === selectedSubject;
    const diffMatch = q.difficulty === difficulty;
    const topicMatch = targetTopic
      ? q.topic.toLowerCase().includes(targetTopic.toLowerCase()) || targetTopic.toLowerCase().includes(q.topic.toLowerCase())
      : true;
    return subjMatch && diffMatch && topicMatch;
  });

  // 2. If no topic match found, fallback to matching subject + difficulty
  if (candidates.length === 0) {
    candidates = FALLBACK_QUESTION_BANK.map((q, idx) => ({ ...q, originalIndex: idx })).filter(
      q => q.subject === selectedSubject && q.difficulty === difficulty
    );
  }

  // 3. If still empty, match subject
  if (candidates.length === 0) {
    candidates = FALLBACK_QUESTION_BANK.map((q, idx) => ({ ...q, originalIndex: idx })).filter(
      q => q.subject === selectedSubject
    );
  }

  if (candidates.length === 0) {
    candidates = FALLBACK_QUESTION_BANK.map((q, idx) => ({ ...q, originalIndex: idx }));
  }

  // Filter out questions served recently to guarantee fresh rotation on every click
  let freshCandidates = candidates.filter(q => !recentFallbackQuestionIndices.has(q.originalIndex));

  // If all matching questions have been served recently, purge their indices from history to recycle smoothly
  if (freshCandidates.length === 0) {
    candidates.forEach(q => recentFallbackQuestionIndices.delete(q.originalIndex));
    freshCandidates = candidates;
  }

  // Select randomly from the fresh candidates pool
  const selected = freshCandidates[Math.floor(Math.random() * freshCandidates.length)];

  // Record into recently served set
  recentFallbackQuestionIndices.add(selected.originalIndex);
  if (recentFallbackQuestionIndices.size > MAX_RECENT_FALLBACK_HISTORY) {
    const oldest = recentFallbackQuestionIndices.values().next().value;
    recentFallbackQuestionIndices.delete(oldest);
  }

  return {
    subject: selected.subject,
    difficulty: selected.difficulty,
    topic: selected.topic,
    question: selected.question,
    options: [...selected.options],
    correctAnswer: selected.correctAnswer,
    isFallback: true,
    generator: "curriculum_fallback",
  };
}

function generateFallbackTeacherResponse({ studentQuestion, selectedSubject, difficulty, topic, intent }) {
  const formattedDiff = difficulty ? difficulty.charAt(0).toUpperCase() + difficulty.slice(1) : "Beginner";
  const focusTopic = topic || selectedSubject || "Core Fundamentals";

  if (intent === "hint") {
    return `### 💡 Teacher Emilian's Hint for "${focusTopic}"

**Definition:**
Consider the core objective and primary definition of ${focusTopic} in ${selectedSubject}.

**Explanation:**
Look closely at the relationship between inputs and outputs. Focus on the fundamental mechanism rather than tricky edge cases.

**Practical Example:**
Think of how a GPS navigation algorithm prioritizes routes that get progressively closer to the destination rather than wandering aimlessly.

**Short Recap:**
Rule out choices that introduce contradictory mechanisms and select the foundational principle.`;
  }

  return `### 🎓 Teacher Emilian on ${focusTopic} (${formattedDiff} Level)

**Definition:**
${focusTopic} is a foundational concept in ${selectedSubject} that defines how intelligent systems interpret data, evaluate choices, and optimize outcomes.

**Explanation:**
At the ${formattedDiff} level, the key intuition is understanding how models process inputs through defined transformations to make reliable decisions or predictions.

**Practical Example:**
Imagine a smart spam filter: it scans message features, evaluates word patterns against learned weights, and decides whether an email belongs in your inbox.

**Short Recap:**
Build strong intuition for the core input-to-output pipeline first, and advanced concepts become much easier to master!`;
}

async function callGeminiWithFallback(systemInstruction, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured");
  }

  let lastError = null;
  const timeoutMs = 10000; // 10-second timeout allows sufficient time for JSON generation

  for (const model of CANDIDATE_MODELS) {
    const maxAttempts = 2; // 1 initial attempt + 1 retry for transient spikes
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let timeoutId = null;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                parts: [{ text: userPrompt }],
              },
            ],
          }),
        });
        clearTimeout(timeoutId);

        const data = await response.json();

        if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
          return data.candidates[0].content.parts[0].text;
        }

        const errMsg = data.error?.message || `HTTP ${response.status}`;
        console.warn(
          `[Gemini] Model ${model} returned status ${response.status} (attempt ${attempt}/${maxAttempts}): ${errMsg.slice(0, 100)}`
        );
        lastError = `Model ${model} returned HTTP ${response.status}: ${errMsg.slice(0, 90)}`;

        // If model not found (404), do not retry this model; skip directly to next model
        if (response.status === 404) {
          break;
        }

        // For transient errors (e.g. 429 quota or 503 spike), brief delay before retry
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 600));
        }
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        const isAbort = err.name === "AbortError";
        const cleanMsg = isAbort
          ? `Request timed out after ${timeoutMs}ms`
          : err.message;
        console.warn(
          `[Gemini] Model ${model} error (attempt ${attempt}/${maxAttempts}): ${cleanMsg}`
        );
        lastError = `Model ${model}: ${cleanMsg}`;

        // On abort/timeout or error, do NOT abort the candidate loop! Continue to next candidate model or retry
        if (isAbort) {
          break; // move to next candidate model
        }

        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }
  }

  throw new Error(`All Gemini models failed: ${lastError}`);
}

app.post("/api/chatgpt", async (req, res) => {
  try {
    console.log("Chat Request Body:", req.body);

    const selectedSubject =
      req.body.selectedSubject || "Artificial Intelligence";
    const difficulty = req.body.difficulty || "beginner";
    const studentQuestion = req.body.message;
    const topic = req.body.topic || null;
    const predictedMastery = req.body.predictedMastery;
    const recentMistakes = req.body.recentMistakes || [];
    const rlAction = req.body.rlAction || null;
    const rlReason = req.body.rlReason || null;
    const intent = req.body.intent || "chat"; // "chat", "explain", "hint"

    if (
      !studentQuestion ||
      typeof studentQuestion !== "string" ||
      !studentQuestion.trim()
    ) {
      return res.status(400).json({ error: "Empty message" });
    }

    const learning = getStudentLearningContext(selectedSubject);

    // Build rich pedagogical context from DKT predictions and RL directives
    let richContextAdditions = "";
    if (predictedMastery !== undefined && predictedMastery !== null) {
      const masteryPct =
        typeof predictedMastery === "number"
          ? Math.round(predictedMastery * 100)
          : predictedMastery.average_mastery !== undefined
            ? Math.round(predictedMastery.average_mastery * 100)
            : null;
      if (masteryPct !== null) {
        richContextAdditions += `\n- Deep Knowledge Tracing (DKT LSTM) Estimated Mastery: ${masteryPct}%.`;
      }
    }

    if (topic) {
      richContextAdditions += `\n- Target Focus Concept: "${topic}".`;
    }

    if (rlAction) {
      richContextAdditions += `\n- Reinforcement Learning (Q-Learning) Action: [${rlAction}]${rlReason ? ` - "${rlReason}"` : ""}.`;
    }

    if (Array.isArray(recentMistakes) && recentMistakes.length > 0) {
      const mistakesSummary = recentMistakes
        .map((m) => (typeof m === "string" ? m : m.concept || m.question || "Core principle"))
        .slice(0, 3)
        .join("; ");
      richContextAdditions += `\n- Specific Struggle Points Identified in Recent Attempts: ${mistakesSummary}.`;
    }

    let roleGuidance = "";
    if (intent === "hint") {
      roleGuidance = `INTENT: PEDAGOGICAL HINT
- Provide a subtle, encouraging hint that nudges the learner in the right direction without directly stating the exact answer.
- Calibrate the hint to the student's difficulty level (${difficulty}) and estimated knowledge.
- Keep the hint concise (2-4 sentences max), punchy, and clear.`;
    } else if (intent === "explain") {
      roleGuidance = `INTENT: CONCEPTUAL EXPLANATION
- Provide a comprehensive, step-by-step pedagogical explanation of the concept "${topic || studentQuestion}".
- Calibrate to estimated mastery:
  * If mastery is low (< 50%): start with simple, vivid intuitive analogies before any formal definitions. Avoid heavy jargon.
  * If mastery is moderate (50-70%): explain the underlying mechanics, practical usage, and trade-offs.
  * If mastery is high (> 70%): provide deeper technical rigor, nuances, and edge-case insights.
- Emphasize key takeaways clearly.`;
    } else {
      roleGuidance = `INTENT: CONVERSATIONAL TUTORING & DIALOGUE
- Answer the student's question warmly, clearly, and encouragingly.
- Tailor explanations to their difficulty (${difficulty}) and current mastery.
- If RL Action is "reinforce_weak_concept", naturally reinforce their struggle concepts.`;
    }

    const systemPrompt = `You are Teacher Emilian, an expert, warm, and highly adaptive AI tutor inside AdaptiveVerse.
The student has selected "${selectedSubject}" and their current learning difficulty is "${difficulty}".

${learning.contextSummary}${richContextAdditions}

${roleGuidance}

TEACHING STRUCTURE & STYLE (MANDATORY):
When explaining a concept or answering an educational question, structure your response using these 4 concise sections:
1. **Definition**: A clear, 1-2 sentence simple definition of the core concept.
2. **Explanation**: A straightforward explanation of how and why it works, calibrated to the student's difficulty level (${difficulty}).
3. **Practical Example**: A relatable real-world analogy or concrete code/scenario example.
4. **Short Recap**: A quick 1-sentence memorable takeaway or check-in.

GUIDELINES:
- Keep the explanation concise, focused, and digestible. Avoid unnecessarily long essays, excessive repetition, or walls of text.
- Use proper Markdown: bold section labels (e.g. **Definition:**), clear bullet points where helpful, and clean code blocks if illustrating code.
- NEVER display raw unformatted markdown artifacts.
- For "${selectedSubject}":
  * If Artificial Intelligence: teach AI principles, search algorithms, heuristics, intelligent agents, logic, neural architectures, and ethics.
  * If Machine Learning: teach ML paradigms (supervised, unsupervised, reinforcement), loss functions, optimization, overfitting, and evaluation.
- NEVER mention internal database names, SQL queries, or backend tables. Act warmly, encouragingly, and authoritatively as Teacher Emilian.`;

    try {
      const answer = await callGeminiWithFallback(systemPrompt, studentQuestion);
      res.json({ response: answer, isFallback: false });
    } catch (apiErr) {
      console.warn("Gemini call failed; activating pedagogical fallback:", apiErr.message);
      const fallbackResponse = generateFallbackTeacherResponse({
        studentQuestion,
        selectedSubject,
        difficulty,
        topic,
        intent,
      });
      res.json({ response: fallbackResponse, isFallback: true, errorNotice: apiErr.message });
    }
  } catch (error) {
    console.error("Error in /api/chatgpt:", error.message);
    const fallbackResponse = generateFallbackTeacherResponse({
      studentQuestion: req.body?.message || "Help",
      selectedSubject: req.body?.selectedSubject || "Artificial Intelligence",
      difficulty: req.body?.difficulty || "beginner",
      topic: req.body?.topic,
      intent: req.body?.intent || "chat",
    });
    res.json({ response: fallbackResponse, isFallback: true });
  }
});

// Dedicated Tutor Explanation endpoint
app.post("/api/tutor/explain", async (req, res) => {
  req.body.intent = "explain";
  if (!req.body.message && req.body.topic) {
    req.body.message = `Explain the concept: ${req.body.topic}`;
  }
  return app._router.handle(req, res);
});

// Dedicated Tutor Hint endpoint
app.post("/api/tutor/hint", async (req, res) => {
  req.body.intent = "hint";
  if (!req.body.message && req.body.question) {
    req.body.message = `Give me a hint for this question: "${req.body.question}"`;
  }
  return app._router.handle(req, res);
});

app.post("/api/generate-quiz-question", async (req, res) => {
  try {
    console.log("Quiz Request Body:", req.body);

    const {
      selectedSubject,
      difficulty = "beginner",
      targetTopic,
      predictedMastery,
      topicMastery,
      rlAction,
      rlReason,
      recentMistakes = [],
    } = req.body;

    if (!supportedSubjects.includes(selectedSubject)) {
      return res.status(400).json({
        error: "Unsupported subject",
      });
    }

    const learning = getStudentLearningContext(selectedSubject);

    // Build rich DKT and RL context strings for Gemini
    let dktAndRLContext = "";
    if (predictedMastery !== undefined && predictedMastery !== null) {
      const avgPct =
        typeof predictedMastery === "number"
          ? Math.round(predictedMastery * 100)
          : predictedMastery.average_mastery !== undefined
            ? Math.round(predictedMastery.average_mastery * 100)
            : null;
      if (avgPct !== null) {
        dktAndRLContext += `\n- DKT LSTM Predicted Mastery: ${avgPct}% overall curriculum mastery.`;
      }
    }

    if (topicMastery && targetTopic && topicMastery[targetTopic] !== undefined) {
      const topicPct = Math.round(topicMastery[targetTopic] * 100);
      dktAndRLContext += `\n- DKT LSTM Mastery for target concept "${targetTopic}": ${topicPct}%.`;
    }

    if (rlAction) {
      dktAndRLContext += `\n- Active Reinforcement Learning (RL) Policy Action: [${rlAction}]${rlReason ? ` — Rationale: "${rlReason}"` : ""}.`;
    }

    if (Array.isArray(recentMistakes) && recentMistakes.length > 0) {
      const mistakesSummary = recentMistakes
        .map((m) => (typeof m === "string" ? m : m.concept || m.question || "Foundational topic"))
        .slice(0, 3)
        .join("; ");
      dktAndRLContext += `\n- Recent Student Struggle Points to Address / Probe: ${mistakesSummary}.`;
    }

    const recentQuestionsList = (learning.recentAttempts || [])
      .map((a) => a.question)
      .filter(Boolean)
      .slice(0, 5);

    const quizSystemPrompt = `You are the AI adaptive quiz generator for AdaptiveVerse.
Generate exactly one ${difficulty} multiple-choice quiz question for the subject "${selectedSubject}".

${learning.contextSummary}${dktAndRLContext}
${recentQuestionsList.length > 0 ? `\nPREVIOUSLY ATTEMPTED QUESTIONS (DO NOT DUPLICATE OR CLOSELY REPEAT THESE):\n${recentQuestionsList.map((q) => `- "${q}"`).join("\n")}` : ""}

PEDAGOGICAL ADAPTATION GUIDELINES:
- Respect the difficulty level: ${difficulty.toUpperCase()}
  * beginner: Focus on fundamental concepts, definitions, core terminology, and intuitive recognition. Avoid overwhelming math or obscure implementation quirks.
  * intermediate: Focus on applying concepts, comparing techniques, understanding workflows, and evaluating practical trade-offs.
  * advanced: Focus on deeper architectural reasoning, edge cases, algorithmic mechanics, and optimization.
- Adaptation Directives:
  * Selected RL Action: ${rlAction || "maintain_difficulty"}
  * If RL Action is "reinforce_weak_concept" or a target concept is specified${targetTopic ? ` ("${targetTopic}")` : ""}: The question MUST directly target this concept to reinforce understanding and test recovery.
  * If RL Action is "increase_difficulty": Challenge the student with elevated conceptual depth appropriate for ${difficulty}.
  * If RL Action is "decrease_difficulty": Ease cognitive strain by testing fundamental bedrock principles for ${difficulty}.
  * If student has recent struggle points: Design the question to address common misunderstandings around these concepts.
  * Ensure the question remains strictly relevant to "${selectedSubject}".
- DIVERSITY & FRESHNESS:
  * Each question must be completely novel, fresh, and pedagogically sound. Do not reuse wording or patterns.

RESPONSE FORMAT:
Return ONLY valid JSON with this exact shape:
{"question":"...","topic":"...","options":["...","...","...","..."],"correctAnswer":"..."}

CRITICAL RULES:
- The "options" array MUST contain exactly 4 options.
- The "correctAnswer" MUST exactly match one of the options in the "options" array.
- The "topic" field MUST be a concise 2-4 word concept name (e.g. "A* Search & Heuristics", "Supervised Learning", "Neural Networks", "Reinforcement Learning").
- Do NOT wrap in markdown or backticks. Return raw JSON.`;

    const freshNonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const userPrompt =
      targetTopic && typeof targetTopic === "string" && targetTopic.trim()
        ? `Generate one fresh, unique ${difficulty} adaptive quiz question for ${selectedSubject} specifically focusing on the concept "${targetTopic.trim()}" to reinforce student mastery based on RL action [${rlAction || "reinforce"}]. Session token: ${freshNonce}.`
        : `Generate one fresh, unique ${difficulty} adaptive quiz question for ${selectedSubject} aligned with RL action [${rlAction || "maintain"}]. Session token: ${freshNonce}.`;

    try {
      let quizText = await callGeminiWithFallback(
        quizSystemPrompt,
        userPrompt,
      );

      let cleanJson = quizText.replace(/```json/gi, "").replace(/```/g, "").trim();
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
      }

      let quizQuestion;
      try {
        quizQuestion = JSON.parse(cleanJson);
      } catch (parseErr) {
        console.warn("Quiz JSON Parse Error, using fallback:", parseErr.message);
        quizQuestion = getFallbackQuizQuestion(selectedSubject, difficulty, targetTopic);
      }

      if (
        !quizQuestion ||
        !quizQuestion.question ||
        !Array.isArray(quizQuestion.options) ||
        !quizQuestion.correctAnswer ||
        quizQuestion.options.length !== 4 ||
        !quizQuestion.options.includes(quizQuestion.correctAnswer)
      ) {
        console.warn("Quiz question structure invalid, using fallback question.");
        quizQuestion = getFallbackQuizQuestion(selectedSubject, difficulty, targetTopic);
      }

      quizQuestion.topic =
        quizQuestion.topic && typeof quizQuestion.topic === "string" && quizQuestion.topic.trim().length > 0
          ? quizQuestion.topic.trim()
          : extractConceptFromQuestion(quizQuestion.question, selectedSubject);
      quizQuestion.subject = selectedSubject;
      quizQuestion.difficulty = difficulty;
      quizQuestion.isFallback = Boolean(quizQuestion.isFallback);
      quizQuestion.generator = quizQuestion.isFallback ? "curriculum_fallback" : "gemini";

      res.json(quizQuestion);
    } catch (apiError) {
      console.warn("Gemini quiz generation failed; serving curated curriculum fallback question:", apiError.message);
      const fallbackQuestion = getFallbackQuizQuestion(selectedSubject, difficulty, targetTopic);
      fallbackQuestion.subject = selectedSubject;
      fallbackQuestion.difficulty = difficulty;
      fallbackQuestion.isFallback = true;
      fallbackQuestion.generator = "curriculum_fallback";
      res.json(fallbackQuestion);
    }
  } catch (error) {
    console.error("Quiz Error Details:", error.message);
    const fallbackQuestion = getFallbackQuizQuestion(
      req.body?.selectedSubject || "Artificial Intelligence",
      req.body?.difficulty || "beginner",
      req.body?.targetTopic,
    );
    fallbackQuestion.isFallback = true;
    fallbackQuestion.generator = "curriculum_fallback";
    res.json(fallbackQuestion);
  }
});

app.post("/api/progress/attempt", (req, res) => {
  try {
    const {
      subject,
      difficulty,
      question,
      selectedAnswer,
      correctAnswer,
      isCorrect,
      timestamp,
      sessionId,
      studentId,
      topic,
      responseTimeSeconds,
      responseTime,
      dktMastery,
      rlAction,
    } = req.body;

    if (
      !subject ||
      !difficulty ||
      !question ||
      selectedAnswer === undefined ||
      correctAnswer === undefined ||
      typeof isCorrect !== "boolean"
    ) {
      return res.status(400).json({
        error: "Missing or invalid required attempt fields",
      });
    }

    const attemptTimestamp = timestamp || new Date().toISOString();
    const isCorrectInt = isCorrect ? 1 : 0;
    const finalSessionId = sessionId || studentId || "anonymous_student";
    const finalTopic = topic || extractConceptFromQuestion(question, subject);
    const parsedRespTime =
      typeof responseTimeSeconds === "number" && !isNaN(responseTimeSeconds)
        ? responseTimeSeconds
        : typeof responseTime === "number" && !isNaN(responseTime)
          ? responseTime
          : null;
    const parsedDktMastery =
      typeof dktMastery === "number" && !isNaN(dktMastery)
        ? dktMastery
        : null;
    const finalRlAction = rlAction || null;

    const stmt = db.prepare(`
      INSERT INTO quiz_attempts (
        subject,
        difficulty,
        question,
        selected_answer,
        correct_answer,
        is_correct,
        timestamp,
        session_id,
        topic,
        response_time_seconds,
        dkt_mastery,
        rl_action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      subject,
      difficulty,
      question,
      selectedAnswer,
      correctAnswer,
      isCorrectInt,
      attemptTimestamp,
      finalSessionId,
      finalTopic,
      parsedRespTime,
      parsedDktMastery,
      finalRlAction,
    );

    res.status(201).json({
      success: true,
      attemptId: Number(info.lastInsertRowid),
    });
  } catch (error) {
    console.error("Error saving quiz attempt:", error);
    res.status(500).json({
      error: "An error occurred while saving quiz attempt",
    });
  }
});

// Helper for RFC-4180 CSV escaping
function escapeCsvValue(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Export real student performance records as downloadable CSV
app.get(["/api/dataset/export", "/api/student-performance.csv", "/api/export/csv"], (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT
          id,
          session_id,
          timestamp,
          subject,
          difficulty,
          topic,
          question,
          selected_answer,
          correct_answer,
          is_correct,
          response_time_seconds,
          dkt_mastery,
          rl_action
        FROM quiz_attempts
        ORDER BY id ASC
      `)
      .all();

    const headers = [
      "attempt_id",
      "session_id",
      "timestamp",
      "subject",
      "difficulty",
      "topic",
      "question",
      "selected_answer",
      "correct_answer",
      "is_correct",
      "response_time_seconds",
      "dkt_predicted_mastery",
      "rl_action",
    ];

    const csvLines = [headers.join(",")];

    for (const row of rows) {
      const topic = row.topic || extractConceptFromQuestion(row.question, row.subject);
      const sessionId = row.session_id || "anonymous_student";
      const respTime =
        row.response_time_seconds !== null && row.response_time_seconds !== undefined
          ? Number(row.response_time_seconds).toFixed(1)
          : "";
      const dktMasteryVal =
        row.dkt_mastery !== null && row.dkt_mastery !== undefined
          ? Number(row.dkt_mastery).toFixed(4)
          : "";
      const rlActionVal = row.rl_action || "";

      const line = [
        escapeCsvValue(row.id),
        escapeCsvValue(sessionId),
        escapeCsvValue(row.timestamp),
        escapeCsvValue(row.subject),
        escapeCsvValue(row.difficulty),
        escapeCsvValue(topic),
        escapeCsvValue(row.question),
        escapeCsvValue(row.selected_answer),
        escapeCsvValue(row.correct_answer),
        escapeCsvValue(row.is_correct ? 1 : 0),
        escapeCsvValue(respTime),
        escapeCsvValue(dktMasteryVal),
        escapeCsvValue(rlActionVal),
      ].join(",");

      csvLines.push(line);
    }

    const csvContent = csvLines.join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="student_performance.csv"',
    );
    res.status(200).send(csvContent);
  } catch (error) {
    console.error("Error generating CSV export:", error);
    res.status(500).json({ error: "Failed to export student performance dataset" });
  }
});

// Dataset Analytics endpoint: overall, breakdown by subject/topic/difficulty, response times, and over-time trend
app.get("/api/dataset/analytics", (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT
          id,
          session_id,
          timestamp,
          subject,
          difficulty,
          topic,
          question,
          selected_answer,
          correct_answer,
          is_correct,
          response_time_seconds,
          dkt_mastery,
          rl_action
        FROM quiz_attempts
        ORDER BY id ASC
      `)
      .all();

    const totalAttempts = rows.length;
    let correctCount = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;

    const accuracyBySubject = {
      "Artificial Intelligence": { total: 0, correct: 0, accuracy: 0 },
      "Machine Learning": { total: 0, correct: 0, accuracy: 0 },
    };

    const accuracyByDifficulty = {
      beginner: { total: 0, correct: 0, accuracy: 0 },
      intermediate: { total: 0, correct: 0, accuracy: 0 },
      advanced: { total: 0, correct: 0, accuracy: 0 },
    };

    const topicStatsMap = {};

    let runningCorrect = 0;
    const performanceOverTime = [];

    rows.forEach((row, idx) => {
      const isCorr = Boolean(row.is_correct);
      if (isCorr) {
        correctCount++;
        runningCorrect++;
      }

      if (
        row.response_time_seconds !== null &&
        row.response_time_seconds !== undefined &&
        !isNaN(row.response_time_seconds)
      ) {
        totalResponseTime += Number(row.response_time_seconds);
        responseTimeCount++;
      }

      // Subject stats
      if (!accuracyBySubject[row.subject]) {
        accuracyBySubject[row.subject] = { total: 0, correct: 0, accuracy: 0 };
      }
      accuracyBySubject[row.subject].total++;
      if (isCorr) accuracyBySubject[row.subject].correct++;

      // Difficulty stats
      const diffKey = (row.difficulty || "beginner").toLowerCase();
      if (!accuracyByDifficulty[diffKey]) {
        accuracyByDifficulty[diffKey] = { total: 0, correct: 0, accuracy: 0 };
      }
      accuracyByDifficulty[diffKey].total++;
      if (isCorr) accuracyByDifficulty[diffKey].correct++;

      // Topic stats (with fallback concept extraction for legacy rows)
      const topic = row.topic || extractConceptFromQuestion(row.question, row.subject);
      if (!topicStatsMap[topic]) {
        topicStatsMap[topic] = { topic, total: 0, correct: 0, accuracy: 0 };
      }
      topicStatsMap[topic].total++;
      if (isCorr) topicStatsMap[topic].correct++;

      // Timeline trend item
      performanceOverTime.push({
        attemptIndex: idx + 1,
        attemptId: row.id,
        timestamp: row.timestamp,
        subject: row.subject,
        difficulty: row.difficulty,
        topic,
        isCorrect: isCorr,
        responseTimeSeconds:
          row.response_time_seconds !== null && row.response_time_seconds !== undefined
            ? Number(row.response_time_seconds)
            : null,
        dktMastery:
          row.dkt_mastery !== null && row.dkt_mastery !== undefined
            ? Number(row.dkt_mastery)
            : null,
        rlAction: row.rl_action || null,
        cumulativeAccuracy: Math.round((runningCorrect / (idx + 1)) * 100),
      });
    });

    const overallAccuracy =
      totalAttempts === 0 ? 0 : Math.round((correctCount / totalAttempts) * 100);
    const averageResponseTimeSeconds =
      responseTimeCount === 0
        ? null
        : Number((totalResponseTime / responseTimeCount).toFixed(1));

    Object.keys(accuracyBySubject).forEach((k) => {
      const s = accuracyBySubject[k];
      s.accuracy = s.total === 0 ? 0 : Math.round((s.correct / s.total) * 100);
    });

    Object.keys(accuracyByDifficulty).forEach((k) => {
      const d = accuracyByDifficulty[k];
      d.accuracy = d.total === 0 ? 0 : Math.round((d.correct / d.total) * 100);
    });

    const accuracyByTopic = Object.values(topicStatsMap)
      .map((t) => ({
        ...t,
        accuracy: t.total === 0 ? 0 : Math.round((t.correct / t.total) * 100),
      }))
      .sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      totalAttempts,
      overallAccuracy,
      averageResponseTimeSeconds,
      accuracyBySubject,
      accuracyByDifficulty,
      accuracyByTopic,
      performanceOverTime: performanceOverTime.slice(-50),
      columns: [
        "attempt_id",
        "session_id",
        "timestamp",
        "subject",
        "difficulty",
        "topic",
        "question",
        "selected_answer",
        "correct_answer",
        "is_correct",
        "response_time_seconds",
        "dkt_predicted_mastery",
        "rl_action",
      ],
    });
  } catch (error) {
    console.error("Error computing dataset analytics:", error);
    res.status(500).json({ error: "Failed to generate dataset analytics" });
  }
});

app.get("/api/progress", async (req, res) => {
  try {
    const totalRow = db
      .prepare("SELECT COUNT(*) as count FROM quiz_attempts")
      .get();
    const correctRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM quiz_attempts WHERE is_correct = 1",
      )
      .get();

    const totalQuestions = totalRow ? Number(totalRow.count) : 0;
    const correctAnswers = correctRow ? Number(correctRow.count) : 0;
    const incorrectAnswers = totalQuestions - correctAnswers;
    const accuracy =
      totalQuestions === 0
        ? 0
        : Math.round((correctAnswers / totalQuestions) * 100);

    const recentAttemptsRows = db
      .prepare(
        `
        SELECT
          id,
          subject,
          difficulty,
          question,
          selected_answer AS selectedAnswer,
          correct_answer AS correctAnswer,
          is_correct AS isCorrect,
          timestamp,
          session_id AS sessionId,
          topic,
          response_time_seconds AS responseTimeSeconds,
          dkt_mastery AS dktMastery,
          rl_action AS rlAction
        FROM quiz_attempts
        ORDER BY id DESC
        LIMIT 10
      `,
      )
      .all();

    const recentAttempts = recentAttemptsRows.map((row) => ({
      ...row,
      isCorrect: Boolean(row.isCorrect),
      topic: row.topic || extractConceptFromQuestion(row.question, row.subject),
    }));

    // Compute real subject breakdown from SQLite
    const subjectStats = {};
    for (const subj of supportedSubjects) {
      const totRow = db
        .prepare("SELECT COUNT(*) as count FROM quiz_attempts WHERE subject = ?")
        .get(subj);
      const corrRow = db
        .prepare(
          "SELECT COUNT(*) as count FROM quiz_attempts WHERE subject = ? AND is_correct = 1",
        )
        .get(subj);

      const tot = totRow ? Number(totRow.count) : 0;
      const corr = corrRow ? Number(corrRow.count) : 0;
      subjectStats[subj] = {
        total: tot,
        correct: corr,
        accuracy: tot === 0 ? 0 : Math.round((corr / tot) * 100),
      };
    }

    // Compute real weak topics / concepts from incorrect attempts in SQLite
    const incorrectRows = db
      .prepare(
        `
        SELECT subject, difficulty, question, selected_answer, correct_answer
        FROM quiz_attempts
        WHERE is_correct = 0
        ORDER BY id DESC
        LIMIT 10
      `,
      )
      .all();

    const weakConceptCounts = {};
    for (const row of incorrectRows) {
      const concept = extractConceptFromQuestion(row.question, row.subject);
      weakConceptCounts[concept] = (weakConceptCounts[concept] || 0) + 1;
    }

    const weakConcepts = Object.entries(weakConceptCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([concept, count]) => ({ concept, count }));

    const primaryWeakTopic =
      weakConcepts.length > 0
        ? weakConcepts[0].concept
        : totalQuestions > 0
          ? "None (High Mastery)"
          : "No quiz data yet";

    const dktMastery = await getDKTRealMastery();

    res.json({
      totalQuestions,
      correctAnswers,
      incorrectAnswers,
      accuracy,
      recentAttempts,
      subjectStats,
      weakConcepts,
      weakTopic: primaryWeakTopic,
      dktMastery,
    });
  } catch (error) {
    console.error("Error fetching progress:", error);
    res.status(500).json({
      error: "An error occurred while fetching progress",
    });
  }
});

// Phase 1 DKT Dedicated Endpoints
app.get("/api/dkt/status", (req, res) => {
  let metadata = {};
  let metrics = {};
  try {
    if (fs.existsSync(dktMetadataPath)) {
      metadata = JSON.parse(fs.readFileSync(dktMetadataPath, "utf-8"));
    }
    if (fs.existsSync(dktMetricsPath)) {
      metrics = JSON.parse(fs.readFileSync(dktMetricsPath, "utf-8"));
    }
  } catch (e) {
    // Artifact files may not be generated yet; ignore
  }

  res.json({
    status: "online",
    service: "AdaptiveVerse DKT Integrated API",
    modelName: metadata.model_name || "AdaptiveVerse-DKT-LSTM",
    parameterCount: metadata.parameter_count || 27700,
    hardware: metadata.hardware_target || "MacBook Air M1 CPU",
    evaluationMetrics: metrics.best_epoch_metrics || {},
    trainingDataInfo: metadata.training_data || {},
    syntheticDisclaimer:
      "Model weights pre-trained on synthetic educational benchmark for initial calibration. Live student mastery is traced strictly from real SQLite quiz attempts.",
  });
});

app.get("/api/dkt/mastery", async (req, res) => {
  try {
    const nextConcept = req.query.nextConcept || null;
    const mastery = await getDKTRealMastery(nextConcept);
    res.json(mastery);
  } catch (err) {
    console.error("Error in /api/dkt/mastery:", err);
    res.status(500).json({ error: "Failed to compute DKT mastery" });
  }
});

app.post("/api/dkt/predict", async (req, res) => {
  try {
    const { interactions, nextConcept } = req.body || {};
    const prediction = await queryDKT(interactions || [], nextConcept || null);
    res.json(prediction);
  } catch (err) {
    console.error("Error in /api/dkt/predict:", err);
    res.status(500).json({ error: "Failed to predict DKT mastery" });
  }
});

app.get("/api/qlearning/table", (req, res) => {
  try {
    const rows = db
      .prepare("SELECT state_key, action, q_value FROM q_learning_state")
      .all();
    const table = {};
    for (const row of rows) {
      if (!table[row.state_key]) {
        table[row.state_key] = {};
      }
      table[row.state_key][row.action] = Number(row.q_value);
    }
    res.json({ success: true, table });
  } catch (error) {
    console.error("Error fetching Q-learning table:", error);
    res.status(500).json({ error: "Failed to fetch Q-learning table" });
  }
});

app.post("/api/qlearning/update", (req, res) => {
  try {
    const { stateKey, action, qValue, timestamp } = req.body;
    if (!stateKey || !action || qValue === undefined) {
      return res.status(400).json({ error: "Missing required Q-learning fields" });
    }
    const updateTime = timestamp || new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO q_learning_state (state_key, action, q_value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(state_key, action) DO UPDATE SET
        q_value = excluded.q_value,
        updated_at = excluded.updated_at
    `);
    stmt.run(stateKey, action, Number(qValue), updateTime);
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating Q-learning table:", error);
    res.status(500).json({ error: "Failed to update Q-learning table" });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Gemini proxy server is running on port ${PORT}`);
});
