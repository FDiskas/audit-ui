// ---------------------------------------------------------------------------
// Shared types for the Audit Report Generator
// ---------------------------------------------------------------------------

/** A single extra row in the issue severity table. */
export interface ExtraRow {
  title: string;
  severity: string;
}

/** A parsed audit issue. `_id` is assigned at runtime and is not persisted. */
export interface Issue {
  _id: number;
  title: string;
  overallRisk: string;
  impact: string;
  exploitability: string;
  findingId: string;
  component: string;
  category: string;
  status: string;
  impactDetails: string;
  description: string;
  evidence: string;
  codeExample: string;
  codeLanguage: string;
  exampleScenario: string;
  recommendation: string;
  extraRows: ExtraRow[];
}

/** An issue without the runtime `_id` — used for original snapshots. */
export type IssueSnapshot = Omit<Issue, "_id">;

/** An issue with an additional `_pageNumber` field used in the preview. */
export interface PagedIssue extends Issue {
  _pageNumber: number;
}

/** A group of issues under one category. */
export interface GroupedCategory {
  category: string;
  issues: Issue[];
}

/** A group of issues with page numbers assigned. */
export interface PagedGroupedCategory {
  category: string;
  issues: PagedIssue[];
}

/** Severity color pair for badges. */
export interface SeverityColor {
  bg: string;
  text: string;
}

/** An uploaded or synthetically created file entry. */
export interface FileEntry {
  name: string;
  content: string;
  _isManual?: boolean;
}

/** Shape of the data persisted to localStorage. */
export interface SavedState {
  files: FileEntry[];
  issues: Issue[];
  originals: Record<number, IssueSnapshot>;
  nextIssueId: number;
  targetLanguage: string;
  lastSaved: string;
}

/** Fields on an issue that are user-editable (used for dirty detection). */
export type EditableField =
  | "title"
  | "component"
  | "overallRisk"
  | "findingId"
  | "impactDetails"
  | "description"
  | "codeExample"
  | "codeLanguage"
  | "exampleScenario"
  | "recommendation"
  | "extraRows";
