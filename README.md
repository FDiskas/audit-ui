# 🛡️ Audit Report Generator

A browser-based tool for composing, previewing, and exporting security audit reports. Upload structured Markdown issue files, edit them in a live preview, translate content, and export polished PDF or DOCX reports — all client-side with zero backend.

## Features

- **Drag & drop Markdown upload** — bulk-import `.md` issue files that follow the expected template
- **Live preview** — WYSIWYG preview grouped by category with a navigable Table of Contents
- **Inline editing** — click any field (title, description, code, severity, etc.) to edit in place
- **Severity badges** — color-coded Critical / High / Medium / Low / Info indicators
- **Code highlighting** — syntax-highlighted code blocks via [highlight.js](https://highlightjs.org/)
- **AI translation** — translate individual fields or entire pages via OpenAI (requires API key; controls are disabled when the key is not set)
- **Finding ID reindexing** — bulk-reindex IDs with a configurable prefix and category-based numbering
- **PDF export** — pixel-perfect A4 PDF with clickable TOC links (html2canvas + jsPDF)
- **DOCX export** — structured Word document with TOC, bookmarks, and styled tables (docx + file-saver)
- **Markdown export** — download individual issues back as `.md` files
- **Bulk Markdown download** — download all issues (with edits) as a single `.zip` archive
- **Auto-save** — all state is persisted to `localStorage` with debounced saving
- **Dirty tracking** — per-field modification indicators with one-click restore to original
- **Add blank pages** — create new issue pages from scratch without uploading a file
- **Collapsible file list** — uploaded files panel collapses to save screen space
- **Scroll to top** — floating button appears after scrolling down

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Framework   | React 18                            |
| Language    | TypeScript (strict mode)            |
| Build tool  | Vite 6                              |
| Package mgr | pnpm                                |
| PDF         | html2canvas + jsPDF                 |
| DOCX        | docx + file-saver                   |
| ZIP         | JSZip + file-saver                  |
| Syntax HL   | highlight.js                        |
| Translation | OpenAI API (`gpt-4o-mini`)          |
| Deployment  | GitHub Pages (GitHub Actions CI/CD) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8

### Install & Run

```sh
pnpm install
pnpm dev
```

The app opens at [http://localhost:3000](http://localhost:3000).

### Build

```sh
pnpm build
```

Runs TypeScript type checking (`tsc --noEmit`) followed by `vite build`. Output goes to `dist/`.

### Preview Production Build

```sh
pnpm preview
```

## Markdown Template

Each issue `.md` file should follow this structure. A copy is embedded in the app (see `src/templates/template.md`) and can be downloaded from the UI.

### Template Fields

| Field              | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `Issue title`      | Short name of the finding                                       |
| `Overall Risk`     | Severity level: Critical, High, Medium, Low, or Info            |
| `Impact`           | Impact rating                                                   |
| `Exploitability`   | How easily the issue can be exploited                           |
| `Finding ID`       | Unique identifier (e.g. `NFQ-0001`)                             |
| `Component`        | Affected file, service, or module                               |
| `Category`         | Grouping category (e.g. Security, Infrastructure, CI/CD)        |
| `Status`           | Current status (e.g. New, In Progress, Resolved)                |
| `Additional Issue` | Optional extra rows in the severity table (`Title \| Severity`) |
| `Impact details`   | Bullet list of impacts                                          |
| `Description`      | Detailed explanation with optional `Evidence:` link             |
| `Code example`     | Fenced code block with language tag                             |
| `Example scenario` | Realistic exploitation or failure scenario                      |
| `Recommendation`   | Bullet list of remediation steps                                |

## Translation (Optional)

The app can translate issue content to any language using the OpenAI API.

1. Create a `.env` file in this directory:

   ```sh
   VITE_OPENAI_API_KEY=sk-...
   ```

2. Select a target language in the preview header (default: Lithuanian).

3. Use the 🌐 button on any field or page, or press <kbd>Cmd+Shift+L</kbd> / <kbd>Ctrl+Shift+L</kbd> while editing.

> **Note:** The API key is used client-side via `dangerouslyAllowBrowser`. This is acceptable for internal tooling but should not be used in public-facing deployments. Never commit your `.env` file.

## Deployment

The project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically builds and deploys to GitHub Pages on every push to `main`.

### Setup

1. Push this repository to GitHub.
2. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` — the workflow will build and deploy automatically.

## Project Structure

```
web/
├── index.html              # Entry HTML
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json            # TypeScript configuration (strict)
├── vite.config.js           # Vite config (base: "./" for Pages)
└── src/
    ├── main.tsx             # React DOM entry point
    ├── App.tsx              # Main application component
    ├── Editable.tsx         # Inline-editable components (text, block, code, severity)
    ├── parseIssue.ts        # Markdown parser, grouping, severity helpers
    ├── generatePdf.ts       # PDF generation (html2canvas + jsPDF)
    ├── generateDocx.ts      # DOCX generation (docx library)
    ├── translate.ts         # OpenAI translation client
    ├── types.ts             # Shared TypeScript interfaces
    ├── templates/template.md          # Markdown issue template (source of truth)
    ├── index.css            # All styles
    └── vite-env.d.ts        # Vite/TypeScript env declarations
```

## License

Private — internal use only.
