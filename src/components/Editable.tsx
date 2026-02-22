import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
  type KeyboardEvent,
  type ChangeEvent,
  type FocusEvent,
  type MouseEvent,
} from "react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";
import type { SeverityColor } from "../lib/types";
import { inlineMarkdownToHtml } from "../lib/parseIssue";

const SEVERITY_OPTIONS = ["Critical", "High", "Medium", "Low", "Info"] as const;

/**
 * Returns the platform-appropriate shortcut label.
 */
function shortcutLabel(): string {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return isMac ? "⌘⇧L" : "Ctrl+Shift+L";
}

/**
 * Checks whether a keyboard event matches our translate shortcut:
 * Ctrl+Shift+L (Windows/Linux) or Cmd+Shift+L (macOS).
 */
function isTranslateShortcut(e: KeyboardEvent): boolean {
  return e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l";
}

// ---------------------------------------------------------------------------
// TranslateButton
// ---------------------------------------------------------------------------

interface TranslateButtonProps {
  onClick: () => void;
  translating: boolean;
  disabled: boolean;
}

/**
 * Small translate button shown in edit mode.
 * Uses onMouseDown with preventDefault to avoid stealing focus from the
 * input/textarea, which would trigger onBlur → commit → close edit mode.
 */
function TranslateButton({
  onClick,
  translating,
  disabled,
}: TranslateButtonProps): React.ReactElement | null {
  if (disabled) return null;
  return (
    <button
      type="button"
      className="translate-btn"
      onMouseDown={(e: React.MouseEvent) => {
        // Prevent this click from blurring the active input/textarea
        e.preventDefault();
      }}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      disabled={translating}
      title={`Translate to target language (${shortcutLabel()})`}
    >
      {translating ? "⏳" : "🌐"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// RestoreButton
// ---------------------------------------------------------------------------

interface RestoreButtonProps {
  visible: boolean;
  onClick: () => void;
  originalValue?: string;
}

/**
 * Small restore button shown when a field has been modified from its original.
 */
function RestoreButton({
  visible,
  onClick,
  originalValue,
}: RestoreButtonProps): React.ReactElement | null {
  if (!visible) return null;
  const truncated =
    typeof originalValue === "string" && originalValue.length > 60
      ? originalValue.slice(0, 57) + "…"
      : originalValue;
  return (
    <button
      type="button"
      className="restore-field-btn"
      onMouseDown={(e: React.MouseEvent) => {
        e.preventDefault();
      }}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={`Restore original${truncated ? `: ${truncated}` : ""}`}
    >
      ↩
    </button>
  );
}

// ---------------------------------------------------------------------------
// EditableText
// ---------------------------------------------------------------------------

interface EditableTextProps {
  value: string;
  onChange: (newValue: string) => void;
  tag?: keyof JSX.IntrinsicElements;
  className?: string;
  placeholder?: string;
  inputClassName?: string;
  onTranslate?: (text: string) => Promise<string>;
  originalValue?: string;
  onRestore?: () => void;
}

/**
 * Inline-editable single-line text.
 * Renders as normal text; click to switch to an input field.
 */
export function EditableText({
  value,
  onChange,
  tag: Tag = "span",
  className = "",
  placeholder = "Click to edit…",
  inputClassName = "",
  onTranslate,
  originalValue,
  onRestore,
}: EditableTextProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [translating, setTranslating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wantsFocusRef = useRef(false);

  const isModified = originalValue !== undefined && value !== originalValue;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Re-focus after translation finishes and the input is re-enabled
  useEffect(() => {
    if (wantsFocusRef.current && !translating && editing && inputRef.current) {
      wantsFocusRef.current = false;
      inputRef.current.focus();
    }
  }, [translating, editing]);

  const commit = useCallback(() => {
    if (translating) return;
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onChange(trimmed);
    }
  }, [draft, value, onChange, translating]);

  const doTranslate = useCallback(async () => {
    if (!onTranslate || translating || !draft.trim()) return;
    setTranslating(true);
    try {
      const result = await onTranslate(draft);
      setDraft(result);
    } catch (err) {
      console.error("Translation failed:", err);
    } finally {
      wantsFocusRef.current = true;
      setTranslating(false);
    }
  }, [onTranslate, translating, draft]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        setDraft(value);
        setEditing(false);
      } else if (isTranslateShortcut(e) && onTranslate) {
        e.preventDefault();
        doTranslate();
      }
    },
    [commit, value, onTranslate, doTranslate],
  );

  if (editing) {
    return (
      <div className="editable-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          className={`editable-input ${inputClassName} ${translating ? "translating" : ""}`}
          value={draft}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setDraft(e.target.value)
          }
          onBlur={commit}
          onKeyDown={handleKeyDown}
          disabled={translating}
        />
        <TranslateButton
          onClick={doTranslate}
          translating={translating}
          disabled={!onTranslate}
        />
        {onTranslate && (
          <div className="editable-hint">
            <kbd>{shortcutLabel()}</kbd> translate · <kbd>Enter</kbd> save ·{" "}
            <kbd>Esc</kbd> cancel
          </div>
        )}
      </div>
    );
  }

  return (
    <Tag
      className={`editable-display ${className} ${isModified ? "editable-display--modified" : ""}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value ? (
        <span dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(value) }} />
      ) : (
        <span className="editable-placeholder">{placeholder}</span>
      )}
      <span className="editable-pencil"> ✎</span>
      <RestoreButton
        visible={isModified && !!onRestore}
        onClick={onRestore!}
        originalValue={originalValue}
      />
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// EditableBlock
// ---------------------------------------------------------------------------

interface EditableBlockProps {
  value: string;
  onChange: (newValue: string) => void;
  children: ReactNode;
  className?: string;
  minRows?: number;
  placeholder?: string;
  onTranslate?: (text: string) => Promise<string>;
  originalValue?: string;
  onRestore?: () => void;
}

/**
 * Inline-editable multiline block (markdown content).
 * Renders the provided `children` (pre-rendered HTML); click to switch to a
 * textarea that edits the raw markdown source.
 */
export function EditableBlock({
  value,
  onChange,
  children,
  className = "",
  minRows = 3,
  placeholder = "Click to edit…",
  onTranslate,
  originalValue,
  onRestore,
}: EditableBlockProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [translating, setTranslating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wantsFocusRef = useRef(false);

  const isModified = originalValue !== undefined && value !== originalValue;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      autoResize(textareaRef.current);
    }
  }, [editing]);

  // Re-focus after translation finishes and the textarea is re-enabled
  useEffect(() => {
    if (
      wantsFocusRef.current &&
      !translating &&
      editing &&
      textareaRef.current
    ) {
      wantsFocusRef.current = false;
      textareaRef.current.focus();
      autoResize(textareaRef.current);
    }
  }, [translating, editing]);

  const autoResize = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  };

  const commit = useCallback(() => {
    if (translating) return;
    setEditing(false);
    if (draft !== value) {
      onChange(draft);
    }
  }, [draft, value, onChange, translating]);

  const doTranslate = useCallback(async () => {
    if (!onTranslate || translating || !draft.trim()) return;
    setTranslating(true);
    try {
      const result = await onTranslate(draft);
      setDraft(result);
    } catch (err) {
      console.error("Translation failed:", err);
    } finally {
      wantsFocusRef.current = true;
      setTranslating(false);
    }
  }, [onTranslate, translating, draft]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        setDraft(value);
        setEditing(false);
      } else if (isTranslateShortcut(e) && onTranslate) {
        e.preventDefault();
        doTranslate();
      }
    },
    [value, onTranslate, doTranslate],
  );

  if (editing) {
    return (
      <div className={`editable-block-editing ${className}`}>
        <div className="editable-block-toolbar">
          <TranslateButton
            onClick={doTranslate}
            translating={translating}
            disabled={!onTranslate}
          />
        </div>
        <textarea
          ref={textareaRef}
          className={`editable-textarea ${translating ? "translating" : ""}`}
          value={draft}
          rows={minRows}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            setDraft(e.target.value);
            autoResize(e.target);
          }}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={translating}
        />
        <div className="editable-hint">
          {onTranslate && (
            <>
              <kbd>{shortcutLabel()}</kbd> translate ·{" "}
            </>
          )}
          <kbd>Esc</kbd> cancel · click outside to save
        </div>
      </div>
    );
  }

  return (
    <div
      className={`editable-block-display ${className} ${isModified ? "editable-block-display--modified" : ""}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {children}
      <span className="editable-pencil"> ✎</span>
      <RestoreButton
        visible={isModified && !!onRestore}
        onClick={onRestore!}
        originalValue={originalValue}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditableCode
// ---------------------------------------------------------------------------

interface EditableCodeProps {
  value: string;
  language: string;
  onChange: (newValue: string) => void;
  onLanguageChange?: (newLang: string) => void;
  onTranslate?: (text: string) => Promise<string>;
  originalValue?: string;
  onRestore?: () => void;
}

/**
 * Inline-editable code block.
 * Renders the code preview; click to edit the raw code in a textarea.
 */
export function EditableCode({
  value,
  language,
  onChange,
  onLanguageChange,
  onTranslate,
  originalValue,
  onRestore,
}: EditableCodeProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [langDraft, setLangDraft] = useState(language);
  const [translating, setTranslating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wantsFocusRef = useRef(false);

  const isModified = originalValue !== undefined && value !== originalValue;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    setLangDraft(language);
  }, [language]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      autoResize(textareaRef.current);
    }
  }, [editing]);

  // Re-focus after translation finishes and the textarea is re-enabled
  useEffect(() => {
    if (
      wantsFocusRef.current &&
      !translating &&
      editing &&
      textareaRef.current
    ) {
      wantsFocusRef.current = false;
      textareaRef.current.focus();
      autoResize(textareaRef.current);
    }
  }, [translating, editing]);

  const autoResize = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  };

  const highlightedHtml = useMemo(() => {
    if (!value) return "";
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(value, { language }).value;
      }
      return hljs.highlightAuto(value).value;
    } catch {
      return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [value, language]);

  const commit = useCallback(() => {
    if (translating) return;
    setEditing(false);
    if (draft !== value) {
      onChange(draft);
    }
    if (onLanguageChange && langDraft !== language) {
      onLanguageChange(langDraft);
    }
  }, [
    draft,
    value,
    onChange,
    langDraft,
    language,
    onLanguageChange,
    translating,
  ]);

  // Only commit when focus leaves the entire editing container,
  // not when moving between the language input and the code textarea.
  const handleContainerBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      // relatedTarget is the element receiving focus next
      if (
        containerRef.current &&
        e.relatedTarget &&
        containerRef.current.contains(e.relatedTarget as Node)
      ) {
        // Focus moved to another element inside the container — do nothing
        return;
      }
      commit();
    },
    [commit],
  );

  const doTranslate = useCallback(async () => {
    if (!onTranslate || translating || !draft.trim()) return;
    setTranslating(true);
    try {
      const result = await onTranslate(draft);
      setDraft(result);
    } catch (err) {
      console.error("Translation failed:", err);
    } finally {
      wantsFocusRef.current = true;
      setTranslating(false);
    }
  }, [onTranslate, translating, draft]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (e.key === "Escape") {
        setDraft(value);
        setLangDraft(language);
        setEditing(false);
      } else if (isTranslateShortcut(e) && onTranslate) {
        e.preventDefault();
        doTranslate();
      }
    },
    [value, language, onTranslate, doTranslate],
  );

  if (editing) {
    return (
      <div
        className="editable-code-editing"
        ref={containerRef}
        onBlur={handleContainerBlur}
      >
        <div className="editable-block-toolbar">
          {onLanguageChange && (
            <input
              type="text"
              className="editable-input editable-lang-input"
              value={langDraft}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setLangDraft(e.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder="Language"
            />
          )}
          <TranslateButton
            onClick={doTranslate}
            translating={translating}
            disabled={!onTranslate}
          />
        </div>
        <textarea
          ref={textareaRef}
          className={`editable-textarea editable-code-textarea ${translating ? "translating" : ""}`}
          value={draft}
          rows={4}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            setDraft(e.target.value);
            autoResize(e.target);
          }}
          onKeyDown={handleKeyDown}
          disabled={translating}
        />
        <div className="editable-hint">
          {onTranslate && (
            <>
              <kbd>{shortcutLabel()}</kbd> translate ·{" "}
            </>
          )}
          <kbd>Esc</kbd> cancel · click outside to save
        </div>
      </div>
    );
  }

  return (
    <div
      className={`code-block editable-block-display ${isModified ? "editable-block-display--modified" : ""}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      <div className="code-lang-label">{language || "Code"}</div>
      <pre>
        <code
          className={language ? `hljs language-${language}` : "hljs"}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
      <span className="editable-pencil"> ✎</span>
      <RestoreButton
        visible={isModified && !!onRestore}
        onClick={onRestore!}
        originalValue={originalValue}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeveritySelect
// ---------------------------------------------------------------------------

interface SeveritySelectProps {
  value: string;
  onChange: (newSeverity: string) => void;
  getColor: (severity: string) => SeverityColor;
}

/**
 * Severity dropdown selector styled as the severity badge.
 */
export function SeveritySelect({
  value,
  onChange,
  getColor,
}: SeveritySelectProps): React.ReactElement {
  const colors = getColor(value);

  return (
    <select
      className="severity-select"
      value={value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    >
      {SEVERITY_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
