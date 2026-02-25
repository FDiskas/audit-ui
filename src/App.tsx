import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from "react";
import {
  parseIssue,
  getSeverityColor,
  blockMarkdownToHtml,
  groupByCategory,
} from "./lib/parseIssue";
import { generatePdf } from "./lib/generatePdf";
import { generateDocx } from "./lib/generateDocx";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import TEMPLATE_MD from "./templates/template.md?raw";
import {
  EditableText,
  EditableBlock,
  EditableCode,
  SeveritySelect,
} from "./components/Editable";
import { translateText, translationAvailable } from "./lib/translate";
import type {
  Issue,
  IssueSnapshot,
  FileEntry,
  SavedState,
  EditableField,
  PagedGroupedCategory,
  PagedIssue,
} from "./lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "audit-report-data";

const COMMON_LANGUAGES = [
  "English",
  "Lithuanian",
  "German",
  "French",
  "Spanish",
  "Portuguese",
  "Italian",
  "Dutch",
  "Polish",
  "Ukrainian",
  "Japanese",
  "Chinese",
  "Korean",
];

// Fields that are user-editable (used for dirty detection & restore)
const EDITABLE_FIELDS: EditableField[] = [
  "title",
  "component",
  "overallRisk",
  "findingId",
  "impactDetails",
  "description",
  "codeExample",
  "codeLanguage",
  "exampleScenario",
  "recommendation",
  "extraRows",
];

// ---------------------------------------------------------------------------
// Generate markdown from an issue object (follows the template structure)
// ---------------------------------------------------------------------------

function issueToMarkdown(issue: Issue): string {
  const lines: string[] = [];

  lines.push(`# Issue title: ${issue.title || "Untitled"}`);
  lines.push("");
  lines.push(`Overall Risk: ${issue.overallRisk || "Medium"}`);

  // Extra rows in the severity table
  if (issue.extraRows && issue.extraRows.length > 0) {
    for (const row of issue.extraRows) {
      lines.push(
        `Additional Issue: ${row.title || ""} | ${row.severity || "Medium"}`,
      );
    }
  }
  lines.push(`Impact: ${issue.impact || "Medium"}`);
  lines.push(`Exploitability: ${issue.exploitability || "Medium"}`);
  lines.push(`Finding ID: ${issue.findingId || "ABC-XXXXXX"}`);
  lines.push(`Component: ${issue.component || ""}`);
  lines.push(`Category: ${issue.category || "Uncategorized"}`);
  lines.push(`Status: ${issue.status || "New"}`);
  lines.push("");

  lines.push("## Impact details");
  lines.push("");
  lines.push(issue.impactDetails || "");
  lines.push("");

  lines.push("## Description");
  lines.push("");
  lines.push(issue.description || "");
  lines.push("");
  if (issue.evidence) {
    lines.push(`Evidence: ${issue.evidence}`);
    lines.push("");
  }

  if (issue.codeExample && issue.codeExample.trim().length > 0) {
    debugger
    lines.push("### Code example");
    lines.push("");
    lines.push(`\`\`\`${issue.codeLanguage || ""}`);
    lines.push(issue.codeExample);
    lines.push("```");
    lines.push("");
  }

  lines.push("### Example issue scenario");
  lines.push("");
  lines.push(issue.exampleScenario || "");
  lines.push("");

  lines.push("## Recommendation");
  lines.push("");
  lines.push(issue.recommendation || "");
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadSavedState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedState) : null;
  } catch (e) {
    console.warn("Failed to load saved state:", e);
    return null;
  }
}

const initialSaved = loadSavedState();

let nextIssueId = initialSaved?.nextIssueId || 1;

// ---------------------------------------------------------------------------
// Relative-time formatter
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string | null): string | null {
  if (!isoString) return null;
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App(): React.ReactElement {
  // -- core state (restored from localStorage when available) ---------------
  const [files, setFiles] = useState<FileEntry[]>(initialSaved?.files || []);
  const [issues, setIssues] = useState<Issue[]>(initialSaved?.issues || []);
  const [originals, setOriginals] = useState<Record<number, IssueSnapshot>>(
    initialSaved?.originals || {},
  );
  const [targetLanguage, setTargetLanguage] = useState<string>(
    initialSaved?.targetLanguage || "Lithuanian",
  );
  const [lastSaved, setLastSaved] = useState<string | null>(
    initialSaved?.lastSaved || null,
  );

  // -- transient UI state (never persisted) ---------------------------------
  const [dragOver, setDragOver] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [translatingPages, setTranslatingPages] = useState<Set<number>>(
    new Set(),
  );
  const [lastSavedDisplay, setLastSavedDisplay] = useState<string | null>(
    formatRelativeTime(initialSaved?.lastSaved ?? null),
  );
  const [scrollToIssueId, setScrollToIssueId] = useState<number | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Auto-save to localStorage (debounced 500 ms)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const ts = new Date().toISOString();
        const data: SavedState = {
          files,
          issues,
          originals,
          nextIssueId,
          targetLanguage,
          lastSaved: ts,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        setLastSaved(ts);
      } catch (e) {
        console.warn("Auto-save failed:", e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [files, issues, originals, targetLanguage]);

  // Scroll to newly created issue page after render
  useEffect(() => {
    if (scrollToIssueId == null) return;
    // Use a short timeout to let React finish rendering the new page
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-issue-id="${scrollToIssueId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setScrollToIssueId(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollToIssueId]);

  // Tick the relative-time display every 15 s
  useEffect(() => {
    if (!lastSaved) return;
    setLastSavedDisplay(formatRelativeTime(lastSaved));
    const interval = setInterval(() => {
      setLastSavedDisplay(formatRelativeTime(lastSaved));
    }, 15_000);
    return () => clearInterval(interval);
  }, [lastSaved]);

  // -----------------------------------------------------------------------
  // Show/hide scroll-to-top button based on scroll position
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // -----------------------------------------------------------------------
  // File handling
  // -----------------------------------------------------------------------
  const processFiles = useCallback(async (fileList: FileList) => {
    const mdFiles = Array.from(fileList).filter(
      (f) => f.name.endsWith(".md") || f.type === "text/markdown",
    );

    if (mdFiles.length === 0) {
      alert("Please upload .md files only.");
      return;
    }

    const newFiles: FileEntry[] = [];
    const newIssues: Issue[] = [];
    const newOriginals: Record<number, IssueSnapshot> = {};

    for (const file of mdFiles) {
      const content = await file.text();
      const parsed = parseIssue(content);
      const id = nextIssueId++;
      const issue: Issue = { ...parsed, _id: id };

      newFiles.push({ name: file.name, content });
      newIssues.push(issue);

      // Snapshot the original parsed state (without _id)
      const { _id: _, ...rest } = issue;
      newOriginals[issue._id] = { ...rest };
    }

    setFiles((prev) => [...prev, ...newFiles]);
    setIssues((prev) => [...prev, ...newIssues]);
    setOriginals((prev) => ({ ...prev, ...newOriginals }));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        processFiles(e.target.files);
      }
      e.target.value = "";
    },
    [processFiles],
  );

  const removeFile = useCallback(
    (index: number) => {
      const removedIssue = issues[index];
      setFiles((prev) => prev.filter((_, i) => i !== index));
      setIssues((prev) => prev.filter((_, i) => i !== index));
      if (removedIssue) {
        setOriginals((prev) => {
          const next = { ...prev };
          delete next[removedIssue._id];
          return next;
        });
      }
    },
    [issues],
  );

  const clearAll = useCallback(() => {
    if (
      issues.length > 0 &&
      !window.confirm(
        "Clear all files and edits? This will also remove saved data from browser storage.",
      )
    ) {
      return;
    }
    setFiles([]);
    setIssues([]);
    setOriginals({});
    setLastSaved(null);
    setLastSavedDisplay(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
  }, [issues]);

  // -----------------------------------------------------------------------
  // Extra rows in severity table
  // -----------------------------------------------------------------------
  const addExtraRow = useCallback((issueId: number) => {
    setIssues((prev) =>
      prev.map((iss) =>
        iss._id === issueId
          ? {
              ...iss,
              extraRows: [
                ...(iss.extraRows || []),
                { title: "", severity: "Medium" },
              ],
            }
          : iss,
      ),
    );
  }, []);

  const removeExtraRow = useCallback((issueId: number, rowIndex: number) => {
    setIssues((prev) =>
      prev.map((iss) => {
        if (iss._id !== issueId) return iss;
        const rows = [...(iss.extraRows || [])];
        rows.splice(rowIndex, 1);
        return { ...iss, extraRows: rows };
      }),
    );
  }, []);

  const updateExtraRow = useCallback(
    (issueId: number, rowIndex: number, field: string, value: string) => {
      setIssues((prev) =>
        prev.map((iss) => {
          if (iss._id !== issueId) return iss;
          const rows = [...(iss.extraRows || [])];
          rows[rowIndex] = { ...rows[rowIndex], [field]: value };
          return { ...iss, extraRows: rows };
        }),
      );
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Add new blank page
  // -----------------------------------------------------------------------
  const addNewPage = useCallback(() => {
    const category = window.prompt("Enter category for the new page:");
    if (category === null) return; // user cancelled
    const cat = category.trim() || "Uncategorized";

    const newIssue: Issue = {
      _id: nextIssueId++,
      title: "",
      overallRisk: "Medium",
      impact: "Medium",
      exploitability: "Medium",
      findingId: "",
      component: "",
      category: cat,
      status: "New",
      impactDetails: "",
      description: "",
      evidence: "",
      codeExample: "",
      codeLanguage: "",
      exampleScenario: "",
      recommendation: "",
      extraRows: [],
    };

    // Add a synthetic file entry to keep files/issues arrays in sync
    const syntheticFile: FileEntry = {
      name: `New-${cat.replace(/\s+/g, "-")}-${newIssue._id}.md`,
      content: "",
      _isManual: true,
    };

    // Snapshot empty original (so restore works — restores to blank)
    const { _id: _, ...rest } = newIssue;
    setFiles((prev) => [...prev, syntheticFile]);
    setIssues((prev) => [...prev, newIssue]);
    setOriginals((prev) => ({ ...prev, [newIssue._id]: { ...rest } }));
    setScrollToIssueId(newIssue._id);
  }, []);

  // -----------------------------------------------------------------------
  // Reindex Finding IDs with leading zeroes, major number per category
  // -----------------------------------------------------------------------
  const reindexFindingIds = useCallback(() => {
    // Detect default prefix from existing findingIds (e.g. "ABC" from "ABC-0001")
    let defaultPrefix = "ABC";
    for (const iss of issues) {
      if (iss.findingId) {
        const m = iss.findingId.match(/^([A-Za-z]+)-/);
        if (m) {
          defaultPrefix = m[1];
          break;
        }
      }
    }

    // Prompt user for prefix
    const input = window.prompt("Enter Finding ID prefix:", defaultPrefix);
    if (input === null) return; // user cancelled
    const prefix = input.trim() || defaultPrefix;

    // Build the grouped order (same as the preview TOC order)
    const groups = groupByCategory(issues);

    // Each category gets a major number (0, 1, 2, …).
    // Within each category, issues are numbered sequentially starting at 1.
    // Result: PREFIX-0001, PREFIX-0002, …, PREFIX-1001, PREFIX-1002, …
    const idMap = new Map<number, string>();
    groups.forEach((group, catIndex) => {
      group.issues.forEach((iss, issueIndex) => {
        const majorNum = catIndex * 1000;
        const minorNum = issueIndex + 1;
        const num = majorNum + minorNum;
        const padded = String(num).padStart(4, "0");
        idMap.set(iss._id, `${prefix}-${padded}`);
      });
    });

    // Apply the new IDs
    setIssues((prev) =>
      prev.map((iss) =>
        idMap.has(iss._id) ? { ...iss, findingId: idMap.get(iss._id)! } : iss,
      ),
    );
  }, [issues]);

  // -----------------------------------------------------------------------
  // Download markdown for a single issue
  // -----------------------------------------------------------------------
  const downloadIssueMd = useCallback(
    (issueId: number) => {
      const issue = issues.find((i) => i._id === issueId);
      if (!issue) return;

      const md = issueToMarkdown(issue);
      const filename =
        (issue.findingId || `issue-${issueId}`).replace(/[/\\]/g, "-") +
        "-" +
        (issue.title || "untitled")
          .replace(/[/\\]/g, "-")
          .replace(/\s+/g, "-")
          .slice(0, 40) +
        ".md";

      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [issues],
  );

  // -----------------------------------------------------------------------
  // Download ALL issue markdown files as a ZIP
  // -----------------------------------------------------------------------
  const downloadAllMd = useCallback(async () => {
    if (issues.length === 0) return;
    const zip = new JSZip();
    for (const issue of issues) {
      const md = issueToMarkdown(issue);
      const filename =
        (issue.findingId || `issue-${issue._id}`).replace(/[/\\]/g, "-") +
        "-" +
        (issue.title || "untitled")
          .replace(/[/\\]/g, "-")
          .replace(/\s+/g, "-")
          .slice(0, 40) +
        ".md";
      zip.file(filename, md);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "audit-issues.zip");
  }, [issues]);

  // -----------------------------------------------------------------------
  // Issue editing
  // -----------------------------------------------------------------------
  const updateIssue = useCallback(
    (issueId: number, field: string, value: string) => {
      setIssues((prev) =>
        prev.map((iss) =>
          iss._id === issueId ? { ...iss, [field]: value } : iss,
        ),
      );
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Restore helpers
  // -----------------------------------------------------------------------
  const isFieldModified = useCallback(
    (issueId: number, field: EditableField): boolean => {
      const orig = originals[issueId];
      if (!orig) return false;
      const issue = issues.find((i) => i._id === issueId);
      if (!issue) return false;
      // Deep compare for array fields like extraRows
      if (field === "extraRows") {
        return (
          JSON.stringify(issue[field] || []) !==
          JSON.stringify(orig[field] || [])
        );
      }
      return issue[field] !== orig[field];
    },
    [originals, issues],
  );

  const restoreField = useCallback(
    (issueId: number, field: EditableField) => {
      const orig = originals[issueId];
      if (!orig) return;
      setIssues((prev) =>
        prev.map((iss) =>
          iss._id === issueId ? { ...iss, [field]: orig[field] } : iss,
        ),
      );
    },
    [originals],
  );

  const restoreIssue = useCallback(
    (issueId: number) => {
      const orig = originals[issueId];
      if (!orig) return;
      setIssues((prev) =>
        prev.map((iss) =>
          iss._id === issueId ? { ...orig, _id: issueId } : iss,
        ),
      );
    },
    [originals],
  );

  const isIssueModified = useCallback(
    (issueId: number): boolean => {
      return EDITABLE_FIELDS.some((f) => isFieldModified(issueId, f));
    },
    [isFieldModified],
  );

  // -----------------------------------------------------------------------
  // Translation
  // -----------------------------------------------------------------------
  const handleTranslate = useCallback(
    async (text: string): Promise<string> => {
      if (!translationAvailable) {
        // translation disabled; just return input
        return text;
      }
      if (!targetLanguage.trim()) {
        alert("Please set a target language first.");
        return text;
      }
      return await translateText(text, targetLanguage);
    },
    [targetLanguage],
  );

  const translateIssuePage = useCallback(
    async (issueId: number) => {
      if (!translationAvailable) {
        alert("Translation service is not configured.");
        return;
      }
      if (!targetLanguage.trim()) {
        alert("Please set a target language first.");
        return;
      }

      const issue = issues.find((iss) => iss._id === issueId);
      if (!issue) return;

      setTranslatingPages((prev) => new Set(prev).add(issueId));

      const translatableFields: Array<keyof Issue> = [
        "title",
        "component",
        "impactDetails",
        "description",
        "exampleScenario",
        "recommendation",
      ];

      try {
        const updates: Partial<Issue> = {};
        const results = await Promise.allSettled(
          translatableFields.map(async (field) => {
            const val = issue[field];
            if (typeof val === "string" && val.trim()) {
              const translated = await translateText(val, targetLanguage);
              return { field, translated };
            }
            return { field, translated: val };
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            (updates as Record<string, unknown>)[result.value.field] =
              result.value.translated;
          }
        }

        // Translate extra row titles in parallel
        let translatedExtraRows = issue.extraRows || [];
        if (translatedExtraRows.length > 0) {
          const extraResults = await Promise.allSettled(
            translatedExtraRows.map(async (row) => {
              if (row.title && row.title.trim()) {
                const translated = await translateText(
                  row.title,
                  targetLanguage,
                );
                return { ...row, title: translated };
              }
              return row;
            }),
          );
          translatedExtraRows = extraResults.map((r, i) =>
            r.status === "fulfilled" ? r.value : translatedExtraRows[i],
          );
          updates.extraRows = translatedExtraRows;
        }

        setIssues((prev) =>
          prev.map((iss) =>
            iss._id === issueId ? { ...iss, ...updates } : iss,
          ),
        );
      } catch (err) {
        console.error("Page translation error:", err);
        alert("Translation failed. Check console for details.");
      } finally {
        setTranslatingPages((prev) => {
          const next = new Set(prev);
          next.delete(issueId);
          return next;
        });
      }
    },
    [issues, targetLanguage],
  );

  // helper exposed to Editable components; will be undefined if translation
  // should be turned off either because there's no API key or no language set.
  const translateCallback =
    translationAvailable && targetLanguage.trim() ? handleTranslate : undefined;


  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------
  const handleExportPdf = useCallback(async () => {
    if (issues.length === 0) return;
    setGenerating(true);
    try {
      await generatePdf(issues, previewRef.current!);
    } catch (err) {
      console.error("PDF generation error:", err);
      alert("Failed to generate PDF. See console for details.");
    }
    setGenerating(false);
  }, [issues]);

  const handleExportDocx = useCallback(async () => {
    if (issues.length === 0) return;
    setGenerating(true);
    try {
      await generateDocx(issues);
    } catch (err) {
      console.error("DOCX generation error:", err);
      alert("Failed to generate DOCX. See console for details.");
    }
    setGenerating(false);
  }, [issues]);

  // -----------------------------------------------------------------------
  // Template helpers
  // -----------------------------------------------------------------------
  const handleCopyTemplate = useCallback(() => {
    navigator.clipboard.writeText(TEMPLATE_MD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const handleDownloadTemplate = useCallback(() => {
    const blob = new Blob([TEMPLATE_MD], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ABC-100000-example-issue.md";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // -----------------------------------------------------------------------
  // Grouped issues
  // -----------------------------------------------------------------------
  const grouped: PagedGroupedCategory[] = useMemo(() => {
    const groups = groupByCategory(issues);
    let page = 0;
    return groups.map((group) => ({
      ...group,
      issues: group.issues.map((issue) => {
        page++;
        return { ...issue, _pageNumber: page } as PagedIssue;
      }),
    }));
  }, [issues]);

  // -----------------------------------------------------------------------
  // Helpers to get original values for a given issue
  // -----------------------------------------------------------------------
  const getOriginal = useCallback(
    (issueId: number, field: EditableField): string | undefined => {
      const orig = originals[issueId];
      if (!orig) return undefined;
      const val = orig[field];
      return typeof val === "string" ? val : undefined;
    },
    [originals],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="app">
      <header className="app-header">
        <h1>🛡️ Audit Report Generator</h1>
        <p className="subtitle">
          Upload audit issue markdown files and generate PDF or DOCX reports
        </p>
      </header>

      <main className="app-main">
        {/* Upload Section */}
        <section className="upload-section">
          <div
            className={`drop-zone ${dragOver ? "drag-over" : ""}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="drop-zone-content">
              <div className="drop-icon">📁</div>
              <p className="drop-text">
                Drag & drop <code>.md</code> issue files here
              </p>
              <p className="drop-subtext">or click to browse</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown"
              multiple
              onChange={handleFileInput}
              style={{ display: "none" }}
            />
          </div>

          {files.length > 0 && (
            <div
              className={`file-list ${filesCollapsed ? "file-list--collapsed" : ""}`}
            >
              <div
                className="file-list-header file-list-header--clickable"
                onClick={() => setFilesCollapsed((prev) => !prev)}
                title={
                  filesCollapsed ? "Expand file list" : "Collapse file list"
                }
              >
                <h3>
                  <span
                    className={`collapse-chevron ${filesCollapsed ? "collapsed" : ""}`}
                  >
                    ▾
                  </span>{" "}
                  📄 Uploaded Files ({files.length})
                </h3>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearAll();
                  }}
                >
                  Clear All
                </button>
              </div>
              {!filesCollapsed && (
                <ul>
                  {files.map((file, index) => (
                    <li key={index} className="file-item">
                      <span
                        className="file-name file-name--clickable"
                        onClick={(e) => {
                          e.stopPropagation();
                          const issue = issues[index];
                          if (issue) {
                            const el = document.getElementById(
                              `issue-${issue._id}`,
                            );
                            if (el)
                              el.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                          }
                        }}
                        title="Click to scroll to this issue"
                      >
                        {file.name}
                      </span>
                      <button
                        className="btn-remove"
                        onClick={() => removeFile(index)}
                        title="Remove file"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {issues.length > 0 && (
            <div className="export-buttons">
              <button
                className="btn btn-primary"
                onClick={handleExportPdf}
                disabled={generating}
              >
                {generating ? "⏳ Generating..." : "📄 Export as PDF"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleExportDocx}
                disabled={generating}
              >
                {generating ? "⏳ Generating..." : "📝 Export as DOCX"}
              </button>
              <button
                className="btn btn-outline"
                onClick={downloadAllMd}
                title="Download all issues as .md files in a ZIP archive"
              >
                ⬇️ Download All .md
              </button>
              <button className="btn btn-outline" onClick={addNewPage}>
                ➕ Add New Page
              </button>
            </div>
          )}

          {/* Template example shown when no files are uploaded */}
          {/* Add New Page button — also shown when no files uploaded */}
          {files.length === 0 && (
            <div className="export-buttons" style={{ marginTop: "1rem" }}>
              <button className="btn btn-outline" onClick={addNewPage}>
                ➕ Add New Page
              </button>
            </div>
          )}

          {files.length === 0 && (
            <div className="template-section">
              <div className="template-header">
                <h3>📋 Expected Markdown Template</h3>
                <p className="template-description">
                  Each <code>.md</code> file should follow this structure. Copy
                  the template below or download it as a starting point.
                </p>
              </div>
              <div className="template-actions">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={handleCopyTemplate}
                >
                  {copied ? "✅ Copied!" : "📋 Copy to clipboard"}
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={handleDownloadTemplate}
                >
                  ⬇️ Download template
                </button>
              </div>
              <div className="template-code">
                <pre>
                  <code>{TEMPLATE_MD}</code>
                </pre>
              </div>
            </div>
          )}
        </section>

        {/* Preview Section */}
        {issues.length > 0 && (
          <section className="preview-section">
            <div className="preview-header">
              <h2>Preview</h2>
              <div className="preview-header-right">
                {lastSavedDisplay && (
                  <span
                    className="last-saved-indicator"
                    title={lastSaved || undefined}
                  >
                    Saved {lastSavedDisplay}
                  </span>
                )}
                {translationAvailable && (
                  <div className="language-selector">
                    <label htmlFor="target-lang" className="language-label">
                      🌐 Translate to:
                    </label>
                    <input
                      id="target-lang"
                      type="text"
                      list="lang-suggestions"
                      className="language-input"
                      value={targetLanguage}
                      onChange={(e) => setTargetLanguage(e.target.value)}
                      placeholder="e.g. Lithuanian"
                      disabled={!translationAvailable}
                    />
                    <datalist id="lang-suggestions">
                      {COMMON_LANGUAGES.map((lang) => (
                        <option key={lang} value={lang} />
                      ))}
                    </datalist>
                  </div>
                )}
              </div>
            </div>
            <div className="preview-container" ref={previewRef}>
              {/* Table of Contents Page */}
              <div className="issue-page toc-page">
                <div
                  className="no-export"
                  style={{
                    position: "relative",
                  }}
                >
                  <h1 className="toc-title">Table of Contents</h1>
                  <button
                    className="btn btn-sm btn-download-md"
                    onClick={reindexFindingIds}
                    title="Reindex all Finding IDs sequentially"
                    style={{
                      position: "absolute",
                      right: "1rem",
                      top: "1rem",
                    }}
                  >
                    🔢
                  </button>
                </div>
                <div className="toc-list">
                  {grouped.map((group) => (
                    <div key={group.category} className="toc-category">
                      <h3 className="toc-category-title">
                        {group.category}
                        <span className="toc-category-count">
                          {" "}
                          ({group.issues.length})
                        </span>
                      </h3>
                      <ul className="toc-items">
                        {group.issues.map((issue) => {
                          const sevColor = getSeverityColor(issue.overallRisk);
                          return (
                            <li key={issue._id} className="toc-item">
                              <a
                                href={`#issue-${issue._id}`}
                                className="toc-link"
                                onClick={(e) => {
                                  e.preventDefault();
                                  const el = document.getElementById(
                                    `issue-${issue._id}`,
                                  );
                                  if (el)
                                    el.scrollIntoView({
                                      behavior: "smooth",
                                      block: "start",
                                    });
                                }}
                              >
                                <span className="toc-finding-id">
                                  {issue.findingId || "—"}
                                </span>
                                <span className="toc-issue-title">
                                  {issue.title || issue.component || "Untitled"}
                                </span>
                                <span
                                  className="toc-severity-badge"
                                  style={{
                                    backgroundColor: sevColor.bg,
                                    color: sevColor.text,
                                  }}
                                >
                                  {issue.overallRisk || "N/A"}
                                </span>
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {grouped.map((group) => {
                return (
                  <React.Fragment key={group.category}>
                    {/* Issue Pages within this category */}
                    {group.issues.map((issue) => {
                      const id = issue._id;
                      const sevColor = getSeverityColor(issue.overallRisk);
                      const isPageTranslating = translatingPages.has(id);
                      const pageModified = isIssueModified(id);
                      return (
                        <div
                          key={id}
                          id={`issue-${id}`}
                          data-issue-id={id}
                          className={`issue-page ${pageModified ? "issue-page--modified" : ""}`}
                        >
                          {/* Top action bar */}
                          <div className="page-action-bar">
                            {pageModified && (
                              <button
                                className="btn btn-sm btn-restore-page"
                                onClick={() => restoreIssue(id)}
                                title="Restore all fields to original content"
                              >
                                ↩ Restore original
                              </button>
                            )}
                            <button
                              className="btn btn-sm btn-translate-page"
                              onClick={() => translateIssuePage(id)}
                              disabled={
                                isPageTranslating || !targetLanguage.trim() || !translationAvailable
                              }
                              title={`Translate all fields to ${targetLanguage}`}
                            >
                              {isPageTranslating ? "⏳ Translating…" : "🌐"}
                            </button>
                            <button
                              className="btn btn-sm btn-download-md"
                              onClick={() => downloadIssueMd(id)}
                              title="Download this page as Markdown"
                            >
                              ⬇️ .md
                            </button>
                          </div>

                          {/* Component Title — editable */}
                          <EditableText
                            value={issue.component || issue.title}
                            onChange={(v) => updateIssue(id, "component", v)}
                            tag="h2"
                            className="issue-component"
                            placeholder="Component name"
                            onTranslate={translateCallback}
                            originalValue={
                              getOriginal(id, "component") ||
                              getOriginal(id, "title")
                            }
                            onRestore={() => restoreField(id, "component")}
                          />

                          {/* Finding ID — editable */}
                          <p className="issue-id">
                            <strong>
                              ID:{" "}
                              <EditableText
                                value={issue.findingId}
                                onChange={(v) =>
                                  updateIssue(id, "findingId", v)
                                }
                                tag="span"
                                placeholder="ABC-XXXXXX"
                                originalValue={getOriginal(id, "findingId")}
                                onRestore={() => restoreField(id, "findingId")}
                              />
                            </strong>
                          </p>

                          {/* Issue / Severity table */}
                          <table className="issue-table">
                            <thead>
                              <tr>
                                <th className="issue-col">Issue</th>
                                <th className="severity-col">Severity</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>
                                  <EditableText
                                    value={issue.title}
                                    onChange={(v) =>
                                      updateIssue(id, "title", v)
                                    }
                                    tag="span"
                                    placeholder="Issue title"
                                    onTranslate={translateCallback}
                                    originalValue={getOriginal(id, "title")}
                                    onRestore={() => restoreField(id, "title")}
                                  />
                                </td>
                                <td>
                                  <SeveritySelect
                                    value={issue.overallRisk}
                                    onChange={(v) =>
                                      updateIssue(id, "overallRisk", v)
                                    }
                                    getColor={getSeverityColor}
                                  />
                                  {isFieldModified(id, "overallRisk") && (
                                    <button
                                      className="restore-field-btn severity-restore"
                                      onClick={() =>
                                        restoreField(id, "overallRisk")
                                      }
                                      title={`Restore original: ${getOriginal(id, "overallRisk")}`}
                                    >
                                      ↩
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {/* Extra rows */}
                              {(issue.extraRows || []).map((row, ri) => {
                                const rowSevColor = getSeverityColor(
                                  row.severity,
                                );
                                return (
                                  <tr key={`extra-${ri}`} className="extra-row">
                                    <td>
                                      <EditableText
                                        value={row.title}
                                        onChange={(v) =>
                                          updateExtraRow(id, ri, "title", v)
                                        }
                                        tag="span"
                                        placeholder="Issue title"
                                        onTranslate={translateCallback}
                                      />
                                    </td>
                                    <td>
                                      <div className="extra-row-severity">
                                        <SeveritySelect
                                          value={row.severity}
                                          onChange={(v) =>
                                            updateExtraRow(
                                              id,
                                              ri,
                                              "severity",
                                              v,
                                            )
                                          }
                                          getColor={getSeverityColor}
                                        />
                                        <button
                                          className="btn-remove-row"
                                          onClick={() => removeExtraRow(id, ri)}
                                          title="Remove this row"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <button
                            className="btn btn-sm btn-add-row"
                            onClick={() => addExtraRow(id)}
                            title="Add another issue row to the table"
                          >
                            + Add Issue Row
                          </button>

                          {/* Impact details — editable */}
                          <div className={issue.impactDetails ? "issue-section" : "no-export"}>
                            <h4 className="section-label">Impact details:</h4>
                            <EditableBlock
                              value={issue.impactDetails}
                              onChange={(v) =>
                                updateIssue(id, "impactDetails", v)
                              }
                              placeholder="Click to add impact details…"
                              onTranslate={translateCallback}
                              originalValue={getOriginal(id, "impactDetails")}
                              onRestore={() =>
                                restoreField(id, "impactDetails")
                              }
                            >
                              {issue.impactDetails ? (
                                <div
                                  dangerouslySetInnerHTML={{
                                    __html: blockMarkdownToHtml(
                                      issue.impactDetails,
                                    ),
                                  }}
                                />
                              ) : (
                                <p className="editable-placeholder">
                                  Click to add impact details…
                                </p>
                              )}
                            </EditableBlock>
                          </div>

                          {/* Description — editable */}
                          <div className={issue.description ? "issue-section" : "no-export"}>
                            <h4 className="section-label">Description:</h4>
                            <EditableBlock
                              value={issue.description}
                              onChange={(v) =>
                                updateIssue(id, "description", v)
                              }
                              placeholder="Click to add description…"
                              onTranslate={translateCallback}
                              originalValue={getOriginal(id, "description")}
                              onRestore={() => restoreField(id, "description")}
                            >
                              {issue.description ? (
                                <div
                                  dangerouslySetInnerHTML={{
                                    __html: blockMarkdownToHtml(
                                      issue.description,
                                    ),
                                  }}
                                />
                              ) : (
                                <p className="editable-placeholder">
                                  Click to add description…
                                </p>
                              )}
                            </EditableBlock>
                          </div>

                          {/* Code example — editable */}
                          <div className={issue.codeExample ? "issue-section" : "no-export"}>
                            <h4 className="section-label">Code example:</h4>
                            {issue.codeExample ? (
                              <EditableCode
                                value={issue.codeExample}
                                language={issue.codeLanguage}
                                onChange={(v) =>
                                  updateIssue(id, "codeExample", v)
                                }
                                onLanguageChange={(v) =>
                                  updateIssue(id, "codeLanguage", v)
                                }
                                onTranslate={translateCallback}
                                originalValue={getOriginal(id, "codeExample")}
                                onRestore={() =>
                                  restoreField(id, "codeExample")
                                }
                              />
                            ) : (
                              <EditableCode
                                value=""
                                language=""
                                onChange={(v) =>
                                  updateIssue(id, "codeExample", v)
                                }
                                onLanguageChange={(v) =>
                                  updateIssue(id, "codeLanguage", v)
                                }
                                onTranslate={translateCallback}
                                originalValue={getOriginal(id, "codeExample")}
                                onRestore={() =>
                                  restoreField(id, "codeExample")
                                }
                              />
                            )}
                          </div>

                          {/* Example issue scenario — editable */}
                          <div className={issue.exampleScenario ? "issue-section" : "no-export"}>
                            <h4 className="section-label">
                              Example issue scenario:
                            </h4>
                            <EditableBlock
                              value={issue.exampleScenario}
                              onChange={(v) =>
                                updateIssue(id, "exampleScenario", v)
                              }
                              placeholder="Click to add example scenario…"
                              onTranslate={translateCallback}
                              originalValue={getOriginal(id, "exampleScenario")}
                              onRestore={() =>
                                restoreField(id, "exampleScenario")
                              }
                            >
                              {issue.exampleScenario ? (
                                <div
                                  dangerouslySetInnerHTML={{
                                    __html: blockMarkdownToHtml(
                                      issue.exampleScenario,
                                    ),
                                  }}
                                />
                              ) : (
                                <p className="editable-placeholder">
                                  Click to add example scenario…
                                </p>
                              )}
                            </EditableBlock>
                          </div>

                          {/* Recommendation — editable */}
                          <div className={issue.recommendation ? "issue-section" : "no-export"}>
                            <h4 className="section-label">Recommendation:</h4>
                            <EditableBlock
                              value={issue.recommendation}
                              onChange={(v) =>
                                updateIssue(id, "recommendation", v)
                              }
                              placeholder="Click to add recommendations…"
                              onTranslate={translateCallback}
                              originalValue={getOriginal(id, "recommendation")}
                              onRestore={() =>
                                restoreField(id, "recommendation")
                              }
                            >
                              {issue.recommendation ? (
                                <div
                                  dangerouslySetInnerHTML={{
                                    __html: blockMarkdownToHtml(
                                      issue.recommendation,
                                    ),
                                  }}
                                />
                              ) : (
                                <p className="editable-placeholder">
                                  Click to add recommendations…
                                </p>
                              )}
                            </EditableBlock>
                          </div>

                          {/* Page number */}
                          <div className="page-number">{issue._pageNumber}</div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* Scroll to top floating button */}
      {showScrollTop && (
        <button
          className="btn-scroll-top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          ↑
        </button>
      )}
    </div>
  );
}

export default App;
