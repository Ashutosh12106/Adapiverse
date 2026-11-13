import React from "react";
import PropTypes from "prop-types";

export const DatasetAnalyticsModal = ({
  isOpen,
  onClose,
  analytics,
  loading,
  onRefresh,
  onExportCsv,
  sessionId,
  totalAttemptsCount,
}) => {
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const totalAttempts = analytics?.totalAttempts ?? totalAttemptsCount ?? 0;
  const overallAcc = analytics?.overallAccuracy ?? 0;
  const avgResponseTime =
    analytics?.averageResponseTimeSeconds !== null &&
    analytics?.averageResponseTimeSeconds !== undefined
      ? `${analytics.averageResponseTimeSeconds}s`
      : "Not recorded yet";
  const uniqueTopicsCount = analytics?.accuracyByTopic?.length ?? 0;

  const subjects = analytics?.accuracyBySubject || {
    "Artificial Intelligence": { total: 0, correct: 0, accuracy: 0 },
    "Machine Learning": { total: 0, correct: 0, accuracy: 0 },
  };

  const difficulties = analytics?.accuracyByDifficulty || {
    beginner: { total: 0, correct: 0, accuracy: 0 },
    intermediate: { total: 0, correct: 0, accuracy: 0 },
    advanced: { total: 0, correct: 0, accuracy: 0 },
  };

  const topics = analytics?.accuracyByTopic || [];
  const performanceOverTime = analytics?.performanceOverTime || [];

  return (
    <div className="analytics-modal-backdrop" onClick={onClose}>
      <div
        className="analytics-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="analytics-modal-title"
      >
        {/* Modal Header */}
        <div className="analytics-modal-header">
          <div className="analytics-header-title-group">
            <span className="analytics-header-icon">📊</span>
            <div>
              <h2 id="analytics-modal-title" className="analytics-modal-title">
                Student Performance Dataset & Analytics
              </h2>
              <div className="analytics-header-sub">
                <span className="analytics-pill pill-session">
                  👤 Session: {sessionId || "anonymous_student"}
                </span>
                <span className="analytics-pill pill-db">
                  💾 SQLite: <code className="dataset-code">adaptiveverse.db</code>
                </span>
                <span className="analytics-pill pill-provenance">
                  🛡️ Authentic Student Data Only
                </span>
              </div>
            </div>
          </div>

          <div className="analytics-header-actions">
            <button
              type="button"
              className="analytics-export-btn"
              onClick={onExportCsv}
              title="Download real student performance dataset as CSV"
            >
              📥 Export Dataset (.CSV)
            </button>
            <button
              type="button"
              className="analytics-refresh-btn"
              onClick={onRefresh}
              disabled={loading}
              title="Reload live metrics from SQLite database"
            >
              {loading ? "Refreshing..." : "🔄 Refresh"}
            </button>
            <button
              type="button"
              className="analytics-close-btn"
              onClick={onClose}
              aria-label="Close analytics modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="analytics-modal-body">
          {/* Top Metric Cards */}
          <div className="analytics-metrics-grid">
            <div className="analytics-metric-card">
              <span className="metric-card-label">Total Quiz Attempts</span>
              <span className="metric-card-val val-cyan">{totalAttempts}</span>
              <span className="metric-card-sub">Recorded in SQLite</span>
            </div>

            <div className="analytics-metric-card">
              <span className="metric-card-label">Overall Accuracy</span>
              <span className="metric-card-val val-green">{overallAcc}%</span>
              <span className="metric-card-sub">Correct answer ratio</span>
            </div>

            <div className="analytics-metric-card">
              <span className="metric-card-label">Avg Response Time</span>
              <span className="metric-card-val val-purple">
                {avgResponseTime}
              </span>
              <span className="metric-card-sub">Per question decision</span>
            </div>

            <div className="analytics-metric-card">
              <span className="metric-card-label">Concepts Tested</span>
              <span className="metric-card-val val-yellow">
                {uniqueTopicsCount}
              </span>
              <span className="metric-card-sub">Curriculum topics</span>
            </div>
          </div>

          {/* Section: Accuracy by Subject & Difficulty */}
          <div className="analytics-section">
            <h3 className="analytics-section-title">
              🎯 Accuracy by Subject & Difficulty Tier
            </h3>
            <div className="analytics-two-col-grid">
              {/* Subject Breakdown */}
              <div className="analytics-sub-card">
                <h4 className="sub-card-title">Subject Breakdown</h4>
                <div className="subject-breakdown-list">
                  {Object.entries(subjects).map(([subj, stats]) => (
                    <div key={subj} className="breakdown-row">
                      <div className="breakdown-row-info">
                        <span className="breakdown-name">{subj}</span>
                        <span className="breakdown-stat">
                          {stats.total > 0
                            ? `${stats.accuracy}% (${stats.correct}/${stats.total})`
                            : "No attempts"}
                        </span>
                      </div>
                      <div className="analytics-progress-bg">
                        <div
                          className="analytics-progress-fill fill-cyan"
                          style={{ width: `${stats.total > 0 ? stats.accuracy : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Difficulty Breakdown */}
              <div className="analytics-sub-card">
                <h4 className="sub-card-title">Difficulty Tiers</h4>
                <div className="difficulty-breakdown-list">
                  {Object.entries(difficulties).map(([diff, stats]) => {
                    const formatted =
                      diff.charAt(0).toUpperCase() + diff.slice(1);
                    return (
                      <div key={diff} className="breakdown-row">
                        <div className="breakdown-row-info">
                          <span className={`diff-tag diff-${diff}`}>
                            {formatted}
                          </span>
                          <span className="breakdown-stat">
                            {stats.total > 0
                              ? `${stats.accuracy}% (${stats.correct}/${stats.total})`
                              : "No attempts"}
                          </span>
                        </div>
                        <div className="analytics-progress-bg">
                          <div
                            className={`analytics-progress-fill fill-${diff}`}
                            style={{
                              width: `${stats.total > 0 ? stats.accuracy : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Section: Topic & Knowledge Component Performance */}
          <div className="analytics-section">
            <h3 className="analytics-section-title">
              🧠 Accuracy by Concept / Knowledge Component
            </h3>
            {topics.length === 0 ? (
              <p className="analytics-empty-note">
                No quiz interaction records found. Generate and answer questions to view concept diagnostics.
              </p>
            ) : (
              <div className="topic-analytics-grid">
                {topics.map((t) => {
                  const pct = t.accuracy;
                  const tierClass =
                    pct >= 70 ? "val-green" : pct >= 45 ? "val-yellow" : "val-red";
                  return (
                    <div key={t.topic} className="topic-stat-item">
                      <div className="topic-stat-header">
                        <span className="topic-stat-name">{t.topic}</span>
                        <span className={`topic-stat-acc ${tierClass}`}>
                          {pct}% ({t.correct}/{t.total})
                        </span>
                      </div>
                      <div className="analytics-progress-bg">
                        <div
                          className={`analytics-progress-fill ${
                            pct >= 70 ? "fill-green" : pct >= 45 ? "fill-yellow" : "fill-red"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Performance Over Time Table */}
          <div className="analytics-section">
            <div className="analytics-section-header">
              <h3 className="analytics-section-title">
                📈 Student Performance Over Time (Interactive History)
              </h3>
              <span className="section-meta-hint">
                Showing last {performanceOverTime.length} attempts chronologically
              </span>
            </div>

            {performanceOverTime.length === 0 ? (
              <p className="analytics-empty-note">
                History is empty. Answer quiz questions to populate the performance timeline.
              </p>
            ) : (
              <div className="analytics-table-container">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Time</th>
                      <th>Subject</th>
                      <th>Difficulty</th>
                      <th>Topic</th>
                      <th>Result</th>
                      <th>Response Time</th>
                      <th>Running Acc</th>
                      <th>RL Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performanceOverTime.map((item) => {
                      const timeStr = item.timestamp
                        ? new Date(item.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                        : "-";
                      return (
                        <tr key={item.attemptId || item.attemptIndex}>
                          <td>{item.attemptIndex}</td>
                          <td className="cell-time">{timeStr}</td>
                          <td>
                            {item.subject === "Artificial Intelligence"
                              ? "AI"
                              : "ML"}
                          </td>
                          <td>
                            <span
                              className={`diff-pill diff-${(
                                item.difficulty || "beginner"
                              ).toLowerCase()}`}
                            >
                              {item.difficulty}
                            </span>
                          </td>
                          <td className="cell-topic" title={item.topic}>
                            {item.topic}
                          </td>
                          <td>
                            <span
                              className={`result-pill ${
                                item.isCorrect ? "res-correct" : "res-incorrect"
                              }`}
                            >
                              {item.isCorrect ? "✓ Correct" : "✗ Wrong"}
                            </span>
                          </td>
                          <td className="cell-resp">
                            {item.responseTimeSeconds !== null &&
                            item.responseTimeSeconds !== undefined
                              ? `${item.responseTimeSeconds}s`
                              : "-"}
                          </td>
                          <td className="cell-acc">
                            {item.cumulativeAccuracy}%
                          </td>
                          <td className="cell-rl">
                            {item.rlAction ? (
                              <span className="rl-action-pill">
                                {item.rlAction.replace(/_/g, " ")}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section: CSV Dataset Schema & Provenance */}
          <div className="analytics-section schema-section">
            <h3 className="analytics-section-title">
              📋 Exported Dataset Schema (<code className="dataset-code">student_performance.csv</code>)
            </h3>
            <p className="schema-desc">
              Exports the full interaction dataset formatted for Educational Data Mining (EDM) and machine learning research. Contains 13 standard features:
            </p>
            <div className="schema-tags-container">
              {[
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
              ].map((col) => (
                <span key={col} className="schema-column-tag">
                  {col}
                </span>
              ))}
            </div>
            <div className="schema-export-action-box">
              <span className="schema-box-note">
                🔒 <strong>Data Integrity Guarantee:</strong> All rows correspond to authentic student attempts saved in SQLite. No synthetic data is fabricated. Older database rows with legacy null fields are safely mapped and exported with RFC-4180 compliance.
              </span>
              <button
                type="button"
                className="analytics-export-btn btn-large"
                onClick={onExportCsv}
              >
                📥 Download student_performance.csv
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

DatasetAnalyticsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  analytics: PropTypes.shape({
    totalAttempts: PropTypes.number,
    overallAccuracy: PropTypes.number,
    averageResponseTimeSeconds: PropTypes.number,
    accuracyBySubject: PropTypes.object,
    accuracyByDifficulty: PropTypes.object,
    accuracyByTopic: PropTypes.array,
    performanceOverTime: PropTypes.array,
  }),
  loading: PropTypes.bool,
  onRefresh: PropTypes.func.isRequired,
  onExportCsv: PropTypes.func.isRequired,
  sessionId: PropTypes.string,
  totalAttemptsCount: PropTypes.number,
};
