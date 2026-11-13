/**
 * Helper to identify or extract a crisp concept/topic name from question text.
 */
export function extractConceptFromQuestion(questionText, subject) {
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

/**
 * AssessmentAgent - Responsible for quiz question generation, rubric scoring,
 * answer evaluation, and tracking assessment attempts with the backend store.
 */
export class AssessmentAgent {
  constructor(baseUrl = "http://localhost:3001") {
    this.baseUrl = baseUrl;
  }

  /**
   * Validates whether a generated quiz question meets expected shape and constraints.
   *
   * @param {Object} question - The raw question object.
   * @returns {boolean}
   */
  isValidQuestion(question) {
    return (
      Boolean(question) &&
      typeof question.question === "string" &&
      question.question.trim().length > 0 &&
      Array.isArray(question.options) &&
      question.options.length === 4 &&
      typeof question.correctAnswer === "string" &&
      question.options.includes(question.correctAnswer)
    );
  }

  /**
   * Requests a new adaptive quiz question from the backend.
   *
   * @param {Object} studentState - The student's current learning state.
   * @returns {Promise<{ success: boolean, question?: Object, error?: string }>}
   */
  async generateQuestion(studentState = {}, targetTopic = null) {
    const subject = studentState.selectedSubject || "Artificial Intelligence";
    const difficulty =
      studentState.currentDifficulty || studentState.difficulty || "beginner";
    const topicToTarget =
      targetTopic || studentState.pendingTargetTopic || null;
    const predictedMastery =
      studentState.dktMastery?.average_mastery ??
      (studentState.accuracy ? studentState.accuracy / 100 : 0.5);
    const topicMastery = studentState.dktMastery?.topic_mastery ?? null;
    const rlAction =
      studentState.lastRLAction || studentState.selectedAction || null;
    const rlReason = studentState.decisionReason || null;
    const recentMistakes = Array.isArray(studentState.recentAttempts)
      ? studentState.recentAttempts.filter((a) => !a.isCorrect).slice(0, 3)
      : [];

    try {
      const response = await fetch(`${this.baseUrl}/api/generate-quiz-question`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          selectedSubject: subject,
          difficulty: difficulty,
          targetTopic: topicToTarget,
          predictedMastery,
          topicMastery,
          rlAction,
          rlReason,
          recentMistakes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || "Gemini quiz generation is temporarily unavailable.";
        console.error("AssessmentAgent generateQuestion error:", errorMessage);
        return {
          success: false,
          error: errorMessage,
        };
      }

      const questionData = await response.json();

      if (!this.isValidQuestion(questionData)) {
        console.error(
          "AssessmentAgent: Received malformed question structure:",
          questionData,
        );
        return {
          success: false,
          error: "Quiz response could not be parsed. Please try again.",
        };
      }

      // Ensure subject, topic, and difficulty are attached
      questionData.subject = questionData.subject || subject;
      questionData.difficulty = questionData.difficulty || difficulty;
      questionData.topic =
        questionData.topic && typeof questionData.topic === "string" && questionData.topic.trim().length > 0
          ? questionData.topic.trim()
          : extractConceptFromQuestion(questionData.question, subject);

      return {
        success: true,
        question: questionData,
      };
    } catch (error) {
      console.error("AssessmentAgent Network Error:", error);
      return {
        success: false,
        error:
          "Quiz service is unavailable. Check the AdaptiveVerse backend.",
      };
    }
  }

  /**
   * Evaluates a submitted answer against the active quiz question.
   *
   * @param {Object} quizQuestion - The active quiz question object.
   * @param {string} selectedAnswer - The option selected by the student.
   * @param {Object} studentState - The student state context.
   * @returns {{ isCorrect: boolean, attemptData: Object }}
   */
  evaluateAnswer(quizQuestion, selectedAnswer, studentState = {}, meta = {}) {
    if (!quizQuestion || !quizQuestion.correctAnswer) {
      throw new Error("No active quiz question available for evaluation.");
    }

    const isCorrect = selectedAnswer === quizQuestion.correctAnswer;
    const subject =
      studentState.selectedSubject || quizQuestion.subject || "Artificial Intelligence";
    const difficulty =
      studentState.currentDifficulty ||
      studentState.difficulty ||
      quizQuestion.difficulty ||
      "beginner";
    const topic =
      quizQuestion.topic ||
      extractConceptFromQuestion(quizQuestion.question, subject);

    const attemptData = {
      subject,
      difficulty,
      topic,
      question: quizQuestion.question,
      selectedAnswer: selectedAnswer || "",
      correctAnswer: quizQuestion.correctAnswer,
      isCorrect,
      timestamp: new Date().toISOString(),
      sessionId: meta?.sessionId || studentState.sessionId || "anonymous_student",
      responseTimeSeconds:
        typeof meta?.responseTimeSeconds === "number"
          ? meta.responseTimeSeconds
          : null,
      dktMastery:
        typeof meta?.dktMastery === "number" ? meta.dktMastery : null,
      rlAction: meta?.rlAction || studentState.lastRLAction || null,
    };

    return {
      isCorrect,
      attemptData,
    };
  }

  /**
   * Persists an assessment attempt to the backend SQLite database.
   *
   * @param {Object} attemptData - The evaluated attempt record.
   * @returns {Promise<{ success: boolean, attemptId?: number, error?: string }>}
   */
  async recordAttempt(attemptData) {
    try {
      const response = await fetch(`${this.baseUrl}/api/progress/attempt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(attemptData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.error || `HTTP ${response.status}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        attemptId: result.attemptId,
      };
    } catch (error) {
      console.error("AssessmentAgent recordAttempt error:", error);
      return {
        success: false,
        error: error.message || "Network error while saving attempt",
      };
    }
  }

  /**
   * Fetches real dataset analytics from the backend SQLite database.
   *
   * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
   */
  async fetchDatasetAnalytics() {
    try {
      const response = await fetch(`${this.baseUrl}/api/dataset/analytics`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error("AssessmentAgent fetchDatasetAnalytics error:", error);
      return {
        success: false,
        error: error.message || "Failed to load dataset analytics",
      };
    }
  }

  /**
   * Returns the direct URL to export the student performance dataset CSV.
   *
   * @returns {string}
   */
  getExportDatasetUrl() {
    return `${this.baseUrl}/api/dataset/export`;
  }

  /**
   * Fetches the student's historical progress and performance metrics from the backend.
   *
   * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
   */
  async fetchProgress() {
    try {
      const response = await fetch(`${this.baseUrl}/api/progress`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error("AssessmentAgent fetchProgress error:", error);
      return {
        success: false,
        error: error.message || "Failed to load progress",
      };
    }
  }

  /**
   * Fetches Deep Knowledge Tracing (DKT) estimated topic mastery and next-question probability.
   *
   * @param {string} [nextConcept] - Optional concept for upcoming question.
   * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
   */
  async fetchDKTMastery(nextConcept = null) {
    try {
      const url = nextConcept
        ? `${this.baseUrl}/api/dkt/mastery?nextConcept=${encodeURIComponent(nextConcept)}`
        : `${this.baseUrl}/api/dkt/mastery`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.warn("AssessmentAgent fetchDKTMastery warning:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetches DKT model metadata, parameters, and evaluation metrics.
   *
   * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
   */
  async fetchDKTStatus() {
    try {
      const response = await fetch(`${this.baseUrl}/api/dkt/status`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.warn("AssessmentAgent fetchDKTStatus warning:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Predicts next question correctness probability and updated topic mastery given interactions.
   *
   * @param {Array} interactions
   * @param {string} [nextConcept]
   * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
   */
  async predictDKT(interactions = [], nextConcept = null) {
    try {
      const response = await fetch(`${this.baseUrl}/api/dkt/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactions, nextConcept }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.warn("AssessmentAgent predictDKT warning:", error.message);
      return { success: false, error: error.message };
    }
  }
}

export default AssessmentAgent;
