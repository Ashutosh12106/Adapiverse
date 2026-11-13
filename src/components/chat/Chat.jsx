import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { orchestrator } from "../../agents";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  cleanMarkdownForSpeech,
  splitIntoSpeechChunks,
  getSortedVoices,
} from "./speechUtils";
import "./Chat.css";

export const Chat = ({ learningState, isOpen, onToggle }) => {
  const [userInput, setUserInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [internalShow, setInternalShow] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState(null);

  // Voice Settings & State
  const [voices, setVoices] = useState([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState("");
  const [speechRate, setSpeechRate] = useState(1.0);
  const [speechPitch, setSpeechPitch] = useState(1.0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const activeRequestIdRef = useRef(0);
  const messagesEndRef = useRef(null);
  const isSpeechCancelledRef = useRef(false);
  const speechTimeoutRef = useRef(null);

  const showInput = isOpen !== undefined ? isOpen : internalShow;

  const SpeechRecognitionAPI =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  // Auto-scroll to bottom of messages container
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (showInput) {
      scrollToBottom();
    }
  }, [chatHistory, loading, showInput]);

  // Load and sort system voices
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices() || [];
      const sorted = getSortedVoices(allVoices);
      setVoices(sorted);

      if (sorted.length > 0 && !selectedVoiceUri) {
        setSelectedVoiceUri(sorted[0].voiceURI);
      }
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, [selectedVoiceUri]);

  // Central Speech Synthesis Stop Helper
  const stopSpeech = () => {
    isSpeechCancelledRef.current = true;
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (err) {
        console.warn("Speech cancel error:", err);
      }
    }
    setIsSpeaking(false);
  };

  // Text-To-Speech with natural sentence chunking and pauses
  const speak = (rawText) => {
    if (!rawText) return;
    stopSpeech();

    const synthesis =
      typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synthesis) return;

    const cleaned = cleanMarkdownForSpeech(rawText);
    const chunks = splitIntoSpeechChunks(cleaned, 150);

    if (chunks.length === 0) return;

    isSpeechCancelledRef.current = false;
    setIsSpeaking(true);

    const activeVoice =
      voices.find((v) => v.voiceURI === selectedVoiceUri) ||
      voices[0] ||
      null;

    let chunkIndex = 0;

    const speakNextChunk = () => {
      if (isSpeechCancelledRef.current || chunkIndex >= chunks.length) {
        setIsSpeaking(false);
        return;
      }

      const textChunk = chunks[chunkIndex];
      chunkIndex++;

      const utterance = new SpeechSynthesisUtterance(textChunk);
      if (activeVoice) {
        utterance.voice = activeVoice;
      }
      utterance.rate = speechRate;
      utterance.pitch = speechPitch;
      utterance.lang = activeVoice?.lang || "en-US";

      utterance.onend = () => {
        if (!isSpeechCancelledRef.current) {
          // Add brief 120ms natural breathing pause between sentences
          speechTimeoutRef.current = setTimeout(speakNextChunk, 120);
        } else {
          setIsSpeaking(false);
        }
      };

      utterance.onerror = (e) => {
        if (e.error !== "canceled" && e.error !== "interrupted") {
          console.warn("TTS chunk playback notice:", e.error);
          speakNextChunk();
        } else {
          setIsSpeaking(false);
        }
      };

      synthesis.speak(utterance);
    };

    speakNextChunk();
  };

  // Voice Input (Microphone)
  const startListening = () => {
    if (!SpeechRecognitionAPI) {
      setSpeechError(
        "Voice input is not available in this browser. Please use Chrome or Edge, or type your question."
      );
      return;
    }

    setSpeechError(null);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionRef.current = recognition;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        let combined = "";
        for (let i = 0; i < event.results.length; i++) {
          combined += event.results[i][0].transcript;
        }
        transcriptRef.current = combined;
        setUserInput(combined);
      };

      recognition.onerror = (event) => {
        console.warn("Speech recognition notice:", event.error);
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          setSpeechError(
            "Microphone access blocked. Please allow microphone permissions in browser settings."
          );
        } else if (event.error !== "no-speech") {
          setSpeechError(`Voice input: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (err) {
      console.error("Speech recognition start failed:", err);
      setSpeechError("Could not start voice recognition. Please try typing.");
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  };

  // Stop active speech and recognition when chat is closed via props
  useEffect(() => {
    if (isOpen === false) {
      activeRequestIdRef.current++;
      stopSpeech();
      stopListening();
    }
  }, [isOpen]);

  // Clean up recognition instance and TTS on unmount
  useEffect(() => {
    return () => {
      stopSpeech();
      stopListening();
    };
  }, []);

  const handleUserInput = (e) => {
    setUserInput(e.target.value);
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!userInput.trim()) return;

    // Stop speaking any prior answer immediately
    stopSpeech();

    const currentQuestion = userInput.trim();
    const requestId = ++activeRequestIdRef.current;
    setLoading(true);

    try {
      const result = await orchestrator.handleStudentQuestion(
        currentQuestion,
        learningState
      );

      if (requestId !== activeRequestIdRef.current) {
        return;
      }

      const generatedText = result.response;
      setChatHistory((prev) => [
        ...prev,
        {
          user: currentQuestion,
          bot: generatedText,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
      setUserInput("");
      transcriptRef.current = "";

      // Play text-to-speech for newly arrived response
      speak(generatedText);
    } catch (error) {
      if (requestId !== activeRequestIdRef.current) return;

      console.error(
        "Chat: Error delegating question to TutorAgent via Orchestrator:",
        error
      );
      setChatHistory((prev) => [
        ...prev,
        {
          user: currentQuestion,
          bot: "Sorry, I encountered an error while contacting Teacher Emilian. Please verify that the backend proxy server is running.",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    } finally {
      if (requestId === activeRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const handleClose = () => {
    activeRequestIdRef.current++;
    stopSpeech();
    stopListening();
    if (onToggle) {
      onToggle(false);
    } else {
      setInternalShow(false);
    }
  };

  const toggleInput = () => {
    if (showInput) {
      handleClose();
    } else {
      if (onToggle) {
        onToggle(true);
      } else {
        setInternalShow(true);
      }
    }
  };

  const handleClear = () => {
    activeRequestIdRef.current++;
    stopSpeech();
    stopListening();
    setChatHistory([]);
    setUserInput("");
    transcriptRef.current = "";
    setSpeechError(null);
  };

  const currentSubject = learningState.selectedSubject || "Artificial Intelligence";
  const currentDiff =
    learningState.currentDifficulty || learningState.difficulty || "Beginner";

  return (
    <div
      className={`chat-component ${showInput ? "chat-open" : ""}`}
      data-selected-subject={currentSubject}
    >
      <button className="chat-button" onClick={toggleInput} type="button">
        {showInput ? "Close Chat (T)" : "💬 Ask Teacher (T)"}
      </button>

      {showInput && (
        <div className="chat-box show" role="dialog" aria-modal="true">
          <div id="container">
            <div className="container-inner">
              {/* Header */}
              <div className="chat-header">
                <div className="chat-header-info">
                  <div className="chat-avatar-wrapper">
                    <span className="chat-avatar-icon">🎓</span>
                    <span className="chat-avatar-online" title="Online" />
                  </div>
                  <div className="chat-header-text">
                    <div className="chat-header-title">Teacher Emilian</div>
                    <div className="chat-header-subtitle">
                      <span className="subject-badge">{currentSubject}</span>
                      <span className="difficulty-badge">{currentDiff}</span>
                    </div>
                  </div>
                </div>

                <div className="chat-header-actions">
                  {isSpeaking && (
                    <button
                      type="button"
                      className="speaking-pill"
                      onClick={stopSpeech}
                      title="Click to stop speaking"
                    >
                      <span className="sound-bars">
                        <span className="sound-bar" />
                        <span className="sound-bar" />
                        <span className="sound-bar" />
                      </span>
                      <span>Speaking</span>
                      <span className="speaking-stop-icon">⏹</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className={`voice-settings-toggle-btn ${showVoiceSettings ? "active" : ""}`}
                    onClick={() => setShowVoiceSettings((prev) => !prev)}
                    title="Audio & Voice settings"
                  >
                    ⚙️ Voice
                  </button>

                  <button
                    type="button"
                    className="chat-close-btn"
                    onClick={handleClose}
                    title="Close Chat (Esc / T)"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Voice & Speech Controls Drawer */}
              {showVoiceSettings && (
                <div className="voice-controls-drawer">
                  <div className="voice-control-item voice-select-item">
                    <label htmlFor="voice-select">Voice:</label>
                    <select
                      id="voice-select"
                      value={selectedVoiceUri}
                      onChange={(e) => setSelectedVoiceUri(e.target.value)}
                    >
                      {voices.length === 0 ? (
                        <option value="">Default System Voice</option>
                      ) : (
                        voices.map((v) => (
                          <option key={v.voiceURI} value={v.voiceURI}>
                            {v.name} ({v.lang})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="voice-control-item voice-speed-item">
                    <label>Speed: {speechRate}x</label>
                    <div className="speed-pills">
                      {[0.8, 1.0, 1.2, 1.4].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          className={`pill-btn ${speechRate === rate ? "active" : ""}`}
                          onClick={() => setSpeechRate(rate)}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="voice-control-item voice-pitch-item">
                    <label>Pitch: {speechPitch}</label>
                    <div className="pitch-pills">
                      {[0.9, 1.0, 1.1].map((pitch) => (
                        <button
                          key={pitch}
                          type="button"
                          className={`pill-btn ${speechPitch === pitch ? "active" : ""}`}
                          onClick={() => setSpeechPitch(pitch)}
                        >
                          {pitch === 1.0 ? "Normal" : pitch < 1 ? "Lower" : "Higher"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Independently Scrollable Conversation Content */}
              <div className="content">
                {chatHistory.length === 0 ? (
                  <div className="welcome-card">
                    <div className="welcome-icon">💡</div>
                    <div className="welcome-title">
                      Welcome to the AdaptiveVerse 3D AI Classroom!
                    </div>
                    <div className="welcome-description">
                      Ask Teacher Emilian anything about{" "}
                      <strong>{currentSubject}</strong>. Concepts will be explained
                      with a simple definition, deep explanation, practical
                      example, and short recap.
                    </div>
                    <div className="welcome-suggestions">
                      <button
                        type="button"
                        className="suggestion-chip"
                        onClick={() => {
                          const q =
                            currentSubject === "Machine Learning"
                              ? "What is a Neural Network and how does it learn?"
                              : "What is A* search algorithm and how does its heuristic work?";
                          setUserInput(q);
                        }}
                      >
                        💬 &ldquo;
                        {currentSubject === "Machine Learning"
                          ? "What is a Neural Network and how does it learn?"
                          : "What is A* search algorithm and how does its heuristic work?"}
                        &rdquo;
                      </button>
                    </div>
                  </div>
                ) : (
                  chatHistory.map((chat, index) => (
                    <div key={index} className="chat-message-group">
                      {/* Student Message */}
                      <div className="message-wrapper student">
                        <div className="message-meta student">
                          <span className="author-tag">You</span>
                          {chat.timestamp && (
                            <span className="timestamp-tag">{chat.timestamp}</span>
                          )}
                        </div>
                        <div className="message-bubble student">
                          {chat.user}
                        </div>
                      </div>

                      {/* Teacher Response */}
                      <div className="message-wrapper teacher">
                        <div className="message-meta teacher">
                          <span className="author-tag">🎓 Teacher Emilian</span>
                          {chat.timestamp && (
                            <span className="timestamp-tag">{chat.timestamp}</span>
                          )}
                          <button
                            type="button"
                            className="inline-replay-btn"
                            onClick={() => {
                              if (isSpeaking) {
                                stopSpeech();
                              } else {
                                speak(chat.bot);
                              }
                            }}
                            title={isSpeaking ? "Stop Speaking" : "Listen to explanation"}
                          >
                            {isSpeaking ? "⏹️ Stop" : "🔊 Listen"}
                          </button>
                        </div>
                        <div className="message-bubble teacher">
                          <MarkdownRenderer content={chat.bot} />
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {/* Loading / Thinking Indicator */}
                {loading && (
                  <div className="message-wrapper teacher">
                    <div className="message-meta teacher">
                      <span className="author-tag">🎓 Teacher Emilian</span>
                    </div>
                    <div className="message-bubble teacher loading-bubble">
                      <div className="typing-indicator">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-text">
                          Teacher Emilian is crafting your structured lesson...
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Fixed Bottom Controls & Input */}
              <div className="chat-footer">
                {speechError && (
                  <div className="speech-error-banner">
                    ⚠️ {speechError}
                  </div>
                )}

                <div className="input-container">
                  <form onSubmit={handleSubmit}>
                    <input
                      type="text"
                      value={userInput}
                      onChange={handleUserInput}
                      placeholder={`Ask Teacher Emilian about ${currentSubject}...`}
                      aria-label="Student Question"
                      required
                    />

                    {SpeechRecognitionAPI ? (
                      <button
                        type="button"
                        className={`voice-record-btn ${isListening ? "listening" : ""}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          startListening();
                        }}
                        onPointerUp={(e) => {
                          e.preventDefault();
                          stopListening();
                        }}
                        onPointerLeave={() => {
                          if (isListening) stopListening();
                        }}
                        onPointerCancel={() => {
                          if (isListening) stopListening();
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault();
                          startListening();
                        }}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          stopListening();
                        }}
                        title="Hold to speak, release to submit"
                      >
                        {isListening ? "🔴 Listening..." : "🎙️ Hold to Speak"}
                      </button>
                    ) : (
                      <div
                        className="voice-unsupported-badge"
                        title="Voice recognition not supported in this browser."
                      >
                        🎙️ Mic N/A
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading || !userInput.trim()}
                      className="send-btn"
                    >
                      <i className="send-icon">{loading ? "..." : "➤"}</i>
                      <span>Send</span>
                    </button>
                  </form>
                </div>

                <div className="chat-bottom-actions">
                  <div className="left-actions">
                    <button
                      type="button"
                      className={`action-btn stop-speech-btn ${isSpeaking ? "active-pulse" : ""}`}
                      onClick={stopSpeech}
                      disabled={!isSpeaking}
                      title="Stop text-to-speech immediately"
                    >
                      ⏹️ Stop Speaking
                    </button>
                  </div>

                  <div className="right-actions">
                    <button
                      type="button"
                      className="action-btn clear-btn"
                      onClick={handleClear}
                      title="Clear chat messages"
                    >
                      🗑️ Clear
                    </button>
                    <button
                      type="button"
                      className="action-btn close-btn"
                      onClick={handleClose}
                      title="Close Chat"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

Chat.propTypes = {
  learningState: PropTypes.shape({
    selectedSubject: PropTypes.string,
    difficulty: PropTypes.string,
    currentDifficulty: PropTypes.string,
  }).isRequired,
  isOpen: PropTypes.bool,
  onToggle: PropTypes.func,
};

export default Chat;
