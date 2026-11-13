import { TutorAgent } from "./TutorAgent.js";
import { AssessmentAgent } from "./AssessmentAgent.js";
import { AdaptationAgent, DIFFICULTY_LEVELS } from "./AdaptationAgent.js";

/**
 * MultiAgentOrchestrator - Central coordination layer connecting the Tutor Agent,
 * Assessment Agent, and Adaptation Agent with the application state.
 */
export class MultiAgentOrchestrator {
  constructor(options = {}) {
    const baseUrl = options.baseUrl || "http://localhost:3001";
    this.tutorAgent = new TutorAgent(baseUrl);
    this.assessmentAgent = new AssessmentAgent(baseUrl);
    this.adaptationAgent = new AdaptationAgent(
      options.difficultyLevels || DIFFICULTY_LEVELS,
    );
  }

  /**
   * Helper to create a normalized centralized student state object.
   *
   * @param {Object} [overrides]
   * @returns {Object}
   */
  createInitialStudentState(overrides = {}) {
    return {
      selectedSubject: "Artificial Intelligence",
      currentDifficulty: "beginner",
      difficulty: "beginner",
      questionsAnswered: 0,
      correctAnswers: 0,
      accuracy: 0,
      recentAttempts: [],
      strugglePoints: [],
      subjectStats: {
        "Artificial Intelligence": { total: 0, correct: 0, accuracy: 0 },
        "Machine Learning": { total: 0, correct: 0, accuracy: 0 },
      },
      weakConcepts: [],
      weakTopic: "No quiz data yet",
      dktMastery: null,
      ...overrides,
    };
  }

  /**
   * Loads student historical progress and returns an updated student state.
   *
   * @param {Object} currentState - Current student state.
   * @returns {Promise<{ success: boolean, updatedState: Object, rawData?: Object, error?: string }>}
   */
  async loadStudentProgress(currentState = {}) {
    const baseState = this.createInitialStudentState(currentState);
    const progressResult = await this.assessmentAgent.fetchProgress();

    if (!progressResult.success || !progressResult.data) {
      return {
        success: false,
        updatedState: baseState,
        error: progressResult.error,
      };
    }

    const data = progressResult.data;
    const totalQuestions =
      data.totalQuestions ?? baseState.questionsAnswered ?? 0;
    const correctAnswers =
      data.correctAnswers ?? baseState.correctAnswers ?? 0;
    const accuracy =
      totalQuestions === 0
        ? 0
        : Math.round((correctAnswers / totalQuestions) * 100);

    const latestDifficulty =
      data.recentAttempts && data.recentAttempts[0]?.difficulty
        ? data.recentAttempts[0].difficulty
        : baseState.currentDifficulty || "beginner";

    const updatedState = {
      ...baseState,
      currentDifficulty: currentState.currentDifficulty || latestDifficulty,
      difficulty: currentState.difficulty || latestDifficulty,
      questionsAnswered: totalQuestions,
      correctAnswers: correctAnswers,
      accuracy,
      recentAttempts: data.recentAttempts || baseState.recentAttempts || [],
      subjectStats: data.subjectStats || baseState.subjectStats || {},
      weakConcepts: data.weakConcepts || baseState.weakConcepts || [],
      weakTopic:
        data.weakTopic ||
        baseState.weakTopic ||
        (totalQuestions > 0 ? "None (High Mastery)" : "No quiz data yet"),
      dktMastery: data.dktMastery || baseState.dktMastery || null,
    };

    return {
      success: true,
      updatedState,
      rawData: data,
    };
  }

  /**
   * Routes a student conversational question to the TutorAgent.
   *
   * @param {string} question - Question from student.
   * @param {Object} studentState - Centralized student state.
   * @returns {Promise<{ success: boolean, response: string, error?: string }>}
   */
  async handleStudentQuestion(question, studentState = {}) {
    return await this.tutorAgent.askQuestion(question, studentState);
  }

  /**
   * Routes a request for a concept explanation to the TutorAgent.
   *
   * @param {string} concept - Target concept to explain.
   * @param {Object} studentState - Centralized student state.
   * @returns {Promise<{ success: boolean, response: string, error?: string }>}
   */
  async explainConcept(concept, studentState = {}) {
    return await this.tutorAgent.explainConcept(concept, studentState);
  }

  /**
   * Routes a request for a question hint to the TutorAgent.
   *
   * @param {Object} quizQuestion - Active quiz question.
   * @param {Object} studentState - Centralized student state.
   * @returns {Promise<{ success: boolean, response: string, error?: string }>}
   */
  async provideHint(quizQuestion, studentState = {}) {
    return await this.tutorAgent.provideHint(quizQuestion, studentState);
  }

  /**
   * Coordinates with the AssessmentAgent to generate a subject/difficulty targeted quiz question.
   *
   * @param {Object} studentState - Centralized student state.
   * @param {string} [targetTopic] - Specific concept to target/reinforce.
   * @returns {Promise<{ success: boolean, question?: Object, error?: string, activeAgent: string }>}
   */
  async generateAssessment(studentState = {}, targetTopic = null) {
    const topic = targetTopic || studentState.pendingTargetTopic || null;
    const result = await this.assessmentAgent.generateQuestion(studentState, topic);
    return {
      ...result,
      activeAgent: "Assessment Agent",
    };
  }

  /**
   * Processes a student's answer submission:
   * 1. Evaluates correctness via AssessmentAgent
   * 2. Persists attempt to SQLite database via AssessmentAgent
   * 3. Traces student knowledge via DKT LSTM to obtain up-to-date mastery predictions
   * 4. Coordinates with AdaptationAgent to select RL action and compute Bellman reward update
   * 5. Returns updated state and decision explanation for the personalized feedback loop
   *
   * @param {Object} quizQuestion - Active quiz question.
   * @param {string} selectedAnswer - Selected answer string.
   * @param {Object} studentState - Centralized student state before answer.
   * @returns {Promise<{
   *   isCorrect: boolean,
   *   nextDifficulty: string,
   *   decision: Object,
   *   feedbackMessage: string,
   *   attemptData: Object,
   *   updatedState: Object,
   *   activeAgent: string
   * }>}
   */
  async processAssessmentResult(
    quizQuestion,
    selectedAnswer,
    studentState = {},
    metadata = {},
  ) {
    // Save prior mastery before recording attempt to compute real mastery gain (ΔM)
    const priorMastery =
      studentState.dktMastery?.average_mastery ??
      (studentState.accuracy ? studentState.accuracy / 100 : 0.5);

    // 1. Assessment Agent evaluates student answer with metadata
    const evaluation = this.assessmentAgent.evaluateAnswer(
      quizQuestion,
      selectedAnswer,
      studentState,
      {
        sessionId: metadata.sessionId,
        responseTimeSeconds: metadata.responseTimeSeconds,
        dktMastery: priorMastery,
        rlAction: metadata.rlAction || studentState.lastRLAction || studentState.selectedAction,
      },
    );

    // 2. Persist attempt into SQLite quiz_attempts table
    try {
      await this.assessmentAgent.recordAttempt(evaluation.attemptData);
    } catch (err) {
      console.error("Orchestrator: Error persisting attempt:", err);
    }

    // 3. Reload student history & trigger DKT LSTM inference with the new attempt included
    let progressState = studentState;
    try {
      const refreshed = await this.loadStudentProgress(studentState);
      if (refreshed.success && refreshed.updatedState) {
        progressState = refreshed.updatedState;
      }
    } catch (err) {
      console.warn("Orchestrator: Progress refresh notice:", err.message);
    }

    // 4. Adaptation Agent coordinates LSTM mastery prediction + Q-Learning decision
    const decision = await this.adaptationAgent.decideNextStep(
      progressState,
      {
        isCorrect: evaluation.isCorrect,
        correctAnswer: quizQuestion.correctAnswer,
        priorMastery,
      },
    );

    const finalState = {
      ...progressState,
      currentDifficulty: decision.nextDifficulty,
      difficulty: decision.nextDifficulty,
      pendingTargetTopic: decision.targetTopic || null,
      lastRLAction: decision.selectedRLAction || decision.qLearningMeta?.action,
      activeAgent: "Adaptation Agent",
      decisionReason: decision.reason,
      predictedMastery: decision.predictedMastery,
    };

    return {
      isCorrect: evaluation.isCorrect,
      nextDifficulty: decision.nextDifficulty,
      decision,
      feedbackMessage: decision.feedbackMessage,
      attemptData: evaluation.attemptData,
      updatedState: finalState,
      activeAgent: "Adaptation Agent",
    };
  }

  /**
   * Fetches real dataset analytics from the backend SQLite database.
   *
   * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
   */
  async fetchDatasetAnalytics() {
    return await this.assessmentAgent.fetchDatasetAnalytics();
  }

  /**
   * Gets the backend URL for exporting the dataset as CSV.
   *
   * @returns {string}
   */
  getExportDatasetUrl() {
    return this.assessmentAgent.getExportDatasetUrl();
  }

  /**
   * Retrieves a learning recommendation from the AdaptationAgent.
   *
   * @param {Object} studentState - Centralized student state.
   * @returns {Object} Structured decision.
   */
  getNextLearningDecision(studentState = {}) {
    return this.adaptationAgent.recommendLearningAction(studentState);
  }
}

// Export singleton instance for app-wide use, as well as class
export const orchestrator = new MultiAgentOrchestrator();
export default orchestrator;
