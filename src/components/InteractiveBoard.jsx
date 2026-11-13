import { useState } from "react";
import PropTypes from "prop-types";
import { Html } from "@react-three/drei";

/**
 * InteractiveBoard - 3D Classroom Smartboard
 *
 * Sized and positioned on the front teaching wall above the teacher podium.
 * Displays live curriculum context, Q-learning telemetry, and supports interactive quiz participation.
 */
export const InteractiveBoard = ({
  learningState,
  qTelemetry,
  onGenerateQuiz,
  quizLoading,
  onOpenChat,
  quizQuestion,
  selectedOption,
  onSelectOption,
  onSubmitAnswer,
  quizFeedback,
}) => {
  const [hovered, setHovered] = useState(false);

  const subject = learningState?.selectedSubject || "Artificial Intelligence";
  const difficulty =
    learningState?.difficulty || learningState?.currentDifficulty || "beginner";
  const accuracy = learningState?.accuracy ?? 0;
  const questionsAnswered = learningState?.questionsAnswered ?? 0;
  const correctAnswers = learningState?.correctAnswers ?? 0;
  const qState = qTelemetry?.state || "init";
  const qAction = qTelemetry?.action || "none";
  const qReward = qTelemetry?.reward ?? 0;

  const dktMastery = learningState?.dktMastery || null;
  const dktNextProb = dktMastery
    ? Math.round((dktMastery.predicted_next_prob ?? 0.5) * 100)
    : null;
  const questionTopic = quizQuestion?.topic;
  const questionDKTProb =
    dktMastery?.topic_mastery && questionTopic && dktMastery.topic_mastery[questionTopic] !== undefined
      ? Math.round(dktMastery.topic_mastery[questionTopic] * 100)
      : dktNextProb;

  return (
    <group position={[3.5, 0.5, -14.5]} rotation={[0, -0.22, 0]}>
      {/* 3D Smartboard Outer Metallic Frame */}
      <mesh
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[6.2, 4.2, 0.14]} />
        <meshStandardMaterial
          color={hovered ? "#0284c7" : "#0f172a"}
          roughness={0.25}
          metalness={0.7}
        />
      </mesh>

      {/* 3D Smartboard Screen Display Surface */}
      <mesh position={[0, 0, 0.08]}>
        <planeGeometry args={[6.0, 4.0]} />
        <meshBasicMaterial color="#0b1329" />
      </mesh>

      {/* Interactive 3D Digital Screen Interface */}
      <Html
        transform
        distanceFactor={5.2}
        position={[0, 0, 0.1]}
        className="interactive-3d-board"
        style={{ pointerEvents: "auto" }}
      >
        <div
          style={{
            width: "480px",
            padding: "20px",
            background: "rgba(11, 19, 41, 0.95)",
            border: `2px solid ${hovered ? "#38bdf8" : "#0284c7"}`,
            borderRadius: "18px",
            color: "#ffffff",
            fontFamily: "system-ui, -apple-system, sans-serif",
            boxShadow: "0 0 35px rgba(2, 132, 199, 0.35)",
            userSelect: "none",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #1e293b",
              paddingBottom: "10px",
              marginBottom: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "18px" }}>🖥️</span>
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: "800",
                  letterSpacing: "0.5px",
                  color: "#38bdf8",
                }}
              >
                CLASSROOM SMARTBOARD
              </span>
            </div>
            <span
              style={{
                fontSize: "11px",
                background: "#0284c7",
                color: "#ffffff",
                padding: "3px 8px",
                borderRadius: "12px",
                fontWeight: "700",
              }}
            >
              VR ACTIVE
            </span>
          </div>

          {/* Curriculum & Reinforcement Learning Telemetry */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
              fontSize: "13px",
              lineHeight: "1.5",
              color: "#cbd5e1",
              background: "rgba(15, 23, 42, 0.6)",
              padding: "10px",
              borderRadius: "10px",
              border: "1px solid #1e293b",
            }}
          >
            <div>
              <strong style={{ color: "#94a3b8" }}>Subject:</strong>
              <div style={{ color: "#f8fafc", fontWeight: "700" }}>{subject}</div>
            </div>
            <div>
              <strong style={{ color: "#94a3b8" }}>Difficulty:</strong>
              <div
                style={{
                  color:
                    difficulty === "advanced"
                      ? "#f43f5e"
                      : difficulty === "intermediate"
                        ? "#fbbf24"
                        : "#34d399",
                  fontWeight: "800",
                  textTransform: "capitalize",
                }}
              >
                {difficulty}
              </div>
            </div>
            <div>
              <strong style={{ color: "#94a3b8" }}>Performance:</strong>
              <div style={{ color: "#f8fafc", fontWeight: "700" }}>
                {accuracy}% ({correctAnswers}/{questionsAnswered})
              </div>
            </div>
            <div>
              <strong style={{ color: "#94a3b8" }}>RL Policy Action:</strong>
              <div style={{ color: "#38bdf8", fontWeight: "700", textTransform: "capitalize" }}>
                {(qAction || "none").replace(/_/g, " ")}
              </div>
            </div>
          </div>

          {/* Weak concept / Target concept indicator */}
          <div
            style={{
              marginTop: "6px",
              fontSize: "11px",
              color: "#cbd5e1",
              background: "rgba(30, 41, 59, 0.5)",
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ color: "#94a3b8" }}>
              {qTelemetry?.targetTopic ? "RL Target Concept:" : "Weak Concept:"}
            </span>
            <span style={{ color: "#fbbf24", fontWeight: "700" }}>
              {qTelemetry?.targetTopic || learningState?.weakTopic || "None yet"}
            </span>
          </div>

          <div
            style={{
              marginTop: "6px",
              fontSize: "11px",
              color: "#94a3b8",
              display: "flex",
              justifyContent: "space-between",
              padding: "2px 8px",
            }}
          >
            <span>
              <strong>State:</strong> <code style={{ fontSize: "10px" }}>{qState}</code>
            </span>
            <span>
              <strong>Q-Val:</strong>{" "}
              <span style={{ color: "#c084fc", fontWeight: "700" }}>
                {Number(qTelemetry?.qValue ?? 0).toFixed(3)}
              </span>{" "}
              <strong>Reward:</strong>{" "}
              <span
                style={{
                  color: qReward >= 0 ? "#34d399" : "#f43f5e",
                  fontWeight: "800",
                }}
              >
                {qReward >= 0 ? `+${qReward}` : qReward}
              </span>
            </span>
          </div>

          {/* Deep Knowledge Tracing (DKT) Telemetry on Board */}
          {dktMastery && (
            <div
              style={{
                marginTop: "6px",
                fontSize: "11px",
                color: "#cbd5e1",
                background: "rgba(30, 41, 59, 0.6)",
                padding: "6px 8px",
                borderRadius: "8px",
                border: "1px solid rgba(168, 85, 247, 0.25)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "4px",
                }}
              >
                <span
                  style={{
                    color: "#c084fc",
                    fontWeight: "800",
                    fontSize: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  🧠 DKT KNOWLEDGE TRACING
                </span>
                <span
                  style={{
                    fontSize: "9px",
                    background: dktMastery.is_cold_start
                      ? "rgba(100, 116, 139, 0.3)"
                      : "rgba(168, 85, 247, 0.25)",
                    color: dktMastery.is_cold_start ? "#94a3b8" : "#e9d5ff",
                    padding: "1px 6px",
                    borderRadius: "6px",
                    fontWeight: "700",
                  }}
                >
                  {dktMastery.is_cold_start
                    ? "Baseline Prior"
                    : `Traced (${dktMastery.realAttemptsCount || questionsAnswered} Qs)`}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "11px",
                }}
              >
                <span>
                  <strong style={{ color: "#94a3b8" }}>P(Next Correct):</strong>{" "}
                  <span style={{ color: "#38bdf8", fontWeight: "800" }}>
                    {dktNextProb !== null ? `${dktNextProb}%` : "50%"}
                  </span>
                </span>
                <span>
                  <strong style={{ color: "#94a3b8" }}>Focus:</strong>{" "}
                  <span style={{ color: "#fb7185", fontWeight: "700" }}>
                    {dktMastery.weakest_concept
                      ? dktMastery.weakest_concept.split(" ")[0]
                      : "None"}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Active 3D Quiz Display on Board */}
          {quizQuestion && (
            <div
              style={{
                marginTop: "10px",
                background: "rgba(15, 23, 42, 0.9)",
                border: "1px solid #0284c7",
                borderRadius: "12px",
                padding: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  flexWrap: "wrap",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "800",
                    background: "rgba(2, 132, 199, 0.3)",
                    border: "1px solid rgba(56, 189, 248, 0.4)",
                    color: "#38bdf8",
                    padding: "2px 6px",
                    borderRadius: "6px",
                  }}
                >
                  📚 {quizQuestion.subject || subject}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "800",
                    background: "rgba(168, 85, 247, 0.3)",
                    border: "1px solid rgba(192, 132, 252, 0.4)",
                    color: "#c084fc",
                    padding: "2px 6px",
                    borderRadius: "6px",
                  }}
                >
                  🎯 {quizQuestion.topic || "Core Fundamentals"}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "800",
                    background: "rgba(245, 158, 11, 0.3)",
                    border: "1px solid rgba(251, 191, 36, 0.4)",
                    color: "#fbbf24",
                    padding: "2px 6px",
                    borderRadius: "6px",
                    textTransform: "capitalize",
                  }}
                >
                  ⚡ {quizQuestion.difficulty || difficulty}
                </span>
                {questionDKTProb !== null && (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: "800",
                      background: "rgba(16, 185, 129, 0.25)",
                      border: "1px solid rgba(52, 211, 153, 0.4)",
                      color: "#34d399",
                      padding: "2px 6px",
                      borderRadius: "6px",
                    }}
                  >
                    🧠 DKT: {questionDKTProb}%
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#f8fafc",
                  marginBottom: "10px",
                  lineHeight: "1.4",
                }}
              >
                {quizQuestion.question}
              </div>

              {Array.isArray(quizQuestion.options) && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "6px",
                    marginBottom: "10px",
                  }}
                >
                  {quizQuestion.options.slice(0, 4).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onSelectOption && onSelectOption(option)}
                      style={{
                        padding: "8px",
                        fontSize: "11px",
                        fontWeight: "600",
                        textAlign: "left",
                        background:
                          selectedOption === option
                            ? "#0284c7"
                            : "rgba(30, 41, 59, 0.8)",
                        border: `1px solid ${selectedOption === option ? "#38bdf8" : "#334155"}`,
                        borderRadius: "8px",
                        color: "#ffffff",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}

              {onSubmitAnswer && (
                <button
                  type="button"
                  onClick={onSubmitAnswer}
                  style={{
                    width: "100%",
                    padding: "8px",
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    border: "none",
                    borderRadius: "8px",
                    color: "#ffffff",
                    fontWeight: "800",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Submit Answer
                </button>
              )}

              {quizFeedback && (
                <div
                  style={{
                    marginTop: "8px",
                    fontSize: "12px",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    background: quizFeedback.includes("Correct")
                      ? "rgba(16, 185, 129, 0.2)"
                      : "rgba(244, 63, 94, 0.2)",
                    border: `1px solid ${quizFeedback.includes("Correct") ? "#10b981" : "#f43f5e"}`,
                    color: "#ffffff",
                    fontWeight: "600",
                  }}
                >
                  {quizFeedback}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onGenerateQuiz) onGenerateQuiz();
              }}
              disabled={quizLoading}
              style={{
                flex: 1,
                padding: "10px",
                background: quizLoading
                  ? "#475569"
                  : "linear-gradient(135deg, #f43f5e, #e11d48)",
                border: "none",
                borderRadius: "10px",
                color: "#ffffff",
                fontWeight: "800",
                fontSize: "13px",
                cursor: quizLoading ? "not-allowed" : "pointer",
                boxShadow: "0 4px 12px rgba(244, 63, 94, 0.4)",
                transition: "all 0.2s ease",
              }}
            >
              {quizLoading ? "⚡ Generating..." : "⚡ Generate 3D Quiz"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onOpenChat) onOpenChat();
              }}
              style={{
                flex: 1,
                padding: "10px",
                background: "linear-gradient(135deg, #0284c7, #2563eb)",
                border: "none",
                borderRadius: "10px",
                color: "#ffffff",
                fontWeight: "800",
                fontSize: "13px",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(2, 132, 199, 0.4)",
                transition: "all 0.2s ease",
              }}
            >
              💬 Ask Teacher
            </button>
          </div>
        </div>
      </Html>
    </group>
  );
};

InteractiveBoard.propTypes = {
  learningState: PropTypes.object,
  qTelemetry: PropTypes.object,
  onGenerateQuiz: PropTypes.func,
  quizLoading: PropTypes.bool,
  onOpenChat: PropTypes.func,
  quizQuestion: PropTypes.object,
  selectedOption: PropTypes.string,
  onSelectOption: PropTypes.func,
  onSubmitAnswer: PropTypes.func,
  quizFeedback: PropTypes.string,
};

export default InteractiveBoard;
