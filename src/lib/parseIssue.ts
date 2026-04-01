import type { GroupedCategory, Issue, SeverityColor } from "./types";

/**
 * Parses an audit issue markdown file into a structured object.
 *
 * Expected markdown structure:
 * # Issue title: <title>
 *
 * Overall Risk: <risk>
 * Impact: <impact>
 * Exploitability: <exploitability>
 * Finding ID: <id>
 * Component: <component>
 * Category: <category>
 * Status: <status>
 *
 * ## Impact details
 * ...
 *
 * ## Description
 * ...
 *
 * ### Code example
 * ...
 *
 * ### Example issue scenario
 * ...
 *
 * ## Recommendation
 * ...
 */

export function parseIssue(markdownContent: string): Omit<Issue, "_id"> {
  const normalizedContent = normalizeMarkdown(markdownContent);

  const issue: Omit<Issue, "_id"> = {
    title: "",
    overallRisk: "",
    impact: "",
    exploitability: "",
    findingId: "",
    component: "",
    category: "",
    status: "",
    impactDetails: "",
    description: "",
    evidence: "",
    codeExample: "",
    codeLanguage: "",
    exampleScenario: "",
    recommendation: "",
    extraRows: [],
  };

  // Extract title from heading (supports "Issue title:" and plain H1 variants)
  issue.title = extractTitle(normalizedContent);

  // Extract metadata fields
  const metaPatterns: Record<string, RegExp> = {
    overallRisk: /^\s*overall\s*risk\s*:\s*(.+)$/im,
    impact: /^\s*impact\s*:\s*(.+)$/im,
    exploitability: /^\s*exploitability\s*:\s*(.+)$/im,
    findingId: /^\s*finding\s*id\s*:\s*(.+)$/im,
    component: /^\s*component\s*:\s*(.+)$/im,
    category: /^\s*category\s*:\s*(.+)$/im,
    status: /^\s*status\s*:\s*(.+)$/im,
  };

  for (const [key, pattern] of Object.entries(metaPatterns)) {
    const match = normalizedContent.match(pattern);
    if (match) {
      (issue as Record<string, unknown>)[key] = match[1].trim();
    }
  }

  // Extract additional issue rows (format: "Additional Issue: Title | Severity")
  const extraRowPattern = /^\s*additional\s*issue\s*:\s*(.+)$/gim;
  let extraMatch: RegExpExecArray | null;
  while ((extraMatch = extraRowPattern.exec(normalizedContent)) !== null) {
    const parts = extraMatch[1].split("|");
    const rowTitle = (parts[0] || "").trim();
    const rowSeverity = (parts[1] || "Medium").trim();
    issue.extraRows.push({ title: rowTitle, severity: rowSeverity });
  }

  // Split content into sections based on ## and ### headings
  const sections = splitSections(normalizedContent);

  // Extract Impact details
  if (sections["impact details"]) {
    issue.impactDetails = sections["impact details"].trim();
  }

  // Extract Description
  if (sections["description"]) {
    const descContent = sections["description"];

    // Separate out the code example and example issue scenario subsections
    const mainDesc = extractMainContent(descContent);
    issue.description = mainDesc.trim();

    // Extract evidence links
    const evidenceMatch = descContent.match(/^\s*evidence\s*:\s*(.+)$/im);
    if (evidenceMatch) {
      issue.evidence = evidenceMatch[1].trim();
    }
  }

  // Extract Code example
  if (sections["code example"]) {
    const codeContent = sections["code example"];

    // Extract the fenced code block
    const codeBlockMatch = codeContent.match(/```(\w*)\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      issue.codeLanguage = codeBlockMatch[1] || "text";
      issue.codeExample = codeBlockMatch[2].trim();
    } else {
      // No fenced code block, use the raw content
      issue.codeExample = codeContent.trim();
    }
  }

  // Extract Example issue scenario
  if (sections["example issue scenario"]) {
    issue.exampleScenario = sections["example issue scenario"].trim();
  }

  // Extract Recommendation
  if (sections["recommendation"]) {
    issue.recommendation = sections["recommendation"].trim();
  }

  return issue;
}

/**
 * Split markdown content into sections keyed by heading text (lowercased).
 * Handles both ## and ### headings.
 */
function splitSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split("\n");

  let currentKey: string | null = null;
  let currentLines: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
    }

    const headingMatch = !inCodeFence ? line.match(/^#{2,3}\s+(.+)$/) : null;
    if (headingMatch) {
      // Save previous section
      if (currentKey !== null) {
        sections[currentKey] = currentLines.join("\n");
      }
      currentKey = headingMatch[1].trim().toLowerCase();
      currentLines = [];
    } else if (currentKey !== null) {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentKey !== null) {
    sections[currentKey] = currentLines.join("\n");
  }

  return sections;
}

/**
 * Extract only the main content of the description section,
 * removing sub-sections that start with ### headings.
 */
function extractMainContent(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    if (line.match(/^###\s+/)) {
      break;
    }
    result.push(line);
  }

  return result.join("\n");
}

/**
 * Parse multiple markdown files and return an array of parsed issues.
 */
export function parseMultipleIssues(filesContent: string[]): Array<Omit<Issue, "_id">> {
  return filesContent.map((content) => parseIssue(content));
}

function normalizeMarkdown(content: string): string {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function extractTitle(content: string): string {
  const issueTitleMatch = content.match(/^\s*#\s+issue\s*title\s*:\s*(.+)$/im);
  if (issueTitleMatch) {
    return issueTitleMatch[1].trim();
  }

  const genericH1Match = content.match(/^\s*#\s+(.+)$/m);
  if (genericH1Match) {
    return genericH1Match[1].trim();
  }

  return "";
}

/**
 * Severity sort order — lower number = higher priority.
 */
const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  informational: 4,
};

function severityRank(severity: string): number {
  const s = (severity || "").toLowerCase();
  return SEVERITY_ORDER[s] !== undefined ? SEVERITY_ORDER[s] : 5;
}

/**
 * Groups an array of parsed issues by their `category` field.
 * Returns an array of { category, issues } objects, sorted alphabetically
 * by category name. Issues within each category are sorted by severity
 * (Critical → High → Medium → Low → Info).
 */
export function groupByCategory(issues: Issue[]): GroupedCategory[] {
  const map = new Map<string, Issue[]>();

  for (const issue of issues) {
    const cat = issue.category || "Uncategorized";
    if (!map.has(cat)) {
      map.set(cat, []);
    }
    map.get(cat)!.push(issue);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({
      category,
      issues: items.slice().sort((a, b) => severityRank(a.overallRisk) - severityRank(b.overallRisk)),
    }));
}

/**
 * Returns a color for the severity/risk level badge.
 */
export function getSeverityColor(severity: string): SeverityColor {
  const s = (severity || "").toLowerCase();
  switch (s) {
    case "critical":
      return { bg: "#8b0000", text: "#ffffff" };
    case "high":
      return { bg: "#e74c3c", text: "#ffffff" };
    case "medium":
      return { bg: "#fd7e14", text: "#ffffff" };
    case "low":
      return { bg: "#a8d08d", text: "#333333" };
    case "info":
    case "informational":
      return { bg: "#17a2b8", text: "#ffffff" };
    default:
      return { bg: "#6c757d", text: "#ffffff" };
  }
}

/**
 * Converts inline markdown to simple HTML (bold, code, links).
 */
export function inlineMarkdownToHtml(text: string): string {
  if (!text) return "";

  let html = text;

  // Escape HTML entities
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return html;
}

/**
 * Converts a block of markdown text (bullet lists, paragraphs) into HTML.
 */
export function blockMarkdownToHtml(text: string): string {
  if (!text) return "";

  const lines = text.split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inlineMarkdownToHtml(trimmed.slice(2))}</li>`;
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<p>${inlineMarkdownToHtml(trimmed)}</p>`;
    }
  }

  if (inList) {
    html += "</ul>";
  }

  return html;
}
