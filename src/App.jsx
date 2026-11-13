import "./App.css";
import Experience from "./components/Experience";
import { Chat } from "./components/chat/Chat";
import { DatasetAnalyticsModal } from "./components/DatasetAnalyticsModal";
import { orchestrator, qLearningAgent } from "./agents";
import { requestImmersiveVRSession, isWebXRAvailable } from "./utils/webxr";
import React from "react";

const subjects = ["Artificial Intelligence", "Machine Learning"];

const formatRLAction = (action) => {
  switch (action) {
    case "increase_difficulty":
      return "⬆️ Increase Difficulty";
    case "decrease_difficulty":
      return "⬇️ Decrease Difficulty";
    case "reinforce_weak_concept":
      return "🎯 Reinforce Weak Concept";
    case "maintain_difficulty":
    default:
      return "➡️ Maintain Difficulty";
  }
};

const App = () => {
  const sessionId = React.useMemo(() => {
    try {
      let id = sessionStorage.getItem("av_session_id");
      if (!id) {
        id = "student_" + Math.random().toString(36).slice(2, 9);
        sessionStorage.setItem("av_session_id", id);
      }
      return id;
    } catch {
      return "student_" + Math.random().toString(36).slice(2, 9);
    }
  }, []);

  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = React.useState(false);
  const [datasetAnalytics, setDatasetAnalytics] = React.useState(null);
  const [analyticsLoading, setAnalyticsLoading] = React.useState(false);
  const [questionStartTime, setQuestionStartTime] = React.useState(null);

  const [learningState, setLearningState] = React.useState(() =>
    orchestrator.createInitialStudentState({
      selectedSubject: "Artificial Intelligence",
      difficulty: "beginner",
      currentDifficulty: "beginner",
    }),
  );
  const [quizQuestion, setQuizQuestion] = React.useState(null);
  const [selectedOption, setSelectedOption] = React.useState("");
  const [quizFeedback, setQuizFeedback] = React.useState("");
  const [quizLoading, setQuizLoading] = React.useState(false);
  const [qTelemetry, setQTelemetry] = React.useState(() =>
    qLearningAgent.getTelemetry(),
  );
  const [activeAgent, setActiveAgent] = React.useState("Multi-Agent Loop Active");
  const [tutorHint, setTutorHint] = React.useState(null);
  const [tutorHintLoading, setTutorHintLoading] = React.useState(false);
  const [conceptExplanation, setConceptExplanation] = React.useState(null);
  const [conceptExplanationLoading, setConceptExplanationLoading] = React.useState(false);
  const [vrModalMessage, setVrModalMessage] = React.useState(null);
  const [showAllDKTTopics, setShowAllDKTTopics] = React.useState(false);
  const glRendererRef = React.useRef(null);

  const accuracy =
    learningState.questionsAnswered === 0
      ? 0
      : Math.round(
          (learningState.correctAnswers / learningState.questionsAnswered) *
            100,
        );

  React.useEffect(() => {
    const fetchProgress = async () => {
      try {
        const result = await orchestrator.loadStudentProgress();
        if (result.success && result.rawData) {
          const data = result.rawData;
          const totalQuestions = data.totalQuestions ?? 0;
          const correctAnswers = data.correctAnswers ?? 0;
          const calculatedAccuracy =
            totalQuestions === 0
              ? 0
              : Math.round((correctAnswers / totalQuestions) * 100);

          const latestDifficulty =
            data.recentAttempts && data.recentAttempts[0]?.difficulty
              ? data.recentAttempts[0].difficulty
              : "beginner";

          let hydratedState = null;
          setLearningState((currentState) => {
            hydratedState = {
              ...currentState,
              questionsAnswered: totalQuestions,
              correctAnswers: correctAnswers,
              accuracy: calculatedAccuracy,
              currentDifficulty: latestDifficulty,
              difficulty: latestDifficulty,
              recentAttempts: data.recentAttempts || [],
              subjectStats: data.subjectStats || {},
              weakConcepts: data.weakConcepts || [],
              weakTopic:
                data.weakTopic ||
                (totalQuestions > 0 ? "None (Clean streak)" : "No quiz data yet"),
              dktMastery: data.dktMastery || currentState.dktMastery || null,
            };
            return hydratedState;
          });

          // Seed Q-learning decision and telemetry from real SQLite history
          if (hydratedState) {
            const initialDecision =
              orchestrator.getNextLearningDecision(hydratedState);
            if (initialDecision && initialDecision.qLearningMeta) {
              setQTelemetry(initialDecision.qLearningMeta);
              if (initialDecision.activeAgent) {
                setActiveAgent(initialDecision.activeAgent);
              }
            }
          }
        }
      } catch (error) {
        console.error("App: Error fetching student progress via Orchestrator:", error);
      }
    };

    fetchProgress();
  }, []);

  const generateQuizQuestion = React.useCallback(async (targetTopicOverride = null) => {
    setQuizLoading(true);
    setSelectedOption("");
    setQuizFeedback("");
    setTutorHint(null);
    setConceptExplanation(null);
    setActiveAgent("Assessment Agent (Generating Question)");

    try {
      const topicToTarget =
        targetTopicOverride || learningState.pendingTargetTopic || null;
      const result = await orchestrator.generateAssessment(
        learningState,
        topicToTarget,
      );

      if (!result.success || !result.question) {
        setQuizQuestion(null);
        setQuestionStartTime(null);
        setQuizFeedback(
          result.error || "Failed to generate quiz question. Please try again.",
        );
        setActiveAgent("Multi-Agent Loop Ready");
      } else {
        setQuizQuestion(result.question);
        setQuestionStartTime(Date.now());
        setActiveAgent("Assessment Agent");
        if (learningState.pendingTargetTopic) {
          setLearningState((prev) => ({
            ...prev,
            pendingTargetTopic: null,
          }));
        }
      }
    } catch (error) {
      console.error("App: Error generating quiz question via Orchestrator:", error);
      setQuizQuestion(null);
      setQuestionStartTime(null);
      setQuizFeedback(
        "Unable to connect to the quiz server. Please check your connection.",
      );
      setActiveAgent("Multi-Agent Loop Ready");
    }

    setQuizLoading(false);
  }, [learningState]);

  const submitQuizAnswer = async () => {
    if (!quizQuestion || !quizQuestion.correctAnswer) {
      return;
    }

    if (!selectedOption) {
      setQuizFeedback("Please select an answer before submitting.");
      return;
    }

    setActiveAgent("Adaptation Agent (Coordinating DKT & RL)");

    const responseTimeSeconds = questionStartTime
      ? Math.max(0.5, Math.round(((Date.now() - questionStartTime) / 1000) * 10) / 10)
      : null;

    try {
      const result = await orchestrator.processAssessmentResult(
        quizQuestion,
        selectedOption,
        learningState,
        {
          sessionId,
          responseTimeSeconds,
          dktMastery:
            learningState.predictedMastery ??
            learningState.dktMastery?.average_mastery ??
            null,
          rlAction:
            learningState.lastRLAction ||
            learningState.selectedAction ||
            qTelemetry.action ||
            null,
        },
      );

      setQuizFeedback(result.feedbackMessage);
      setLearningState(result.updatedState);
      setActiveAgent("Adaptation Agent");

      if (result.decision?.qLearningMeta) {
        setQTelemetry(result.decision.qLearningMeta);
      } else {
        setQTelemetry(qLearningAgent.getTelemetry());
      }
    } catch (error) {
      console.error("App: Error processing quiz answer via Orchestrator:", error);
      setQuizFeedback("An error occurred while evaluating your answer.");
      setActiveAgent("Multi-Agent Loop Ready");
    }
  };

  const loadDatasetAnalytics = React.useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await orchestrator.fetchDatasetAnalytics();
      if (res.success && res.data) {
        setDatasetAnalytics(res.data);
      }
    } catch (err) {
      console.warn("Could not load dataset analytics:", err);
    }
    setAnalyticsLoading(false);
  }, []);

  const handleExportDataset = React.useCallback(() => {
    const exportUrl = orchestrator.getExportDatasetUrl();
    const link = document.createElement("a");
    link.href = exportUrl;
    link.setAttribute("download", "student_performance.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleRequestHint = async () => {
    if (!quizQuestion) return;
    setTutorHintLoading(true);
    setActiveAgent("Tutor Agent (Providing Hint)");

    try {
      const hintResult = await orchestrator.provideHint(quizQuestion, learningState);
      setTutorHint(hintResult.response || "Think carefully about the key definitions.");
      setActiveAgent("Tutor Agent");
    } catch (err) {
      setTutorHint("Consider which option directly addresses the fundamental mechanism.");
      setActiveAgent("Tutor Agent");
    }
    setTutorHintLoading(false);
  };

  const handleRequestExplanation = async () => {
    const topic = quizQuestion?.topic || learningState.pendingTargetTopic || learningState.weakTopic || "Core Concepts";
    setConceptExplanationLoading(true);
    setActiveAgent("Tutor Agent (Explaining Concept)");

    try {
      const expResult = await orchestrator.explainConcept(topic, learningState);
      setConceptExplanation(expResult.response || `Explanation for ${topic}: Review core principles to solidify understanding.`);
      setActiveAgent("Tutor Agent");
    } catch (err) {
      setConceptExplanation(`Concept Overview: Focus on foundational principles to build systematic mastery.`);
      setActiveAgent("Tutor Agent");
    }
    setConceptExplanationLoading(false);
  };

  const handleEnterVR = async () => {
    const sessionResult = await requestImmersiveVRSession(
      glRendererRef.current,
    );
    if (!sessionResult.success) {
      setVrModalMessage(
        sessionResult.message ||
          "Immersive VR is unavailable on this device. Desktop VR Simulation is active.",
      );
    }
  };

  // Keyboard shortcut listener
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore when user is actively typing in a text field
      if (
        e.target &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
      ) {
        return;
      }

      if (e.key === "t" || e.key === "T") {
        setIsChatOpen((prev) => !prev);
      } else if (e.key === "q" || e.key === "Q") {
        generateQuizQuestion();
      } else if (e.key === "d" || e.key === "D") {
        loadDatasetAnalytics();
        setIsAnalyticsOpen((prev) => !prev);
      } else if (e.key === "v" || e.key === "V") {
        handleEnterVR();
      } else if (e.key === "Escape") {
        setVrModalMessage(null);
        setIsChatOpen(false);
        setIsAnalyticsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [generateQuizQuestion, loadDatasetAnalytics]);

  const activeDifficulty =
    learningState.difficulty || learningState.currentDifficulty || "beginner";
  const formattedDifficulty =
    activeDifficulty.charAt(0).toUpperCase() + activeDifficulty.slice(1);

  const dktMastery = learningState.dktMastery || null;
  const activeQuestionTopic = quizQuestion?.topic;
  const activeQuestionDKTProb =
    dktMastery?.topic_mastery && activeQuestionTopic && dktMastery.topic_mastery[activeQuestionTopic] !== undefined
      ? Math.round(dktMastery.topic_mastery[activeQuestionTopic] * 100)
      : null;

  const topicEntries = React.useMemo(() => {
    if (!dktMastery?.topic_mastery) return [];
    return Object.entries(dktMastery.topic_mastery);
  }, [dktMastery]);

  const displayTopics = React.useMemo(() => {
    if (topicEntries.length === 0) return [];
    if (showAllDKTTopics) return topicEntries;
    const sorted = [...topicEntries].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 5);
  }, [topicEntries, showAllDKTTopics]);

  return (
    <div className="app-viewport">
      {/* Primary 3D Virtual Classroom View */}
      <Experience
        learningState={learningState}
        qTelemetry={qTelemetry}
        onOpenChat={() => setIsChatOpen(true)}
        onGenerateQuiz={generateQuizQuestion}
        quizLoading={quizLoading}
        onCanvasCreated={(gl) => {
          glRendererRef.current = gl;
        }}
        quizQuestion={quizQuestion}
        selectedOption={selectedOption}
        onSelectOption={(opt) => {
          setSelectedOption(opt);
          setQuizFeedback("");
        }}
        onSubmitAnswer={submitQuizAnswer}
        quizFeedback={quizFeedback}
      />

      {/* Transparent HUD Container: z-index: 10 */}
      <main className="main-hud">
        {/* Top Glassmorphism Navigation Bar */}
        <div className="top-banner">
          <div className="top-banner-brand">
            <span>🎓</span> ADAPTIVEVERSE
          </div>
          <div className="top-banner-badges">
            <span className="top-badge badge-desktop">● Desktop 3D Mode</span>
            <span className="top-badge badge-rl">● Q-Learning Active</span>
            <span className="top-badge badge-webxr">
              ● {isWebXRAvailable() ? "WebXR Detected" : "WebXR Ready"}
            </span>
          </div>
          <div className="top-banner-actions">
            <div className="top-hotkeys-hint">
              <span><kbd>Q</kbd> Quiz</span>
              <span><kbd>T</kbd> Chat</span>
              <span><kbd>D</kbd> Data</span>
              <span><kbd>V</kbd> VR</span>
            </div>
            <button
              type="button"
              className="dataset-analytics-btn"
              onClick={() => {
                loadDatasetAnalytics();
                setIsAnalyticsOpen(true);
              }}
              title="Open student performance dataset & analytics"
            >
              📊 DATASET & ANALYTICS (D)
            </button>
            <button
              type="button"
              className="enter-vr-button"
              onClick={handleEnterVR}
            >
              🥽 ENTER VR (V)
            </button>
          </div>
        </div>

        {/* Left Glassmorphism Learning HUD */}
        <aside className="left-hud-panel">
          {/* Prominent Floating Ask Teacher Button */}
          <button
            type="button"
            className="ask-teacher-btn"
            onClick={() => setIsChatOpen(true)}
          >
            <span>💬</span> Ask Teacher (T)
          </button>

          {/* Subject Card */}
          <div className="hud-card subject-card">
            <p className="subject-card-title">SUBJECT</p>
            <div className="subject-options">
              {subjects.map((subject) => (
                <button
                  key={subject}
                  className={`subject-option ${
                    learningState.selectedSubject === subject ? "active" : ""
                  }`}
                  type="button"
                  onClick={() =>
                    setLearningState((currentState) => ({
                      ...currentState,
                      selectedSubject: subject,
                    }))
                  }
                >
                  {subject}
                </button>
              ))}
            </div>
          </div>

          {/* Adaptive Quiz Card */}
          <div className="hud-card quiz-card">
            <div className="quiz-card-header">
              <span className="quiz-card-title">ADAPTIVE QUIZ</span>
              <button
                className="quiz-generate-btn"
                type="button"
                onClick={generateQuizQuestion}
                disabled={quizLoading}
              >
                {quizLoading ? "Generating..." : "⚡ Generate (Q)"}
              </button>
            </div>

            {quizQuestion && Array.isArray(quizQuestion.options) && (
              <div className="quiz-content-area">
                {/* Current Question Meta: Subject + Topic + Difficulty */}
                <div className="quiz-question-meta">
                  <span className="quiz-meta-tag meta-subject">
                    📚 {quizQuestion.subject || learningState.selectedSubject}
                  </span>
                  <span className="quiz-meta-tag meta-topic">
                    🎯 {quizQuestion.topic || "Core Fundamentals"}
                  </span>
                  <span
                    className={`quiz-meta-tag meta-difficulty diff-${(
                      quizQuestion.difficulty || activeDifficulty
                    ).toLowerCase()}`}
                  >
                    ⚡ {quizQuestion.difficulty || formattedDifficulty}
                  </span>
                  {activeQuestionDKTProb !== null && (
                    <span className="quiz-meta-tag meta-dkt">
                      🧠 DKT: {activeQuestionDKTProb}%
                    </span>
                  )}
                </div>

                <p className="quiz-question-text">{quizQuestion.question}</p>
                <div className="quiz-options-grid">
                  {quizQuestion.options.slice(0, 4).map((option) => (
                    <button
                      key={option}
                      className={`quiz-opt-btn ${
                        selectedOption === option ? "active" : ""
                      }`}
                      type="button"
                      onClick={() => {
                        setSelectedOption(option);
                        setQuizFeedback("");
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <button
                  className="quiz-submit-action"
                  type="button"
                  onClick={submitQuizAnswer}
                >
                  Submit Answer
                </button>

                {/* Tutor Agent Interactive Helpers: Hints & Concept Explanations */}
                <div className="quiz-tutor-helpers">
                  <button
                    type="button"
                    className="quiz-tutor-btn hint-btn"
                    onClick={handleRequestHint}
                    disabled={tutorHintLoading}
                    title="Ask Teacher Emilian for a gentle pedagogical hint"
                  >
                    {tutorHintLoading ? "🧠 Generating Hint..." : "💡 Get Hint"}
                  </button>
                  <button
                    type="button"
                    className="quiz-tutor-btn explain-btn"
                    onClick={handleRequestExplanation}
                    disabled={conceptExplanationLoading}
                    title="Ask Teacher Emilian to explain this concept"
                  >
                    {conceptExplanationLoading ? "📖 Explaining..." : "📖 Explain Concept"}
                  </button>
                </div>

                {tutorHint && (
                  <div className="quiz-tutor-box hint-box">
                    <div className="quiz-tutor-box-header">
                      <span>💡 Teacher Emilian&apos;s Hint</span>
                      <button
                        type="button"
                        className="tutor-box-close"
                        onClick={() => setTutorHint(null)}
                      >
                        ✕
                      </button>
                    </div>
                    <p className="quiz-tutor-box-text">{tutorHint}</p>
                  </div>
                )}

                {conceptExplanation && (
                  <div className="quiz-tutor-box explain-box">
                    <div className="quiz-tutor-box-header">
                      <span>📖 Pedagogical Explanation</span>
                      <button
                        type="button"
                        className="tutor-box-close"
                        onClick={() => setConceptExplanation(null)}
                      >
                        ✕
                      </button>
                    </div>
                    <p className="quiz-tutor-box-text">{conceptExplanation}</p>
                  </div>
                )}

                {quizFeedback && (
                  <div className="quiz-feedback-box">{quizFeedback}</div>
                )}
              </div>
            )}

            {!quizQuestion && quizFeedback && (
              <div className="quiz-feedback-box">{quizFeedback}</div>
            )}
          </div>

          {/* Compact Learning Profile Panel */}
          <div className="hud-card learning-profile-card">
            <div className="profile-card-header">
              <span className="profile-card-title">👤 LEARNING PROFILE</span>
              <span className="profile-count-pill">
                {learningState.questionsAnswered} attempts
              </span>
            </div>

            <div className="profile-stats-grid">
              <div className="profile-stat-box">
                <span className="profile-stat-label">Overall Accuracy</span>
                <span className="profile-stat-val val-accuracy">{accuracy}%</span>
                <span className="profile-stat-sub">
                  ({learningState.correctAnswers}/{learningState.questionsAnswered} correct)
                </span>
              </div>
              <div className="profile-stat-box">
                <span className="profile-stat-label">Current Difficulty</span>
                <span className={`profile-stat-val val-diff diff-${activeDifficulty}`}>
                  {formattedDifficulty}
                </span>
                <span className="profile-stat-sub">Adaptive tier</span>
              </div>
            </div>

            {/* Direct Dataset Export & Analytics Trigger */}
            <div className="profile-dataset-export-row">
              <button
                type="button"
                className="profile-export-btn"
                onClick={handleExportDataset}
                title="Download real student performance records as CSV"
              >
                📥 Export Dataset (.CSV)
              </button>
              <button
                type="button"
                className="profile-analytics-link-btn"
                onClick={() => {
                  loadDatasetAnalytics();
                  setIsAnalyticsOpen(true);
                }}
                title="View in-depth performance analytics"
              >
                📊 Analytics
              </button>
            </div>

            {/* Real Subject Performance breakdown from SQLite */}
            <div className="profile-subject-section">
              <div className="profile-section-heading">Subject Performance</div>
              <div className="profile-subject-list">
                {subjects.map((subj) => {
                  const stats = learningState.subjectStats?.[subj] || {
                    total: 0,
                    correct: 0,
                    accuracy: 0,
                  };
                  const isCurrent = learningState.selectedSubject === subj;
                  const label = subj === "Artificial Intelligence" ? "AI" : "ML";
                  return (
                    <div
                      key={subj}
                      className={`profile-subj-row ${isCurrent ? "active-subj" : ""}`}
                    >
                      <span className="profile-subj-name">{label}</span>
                      <div className="profile-progress-bar">
                        <div
                          className="profile-progress-fill"
                          style={{
                            width: `${stats.total > 0 ? stats.accuracy : 0}%`,
                          }}
                        />
                      </div>
                      <span className="profile-subj-stats">
                        {stats.total > 0
                          ? `${stats.accuracy}% (${stats.correct}/${stats.total})`
                          : "0% (0)"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Real Weak Topic / Concept from SQLite */}
            <div className="profile-weak-section">
              <div className="profile-section-heading">Weak Topic / Concept</div>
              <div className="profile-weak-badge">
                <span className="weak-bullet">●</span>
                <span className="weak-text">
                  {learningState.weakTopic || "No quiz data yet"}
                </span>
              </div>
            </div>
          </div>

          {/* Deep Knowledge Tracing (DKT) Topic Mastery Card */}
          <div className="hud-card dkt-card">
            <div className="dkt-card-header">
              <div className="dkt-card-title-group">
                <span className="dkt-card-title">🧠 TOPIC MASTERY (DKT)</span>
                <span className="dkt-model-badge">PyTorch LSTM</span>
              </div>
              <span
                className={`dkt-status-pill ${
                  dktMastery?.is_cold_start ? "pill-prior" : "pill-traced"
                }`}
              >
                {dktMastery?.is_cold_start
                  ? "Baseline Prior"
                  : `${dktMastery?.realAttemptsCount ?? learningState.questionsAnswered} Traced`}
              </span>
            </div>

            <div className="dkt-summary-grid">
              <div className="dkt-stat-box">
                <span className="dkt-stat-label">Next P(Correct)</span>
                <span className="dkt-stat-val val-dkt-prob">
                  {Math.round((dktMastery?.predicted_next_prob ?? 0.5) * 100)}%
                </span>
                <span className="dkt-stat-sub">
                  {activeQuestionDKTProb !== null
                    ? `Current topic: ${activeQuestionDKTProb}%`
                    : "Curriculum model"}
                </span>
              </div>
              <div className="dkt-stat-box">
                <span className="dkt-stat-label">Average Mastery</span>
                <span className="dkt-stat-val val-dkt-avg">
                  {Math.round((dktMastery?.average_mastery ?? 0.5) * 100)}%
                </span>
                <span className="dkt-stat-sub">
                  Focus:{" "}
                  {dktMastery?.weakest_concept
                    ? dktMastery.weakest_concept.split(" ")[0]
                    : "None"}
                </span>
              </div>
            </div>

            <div className="dkt-provenance-note">
              <span className="dkt-note-icon">ℹ️</span>
              <span className="dkt-note-text">
                {dktMastery?.is_cold_start
                  ? "Pre-trained on synthetic educational benchmark. Real quiz attempts will personalize knowledge state."
                  : `Traced from ${
                      dktMastery?.realAttemptsCount ??
                      learningState.questionsAnswered
                    } real student attempts in SQLite.`}
              </span>
            </div>

            {/* Estimated Topic Mastery Bars */}
            {displayTopics.length > 0 && (
              <div className="dkt-mastery-list">
                <div className="dkt-section-heading">
                  <span>Concept Mastery Breakdown</span>
                  <button
                    type="button"
                    className="dkt-toggle-btn"
                    onClick={() => setShowAllDKTTopics(!showAllDKTTopics)}
                  >
                    {showAllDKTTopics ? "Top 5" : "All (20)"}
                  </button>
                </div>

                <div className="dkt-topics-scroll">
                  {displayTopics.map(([topic, score]) => {
                    const pct = Math.round(score * 100);
                    const isCurrentTopic = quizQuestion?.topic === topic;
                    const tierClass =
                      pct >= 70
                        ? "mastery-high"
                        : pct >= 50
                          ? "mastery-med"
                          : "mastery-low";
                    return (
                      <div
                        key={topic}
                        className={`dkt-topic-row ${
                          isCurrentTopic ? "active-quiz-topic" : ""
                        }`}
                      >
                        <div className="dkt-topic-info">
                          <span className="dkt-topic-name">
                            {isCurrentTopic && "🎯 "}
                            {topic}
                          </span>
                          <span className={`dkt-topic-pct ${tierClass}`}>
                            {pct}%
                          </span>
                        </div>
                        <div className="dkt-topic-bar-bg">
                          <div
                            className={`dkt-topic-bar-fill ${tierClass}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Right Glassmorphism Adaptive RL & Decision Panel */}
        {/* Right Glassmorphism Adaptive RL & Decision Panel */}
        <aside className="rl-panel">
          <div className="rl-panel-header">
            <span className="rl-panel-title">🤖 PERSONALIZED LEARNING LOOP</span>
            <span className="rl-active-badge">● Phase 3 Active</span>
          </div>

          {/* Compact Section: Predicted Topic Mastery, Selected RL Action, Active Agent, Selection Rationale */}
          <div className="learning-loop-card">
            <div className="loop-items-grid">
              {/* 1. Active Agent */}
              <div className="loop-row">
                <span className="loop-label">Active Agent:</span>
                <span className="loop-val loop-agent-badge">
                  {activeAgent.includes("Assessment") && "📝 "}
                  {activeAgent.includes("Adaptation") && "🤖 "}
                  {activeAgent.includes("Tutor") && "👩‍🏫 "}
                  {!activeAgent.includes("Assessment") && !activeAgent.includes("Adaptation") && !activeAgent.includes("Tutor") && "🔄 "}
                  {activeAgent}
                </span>
              </div>

              {/* 2. Selected RL Action */}
              <div className="loop-row">
                <span className="loop-label">Selected RL Action:</span>
                <div className="loop-val loop-action-container">
                  <span className="loop-action-pill">
                    {formatRLAction(qTelemetry.action)}
                  </span>
                  {qTelemetry.targetTopic && (
                    <span className="loop-target-pill">
                      🎯 {qTelemetry.targetTopic}
                    </span>
                  )}
                </div>
              </div>

              {/* 3. Predicted Topic Mastery */}
              <div className="loop-row mastery-row">
                <div className="loop-mastery-header">
                  <span className="loop-label">Predicted Mastery:</span>
                  <span className="loop-mastery-score">
                    {activeQuestionDKTProb !== null
                      ? `${activeQuestionDKTProb}%`
                      : `${Math.round((dktMastery?.average_mastery ?? 0.5) * 100)}%`}
                    <span className="loop-mastery-scope">
                      ({activeQuestionTopic || dktMastery?.weakest_concept || "Curriculum avg"})
                    </span>
                  </span>
                </div>
                <div className="loop-mastery-bar-bg">
                  <div
                    className="loop-mastery-bar-fill"
                    style={{
                      width: `${
                        activeQuestionDKTProb !== null
                          ? activeQuestionDKTProb
                          : Math.round((dktMastery?.average_mastery ?? 0.5) * 100)
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* 4. Why Next Activity Was Selected */}
              <div className="loop-reason-box">
                <div className="loop-reason-title">Why Next Activity Was Selected:</div>
                <p className="loop-reason-text">
                  &ldquo;
                  {qTelemetry.reason ||
                    learningState.decisionReason ||
                    `Maintain ${formattedDifficulty} — consolidating mastery within Zone of Proximal Development.`}
                  &rdquo;
                </p>
              </div>
            </div>
          </div>

          {/* Adaptive Decision Telemetry */}
          <div className="adaptive-decision-box">
            <div className="decision-header">
              <span className="decision-title">🧠 RL POLICY TELEMETRY</span>
              <span className="decision-action-pill">
                {(qTelemetry.action || "maintain_difficulty").replace(/_/g, " ")}
              </span>
            </div>

            <div className="decision-meta-grid">
              <div className="decision-row">
                <span className="decision-label">Learner State (s):</span>
                <code className="decision-code">{qTelemetry.state || "init"}</code>
              </div>
              <div className="decision-row">
                <span className="decision-label">Reward (r):</span>
                <span
                  className={
                    (qTelemetry.reward ?? 0) >= 0
                      ? "rl-reward-pos"
                      : "rl-reward-neg"
                  }
                >
                  {(qTelemetry.reward ?? 0) >= 0
                    ? `+${qTelemetry.reward ?? 0}`
                    : qTelemetry.reward}
                </span>
              </div>
              <div className="decision-row">
                <span className="decision-label">Q-Value Q(s,a):</span>
                <span className="decision-val-q">
                  {Number(qTelemetry.qValue ?? 0).toFixed(4)}
                </span>
              </div>
            </div>
          </div>

          {/* Compact RL Telemetry */}
          <div className="rl-telemetry-compact">
            <div className="rl-row">
              <span className="rl-label">Engine:</span>
              <span className="rl-val">
                PyTorch LSTM + Q-Learning
                {qTelemetry.dktActive && (
                  <span className="rl-dkt-badge">● DKT Traced</span>
                )}
              </span>
            </div>
            <div className="rl-row">
              <span className="rl-label">Exploration (ε):</span>
              <span className="rl-val">
                {Math.round((qTelemetry.epsilon ?? 0.15) * 100)}%
              </span>
            </div>
            <div className="rl-row">
              <span className="rl-label">State Encoding:</span>
              <span className="rl-val rl-format-hint">
                diff:mastery:result:struggle
              </span>
            </div>
          </div>
        </aside>
      </main>

      {/* WebXR Fallback Modal */}
      {vrModalMessage && (
        <div
          className="vr-modal-backdrop"
          onClick={() => setVrModalMessage(null)}
        >
          <div className="vr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vr-modal-icon">🥽</div>
            <h3 className="vr-modal-title">WebXR Status</h3>
            <p className="vr-modal-text">{vrModalMessage}</p>
            <button
              type="button"
              className="vr-modal-btn"
              onClick={() => setVrModalMessage(null)}
            >
              Continue in Desktop Simulation
            </button>
          </div>
        </div>
      )}

      {/* Tutor Agent Interactive Chatbox */}
      <Chat
        learningState={learningState}
        isOpen={isChatOpen}
        onToggle={(val) => setIsChatOpen(val)}
      />

      {/* Student Performance Dataset & Real-Time Analytics Modal */}
      <DatasetAnalyticsModal
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        analytics={datasetAnalytics}
        loading={analyticsLoading}
        onRefresh={loadDatasetAnalytics}
        onExportCsv={handleExportDataset}
        sessionId={sessionId}
        totalAttemptsCount={learningState.questionsAnswered}
      />
    </div>
  );
};

export default App;
