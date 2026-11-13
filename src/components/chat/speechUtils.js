/**
 * speechUtils.js
 * AdaptiveVerse Voice Synthesis Utilities
 *
 * Provides markdown stripping for clean speech, natural phrase chunking,
 * and intelligent voice selection prioritizing natural system voices.
 */

/**
 * Strips markdown and special symbols so the text-to-speech engine speaks
 * natural English without vocalizing asterisks, backticks, hashtags or code.
 */
export function cleanMarkdownForSpeech(text) {
  if (!text) return "";

  return text
    // Replace fenced code blocks with a brief conversational notice
    .replace(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g, " Here is a code example. ")
    // Remove inline code ticks
    .replace(/`([^`]+)`/g, "$1")
    // Remove markdown headers (#, ##, ###)
    .replace(/^#{1,6}\s+/gm, "")
    // Strip bold and italic delimiters
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove list bullets and numbered prefixes
    .replace(/^[-*•]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    // Remove blockquotes
    .replace(/^>\s+/gm, "")
    // Expand section labels smoothly for speech
    .replace(/\b(?:Definition|Explanation|Practical Example|Short Recap):/gi, "$& ")
    // Convert multiple line breaks to full stops
    .replace(/\n+/g, ". ")
    // Clean up duplicate spaces and punctuation
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();
}

/**
 * Splits cleaned text into natural sentence and clause chunks.
 * Prevents Chrome/Safari TTS timeout freezes on long responses and
 * provides natural rhythmic cadences with brief pauses between thoughts.
 */
export function splitIntoSpeechChunks(cleanedText, maxChars = 140) {
  if (!cleanedText) return [];

  // Split by sentence terminators: . ! ? ;
  const rawSentences =
    cleanedText.match(/[^.!?;\n]+[.!?;\n]+|[^.!?;\n]+$/g) || [cleanedText];

  const chunks = [];
  let currentChunk = "";

  for (const raw of rawSentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if ((currentChunk + " " + sentence).trim().length <= maxChars) {
      currentChunk = (currentChunk + " " + sentence).trim();
    } else {
      if (currentChunk) chunks.push(currentChunk);

      // If a single sentence exceeds maxChars, break by commas or clauses
      if (sentence.length > maxChars) {
        const clauses = sentence.split(/,\s+/);
        let sub = "";
        for (const c of clauses) {
          if ((sub + ", " + c).trim().length <= maxChars) {
            sub = (sub ? sub + ", " : "") + c;
          } else {
            if (sub) chunks.push(sub);
            sub = c;
          }
        }
        if (sub) chunks.push(sub);
        currentChunk = "";
      } else {
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

/**
 * Filters and prioritizes system voices, ranking high-quality, natural English
 * voices at the top.
 */
export function getSortedVoices(voices = []) {
  if (!voices || voices.length === 0) return [];

  const englishVoices = voices.filter((v) =>
    (v.lang || "").toLowerCase().startsWith("en")
  );

  const naturalKeywords = [
    "natural",
    "neural",
    "premium",
    "enhanced",
    "samantha",
    "daniel",
    "karen",
    "google",
    "jenny",
    "guy",
    "ava",
    "serena",
  ];

  const scoreVoice = (voice) => {
    let score = 0;
    const name = (voice.name || "").toLowerCase();
    const lang = (voice.lang || "").toLowerCase();

    // Prefer US or GB English
    if (lang === "en-us") score += 5;
    else if (lang === "en-gb") score += 4;
    else if (lang.startsWith("en")) score += 2;

    // Check for high quality natural keywords
    for (const kw of naturalKeywords) {
      if (name.includes(kw)) {
        score += 10;
        break;
      }
    }

    if (voice.default) score += 3;
    return score;
  };

  const pool = englishVoices.length > 0 ? englishVoices : voices;
  return [...pool].sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

