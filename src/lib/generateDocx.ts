import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  HeadingLevel,
  ShadingType,
  PageBreak,
  TableLayoutType,
  convertInchesToTwip,
  Footer,
  PageNumber,
  Bookmark,
  InternalHyperlink,
  type IRunOptions,
  type IBorderOptions,
} from "docx";
import { saveAs } from "file-saver";
import { groupByCategory } from "./parseIssue";
import type { Issue, GroupedCategory } from "./types";

// A4 page width in twips: 210mm = 11906 twips
// Page margins: 0.75in each side = 1080 twips each
// Usable content width: 11906 - (2 * 1080) = 9746 twips
const PAGE_WIDTH_TWIPS = 11906;
const MARGIN_TWIPS = convertInchesToTwip(0.75);
const CONTENT_WIDTH = PAGE_WIDTH_TWIPS - 2 * MARGIN_TWIPS;

// Issue table column widths (75% / 25%)
const ISSUE_COL_WIDTH = Math.round(CONTENT_WIDTH * 0.75);
const SEVERITY_COL_WIDTH = CONTENT_WIDTH - ISSUE_COL_WIDTH;

/**
 * Returns a hex color string for a severity level.
 */
function getSeverityColorHex(severity: string): string {
  const s = (severity || "").toLowerCase();
  switch (s) {
    case "critical":
      return "8B0000";
    case "high":
      return "E74C3C";
    case "medium":
      return "FD7E14";
    case "low":
      return "A8D08D";
    case "info":
    case "informational":
      return "17A2B8";
    default:
      return "6C757D";
  }
}

function getSeverityFontColor(severity: string): string {
  const s = (severity || "").toLowerCase();
  switch (s) {
    case "low":
      return "333333";
    default:
      return "FFFFFF";
  }
}

/**
 * Parse inline markdown into an array of TextRun objects.
 * Handles `code`, **bold**, *italic*, and plain text.
 */
function parseInlineMarkdown(
  text: string,
  baseOptions: Partial<IRunOptions> = {},
): TextRun[] {
  if (!text) return [new TextRun({ text: "", ...baseOptions })];

  const runs: TextRun[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|[^`*]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const segment = match[0];

    if (segment.startsWith("`") && segment.endsWith("`")) {
      runs.push(
        new TextRun({
          text: segment.slice(1, -1),
          font: "Courier New",
          size: 20,
          shading: {
            type: ShadingType.CLEAR,
            fill: "F0F0F0",
          },
          ...baseOptions,
        }),
      );
    } else if (segment.startsWith("**") && segment.endsWith("**")) {
      runs.push(
        new TextRun({
          text: segment.slice(2, -2),
          bold: true,
          ...baseOptions,
        }),
      );
    } else if (segment.startsWith("*") && segment.endsWith("*")) {
      runs.push(
        new TextRun({
          text: segment.slice(1, -1),
          italics: true,
          ...baseOptions,
        }),
      );
    } else {
      const linkStripped = segment.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      if (linkStripped) {
        runs.push(
          new TextRun({
            text: linkStripped,
            ...baseOptions,
          }),
        );
      }
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text: text, ...baseOptions }));
  }

  return runs;
}

interface BlockOptions {
  indent?: number;
}

/**
 * Converts a block of markdown text into an array of Paragraph objects.
 */
function blockToParagraphs(
  text: string,
  options: BlockOptions = {},
): Paragraph[] {
  if (!text) return [];

  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];
  const { indent = 0 } = options;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const content = trimmed.slice(2);
      paragraphs.push(
        new Paragraph({
          children: parseInlineMarkdown(content, { size: 22, font: "Calibri" }),
          bullet: { level: 0 },
          spacing: { after: 60 },
          indent: indent ? { left: convertInchesToTwip(indent) } : undefined,
        }),
      );
    } else {
      paragraphs.push(
        new Paragraph({
          children: parseInlineMarkdown(trimmed, { size: 22, font: "Calibri" }),
          spacing: { after: 100 },
          indent: indent ? { left: convertInchesToTwip(indent) } : undefined,
        }),
      );
    }
  }

  return paragraphs;
}

/**
 * Creates a section label paragraph (bold, like "Impact details:")
 */
function sectionLabel(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: text,
        bold: true,
        size: 22,
        font: "Calibri",
      }),
    ],
    spacing: { before: 240, after: 100 },
  });
}

/**
 * Thin border definition reused across tables.
 */
const thinBorder: Record<string, IBorderOptions> = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
};

/**
 * Creates the issue/severity table matching the image design.
 * Uses fixed layout with absolute DXA widths so it spans full page width.
 */
function createIssueTable(issue: Issue): Table {
  const severityBg = getSeverityColorHex(issue.overallRisk);
  const severityFontColor = getSeverityFontColor(issue.overallRisk);
  const headerColor = "F5A623";

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [ISSUE_COL_WIDTH, SEVERITY_COL_WIDTH],
    rows: [
      // Header row
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Issue",
                    bold: true,
                    size: 22,
                    font: "Calibri",
                    color: "FFFFFF",
                  }),
                ],
              }),
            ],
            width: { size: ISSUE_COL_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: headerColor },
            borders: thinBorder,
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Severity",
                    bold: true,
                    size: 22,
                    font: "Calibri",
                    color: "FFFFFF",
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
            width: { size: SEVERITY_COL_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: headerColor },
            borders: thinBorder,
          }),
        ],
      }),
      // Main data row
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: issue.title,
                    size: 22,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
            width: { size: ISSUE_COL_WIDTH, type: WidthType.DXA },
            borders: thinBorder,
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: issue.overallRisk || "N/A",
                    size: 22,
                    font: "Calibri",
                    color: severityFontColor,
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
            width: { size: SEVERITY_COL_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: severityBg },
            borders: thinBorder,
          }),
        ],
      }),
      // Extra rows
      ...(issue.extraRows || []).map((row) => {
        const extraSevBg = getSeverityColorHex(row.severity);
        const extraSevFont = getSeverityFontColor(row.severity);
        return new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: row.title || "",
                      size: 22,
                      font: "Calibri",
                    }),
                  ],
                }),
              ],
              width: { size: ISSUE_COL_WIDTH, type: WidthType.DXA },
              borders: thinBorder,
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: row.severity || "N/A",
                      size: 22,
                      font: "Calibri",
                      color: extraSevFont,
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              width: { size: SEVERITY_COL_WIDTH, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: extraSevBg },
              borders: thinBorder,
            }),
          ],
        });
      }),
    ],
  });
}

/**
 * Creates a code block as a single-cell fixed-layout table with a shaded
 * background that spans the full content width.
 */
function createCodeBlock(codeText: string, language: string): Table {
  const codeLines = codeText.split("\n");
  const codeParagraphs: Paragraph[] = [];

  // Language label
  if (language) {
    codeParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: language.charAt(0).toUpperCase() + language.slice(1),
            size: 18,
            font: "Calibri",
            color: "666666",
            italics: true,
          }),
        ],
        spacing: { after: 60 },
      }),
    );
  }

  // Code lines
  for (const line of codeLines) {
    codeParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: line || " ",
            font: "Courier New",
            size: 18,
            color: "333333",
          }),
        ],
        spacing: { after: 0, line: 276 },
      }),
    );
  }

  const codeBorder: Record<string, IBorderOptions> = {
    top: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
  };

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: codeParagraphs,
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
            borders: codeBorder,
            margins: {
              top: convertInchesToTwip(0.1),
              bottom: convertInchesToTwip(0.1),
              left: convertInchesToTwip(0.15),
              right: convertInchesToTwip(0.15),
            },
          }),
        ],
      }),
    ],
  });
}

/**
 * Creates a Table of Contents page with clickable links to each issue,
 * grouped by category.
 */
function createTocPage(grouped: GroupedCategory[]): Paragraph[] {
  const children: Paragraph[] = [];

  // TOC heading
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Table of Contents",
          bold: true,
          size: 40,
          font: "Calibri",
          color: "1A1A2E",
        }),
      ],
      spacing: { after: 300 },
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 6,
          color: "F5A623",
          space: 8,
        },
      },
    }),
  );

  grouped.forEach((group) => {
    // Category heading in TOC
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: group.category,
            bold: true,
            size: 26,
            font: "Calibri",
            color: "1A1A2E",
          }),
          new TextRun({
            text: ` (${group.issues.length})`,
            size: 22,
            font: "Calibri",
            color: "888888",
          }),
        ],
        spacing: { before: 240, after: 100 },
      }),
    );

    // Issue entries as clickable links
    group.issues.forEach((issue) => {
      const bookmarkId = `issue_${issue._id}`;
      const severityBg = getSeverityColorHex(issue.overallRisk);
      const severityFont = getSeverityFontColor(issue.overallRisk);

      children.push(
        new Paragraph({
          children: [
            new InternalHyperlink({
              anchor: bookmarkId,
              children: [
                new TextRun({
                  text: issue.findingId || "—",
                  bold: true,
                  size: 21,
                  font: "Calibri",
                  color: "2980B9",
                  underline: { type: "single" },
                }),
                new TextRun({
                  text: "  ",
                  size: 21,
                  font: "Calibri",
                }),
                new TextRun({
                  text: issue.title || issue.component || "Untitled",
                  size: 21,
                  font: "Calibri",
                  color: "2980B9",
                  underline: { type: "single" },
                }),
              ],
            }),
            new TextRun({
              text: "   ",
              size: 21,
              font: "Calibri",
            }),
            new TextRun({
              text: ` ${issue.overallRisk || "N/A"} `,
              size: 20,
              font: "Calibri",
              color: severityFont,
              shading: {
                type: ShadingType.CLEAR,
                fill: severityBg,
              },
            }),
          ],
          spacing: { after: 60 },
          indent: { left: convertInchesToTwip(0.25) },
        }),
      );
    });
  });

  return children;
}

type DocxChild = Paragraph | Table;

/**
 * Builds a full DOCX document from an array of parsed issues,
 * grouped by category.
 */
function buildDocument(issues: Issue[]): Document {
  const children: DocxChild[] = [];
  const grouped = groupByCategory(issues);

  // Table of Contents page
  children.push(...createTocPage(grouped));

  grouped.forEach((group) => {
    group.issues.forEach((issue) => {
      const bookmarkId = `issue_${issue._id}`;

      // Page break before each issue page
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        }),
      );

      // Component heading with bookmark anchor for TOC links
      children.push(
        new Paragraph({
          children: [
            new Bookmark({
              id: bookmarkId,
              children: [
                new TextRun({
                  text: issue.component || issue.title,
                  bold: true,
                  size: 32,
                  font: "Calibri",
                }),
              ],
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 120 },
        }),
      );

      // Finding ID
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `ID: ${issue.findingId}`,
              bold: true,
              size: 24,
              font: "Calibri",
            }),
          ],
          spacing: { after: 200 },
        }),
      );

      // Issue/Severity table
      children.push(createIssueTable(issue));

      // Spacer
      children.push(new Paragraph({ spacing: { after: 100 }, children: [] }));

      // Impact details
      if (issue.impactDetails) {
        children.push(sectionLabel("Impact details:"));
        children.push(...blockToParagraphs(issue.impactDetails));
      }

      // Description
      if (issue.description) {
        children.push(sectionLabel("Description:"));
        children.push(...blockToParagraphs(issue.description));
      }

      // Code example
      if (issue.codeExample) {
        children.push(sectionLabel("Code example:"));
        children.push(createCodeBlock(issue.codeExample, issue.codeLanguage));
        children.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
      }

      // Example issue scenario
      if (issue.exampleScenario) {
        children.push(sectionLabel("Example issue scenario:"));
        children.push(...blockToParagraphs(issue.exampleScenario));
      }

      // Recommendation
      if (issue.recommendation) {
        children.push(sectionLabel("Recommendation:"));
        children.push(...blockToParagraphs(issue.recommendation));
      }
    });
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: PAGE_WIDTH_TWIPS,
              height: 16838, // A4 height in twips (297mm)
            },
            margin: {
              top: MARGIN_TWIPS,
              right: MARGIN_TWIPS,
              bottom: MARGIN_TWIPS,
              left: MARGIN_TWIPS,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 20,
                    font: "Calibri",
                    color: "999999",
                  }),
                  new TextRun({
                    text: " / ",
                    size: 20,
                    font: "Calibri",
                    color: "999999",
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 20,
                    font: "Calibri",
                    color: "999999",
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

/**
 * Generates and downloads a DOCX file from parsed issues.
 */
export async function generateDocx(issues: Issue[]): Promise<void> {
  const doc = buildDocument(issues);
  const blob = await Packer.toBlob(doc);
  saveAs(blob, "audit-report.docx");
}
