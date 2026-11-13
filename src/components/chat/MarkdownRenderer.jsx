import React, { useState } from "react";
import PropTypes from "prop-types";

// Helper for inline markdown: bold, italic, inline code, and links
function parseInline(text) {
  if (!text) return "";
  // Tokenize by `code`, **bold**, *italic*, [text](url)
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code key={index} className="chat-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }

    if (
      (part.startsWith("**") && part.endsWith("**") && part.length >= 4) ||
      (part.startsWith("__") && part.endsWith("__") && part.length >= 4)
    ) {
      return (
        <strong key={index} className="chat-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (
      (part.startsWith("*") && part.endsWith("*") && part.length >= 2) ||
      (part.startsWith("_") && part.endsWith("_") && part.length >= 2)
    ) {
      return (
        <em key={index} className="chat-italic">
          {part.slice(1, -1)}
        </em>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-link"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return part;
  });
}

const CodeBlock = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span className="chat-code-lang">{lang || "code"}</span>
        <button
          type="button"
          className="chat-code-copy-btn"
          onClick={handleCopy}
          title="Copy code to clipboard"
        >
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>
      </div>
      <pre className="chat-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
};

CodeBlock.propTypes = {
  lang: PropTypes.string,
  code: PropTypes.string.isRequired,
};

// Pedagogical section metadata (icons, styling classes)
const PEDAGOGICAL_SECTIONS = {
  definition: {
    icon: "🎯",
    title: "Definition",
    className: "pedagogical-definition",
  },
  explanation: {
    icon: "💡",
    title: "Explanation",
    className: "pedagogical-explanation",
  },
  "practical example": {
    icon: "🛠️",
    title: "Practical Example",
    className: "pedagogical-practical-example",
  },
  "short recap": {
    icon: "📌",
    title: "Short Recap",
    className: "pedagogical-short-recap",
  },
  "key takeaway": {
    icon: "🔑",
    title: "Key Takeaway",
    className: "pedagogical-short-recap",
  },
  summary: {
    icon: "📝",
    title: "Summary",
    className: "pedagogical-short-recap",
  },
};

export const MarkdownRenderer = ({ content }) => {
  if (!content) return null;

  // 1. Separate code blocks from text segments
  const segments = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIdx) {
      segments.push({
        type: "text",
        content: content.slice(lastIdx, match.index),
      });
    }
    segments.push({
      type: "code",
      lang: match[1] || "code",
      code: match[2].trimEnd(),
    });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < content.length) {
    segments.push({ type: "text", content: content.slice(lastIdx) });
  }

  // 2. Parse text blocks into structured sections, headings, lists, quotes, and paragraphs
  const parsedNodes = [];

  segments.forEach((segment, segIdx) => {
    if (segment.type === "code") {
      parsedNodes.push(
        <CodeBlock
          key={`code-${segIdx}`}
          lang={segment.lang}
          code={segment.code}
        />
      );
      return;
    }

    const lines = segment.content.split("\n");
    let currentList = null;
    let currentSection = null;

    const flushList = () => {
      if (currentList) {
        const ListTag = currentList.listType === "ol" ? "ol" : "ul";
        const listElement = (
          <ListTag
            key={`list-${parsedNodes.length}-${currentList.items.length}`}
            className={`chat-md-list chat-md-${currentList.listType}`}
          >
            {currentList.items.map((item, idx) => (
              <li key={idx} className="chat-md-list-item">
                {parseInline(item)}
              </li>
            ))}
          </ListTag>
        );

        if (currentSection) {
          currentSection.elements.push(listElement);
        } else {
          parsedNodes.push(listElement);
        }
        currentList = null;
      }
    };

    const flushSection = () => {
      flushList();
      if (currentSection) {
        const secMeta =
          PEDAGOGICAL_SECTIONS[currentSection.title.toLowerCase()] || {
            icon: "📖",
            title: currentSection.title,
            className: "pedagogical-general",
          };

        parsedNodes.push(
          <div
            key={`section-${parsedNodes.length}`}
            className={`pedagogical-card ${secMeta.className}`}
          >
            <div className="pedagogical-card-header">
              <span className="pedagogical-icon">{secMeta.icon}</span>
              <span className="pedagogical-title">{currentSection.title}</span>
            </div>
            <div className="pedagogical-card-body">
              {currentSection.elements}
            </div>
          </div>
        );
        currentSection = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        flushList();
        continue;
      }

      // Check headings (e.g., ### 🎓 Title)
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushSection();
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];
        const HeadingTag = level <= 2 ? "h3" : level === 3 ? "h4" : "h5";
        parsedNodes.push(
          <HeadingTag
            key={`heading-${parsedNodes.length}-${i}`}
            className={`chat-md-heading chat-md-h${level}`}
          >
            {parseInline(headingText)}
          </HeadingTag>
        );
        continue;
      }

      // Check pedagogical section prefixes:
      // Examples: **Definition:**, **1. Definition:**, **Explanation:**, etc.
      const sectionMatch = line.match(
        /^\*\*(?:(?:\d+\.\s*)?(Definition|Explanation|Practical Example|Short Recap|Key Takeaway|Summary)):?\*\*:?\s*(.*)$/i
      );
      if (sectionMatch) {
        flushSection();
        const matchedTitle = sectionMatch[1];
        const remainder = sectionMatch[2];
        currentSection = {
          title: matchedTitle,
          elements: [],
        };
        if (remainder) {
          currentSection.elements.push(
            <p key={`p-${i}`} className="chat-md-paragraph">
              {parseInline(remainder)}
            </p>
          );
        }
        continue;
      }

      // Check bullet list item
      const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
      if (bulletMatch) {
        if (!currentList || currentList.listType !== "ul") {
          flushList();
          currentList = { listType: "ul", items: [] };
        }
        currentList.items.push(bulletMatch[1]);
        continue;
      }

      // Check numbered list item
      const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        if (!currentList || currentList.listType !== "ol") {
          flushList();
          currentList = { listType: "ol", items: [] };
        }
        currentList.items.push(numMatch[2]);
        continue;
      }

      // Any other line breaks list
      flushList();

      // Check blockquote
      const quoteMatch = line.match(/^>\s+(.*)$/);
      if (quoteMatch) {
        const quoteEl = (
          <blockquote
            key={`quote-${parsedNodes.length}-${i}`}
            className="chat-md-blockquote"
          >
            {parseInline(quoteMatch[1])}
          </blockquote>
        );
        if (currentSection) {
          currentSection.elements.push(quoteEl);
        } else {
          parsedNodes.push(quoteEl);
        }
        continue;
      }

      // Regular paragraph
      const paragraphEl = (
        <p key={`p-${parsedNodes.length}-${i}`} className="chat-md-paragraph">
          {parseInline(line)}
        </p>
      );

      if (currentSection) {
        currentSection.elements.push(paragraphEl);
      } else {
        parsedNodes.push(paragraphEl);
      }
    }

    flushSection();
  });

  return <div className="chat-markdown-container">{parsedNodes}</div>;
};

MarkdownRenderer.propTypes = {
  content: PropTypes.string.isRequired,
};

export default MarkdownRenderer;

