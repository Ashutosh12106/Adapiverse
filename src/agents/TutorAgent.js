/**
 * TutorAgent - Responsible for pedagogical interaction, instructional dialogue,
 * and personalizing explanations using student learning state and context.
 *
 * Communicates with the backend proxy without exposing API keys to the frontend.
 */
export class TutorAgent {
  constructor(baseUrl = "http://localhost:3001") {
    this.baseUrl = baseUrl;
    this.sessionHistory = [];
  }

  /**
   * Generates a personalized tutoring response for the student.
   *
   * @param {string} studentQuestion - The question or message from the student.
   * @param {Object} studentState - The centralized student state.
   * @returns {Promise<{ success: boolean, response: string, error?: string, isFallback?: boolean }>}
   */
  async askQuestion(studentQuestion, studentState = {}) {
    if (!studentQuestion || typeof studentQuestion !== "string" || !studentQuestion.trim()) {
      return {
        success: false,
        response: "Please enter a valid question or message.",
        error: "Empty question",
      };
    }

    const difficulty =
      studentState.currentDifficulty || studentState.difficulty || "beginner";
    const subject = studentState.selectedSubject || "Artificial Intelligence";
    const predictedMastery =
      studentState.dktMastery?.average_mastery ??
      (studentState.accuracy ? studentState.accuracy / 100 : 0.5);
    const recentMistakes = Array.isArray(studentState.recentAttempts)
      ? studentState.recentAttempts.filter((a) => !a.isCorrect).slice(0, 3)
      : [];
    const rlAction = studentState.lastRLAction || studentState.selectedAction || null;
    const rlReason = studentState.decisionReason || null;
    const topic = studentState.pendingTargetTopic || studentState.weakTopic || null;

    const payload = {
      message: studentQuestion.trim(),
      selectedSubject: subject,
      difficulty,
      topic,
      predictedMastery,
      recentMistakes,
      rlAction,
      rlReason,
      intent: "chat",
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/chatgpt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error ||
          "Teacher AI is temporarily unavailable. Check the Gemini API configuration or model availability.";
        console.error("TutorAgent API Error:", errorMessage);

        return {
          success: false,
          response: errorMessage,
          error: errorMessage,
        };
      }

      const data = await response.json();
      const tutorText =
        data.response || "I'm sorry, I could not generate an explanation at this time.";

      this.sessionHistory.push({
        user: studentQuestion.trim(),
        bot: tutorText,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        response: tutorText,
        isFallback: Boolean(data.isFallback),
      };
    } catch (error) {
      console.error("TutorAgent Network Error:", error);
      return {
        success: false,
        response:
          "Unable to connect to the AdaptiveVerse backend. Make sure the backend is running on port 3001.",
        error: error.message || "Network error",
      };
    }
  }

  /**
   * Generates a concept explanation tailored to the learner's estimated knowledge.
   *
   * @param {string} concept - Target concept to explain.
   * @param {Object} studentState - Centralized student state.
   * @returns {Promise<{ success: boolean, response: string, error?: string, isFallback?: boolean }>}
   */
  async explainConcept(concept, studentState = {}) {
    const focusConcept = concept || studentState.pendingTargetTopic || studentState.weakTopic || "Core Concepts";
    const difficulty = studentState.currentDifficulty || studentState.difficulty || "beginner";
    const subject = studentState.selectedSubject || "Artificial Intelligence";
    const predictedMastery =
      studentState.dktMastery?.average_mastery ??
      (studentState.accuracy ? studentState.accuracy / 100 : 0.5);
    const topicMastery = studentState.dktMastery?.topic_mastery?.[focusConcept] ?? null;
    const rlAction = studentState.lastRLAction || studentState.selectedAction || null;

    const payload = {
      message: `Explain the concept "${focusConcept}" in ${subject} at the ${difficulty} level.`,
      selectedSubject: subject,
      difficulty,
      topic: focusConcept,
      predictedMastery: topicMastery !== null ? topicMastery : predictedMastery,
      recentMistakes: Array.isArray(studentState.recentAttempts)
        ? studentState.recentAttempts.filter((a) => !a.isCorrect).slice(0, 3)
        : [],
      rlAction,
      intent: "explain",
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/chatgpt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return {
          success: false,
          response: errData.error || "Could not retrieve concept explanation.",
        };
      }

      const data = await response.json();
      return {
        success: true,
        response: data.response,
        isFallback: Boolean(data.isFallback),
      };
    } catch (error) {
      console.error("TutorAgent explainConcept error:", error);
      return {
        success: false,
        response: `Concept Explanation for ${focusConcept}: Review foundational definitions and practice sample questions to build mastery.`,
        error: error.message,
      };
    }
  }

  /**
   * Generates a pedagogical hint for an active quiz question calibrated to learner knowledge.
   *
   * @param {Object} quizQuestion - Active quiz question object.
   * @param {Object} studentState - Centralized student state.
   * @returns {Promise<{ success: boolean, response: string, error?: string, isFallback?: boolean }>}
   */
  async provideHint(quizQuestion = {}, studentState = {}) {
    const questionText = quizQuestion.question || "this concept";
    const topic = quizQuestion.topic || "Core Fundamentals";
    const difficulty = studentState.currentDifficulty || studentState.difficulty || "beginner";
    const subject = studentState.selectedSubject || "Artificial Intelligence";

    const payload = {
      message: `Give me a pedagogical hint for this multiple choice question: "${questionText}". Do not directly reveal the answer.`,
      selectedSubject: subject,
      difficulty,
      topic,
      predictedMastery: studentState.dktMastery?.average_mastery ?? 0.5,
      intent: "hint",
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/chatgpt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return {
          success: false,
          response: errData.error || "Hint is temporarily unavailable.",
        };
      }

      const data = await response.json();
      return {
        success: true,
        response: data.response,
        isFallback: Boolean(data.isFallback),
      };
    } catch (error) {
      console.error("TutorAgent provideHint error:", error);
      return {
        success: false,
        response: `Hint for "${topic}": Focus on the primary definition and rule out options that introduce unrelated mechanisms.`,
        error: error.message,
      };
    }
  }

  /**
   * Retrieves conversation history recorded by this agent in the current session.
   */
  getHistory() {
    return [...this.sessionHistory];
  }

  /**
   * Clears the current session history.
   */
  clearHistory() {
    this.sessionHistory = [];
  }
}

export default TutorAgent;
