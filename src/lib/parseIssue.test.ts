import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIssue } from "./parseIssue";

describe("parseIssue", () => {
  it("parses the template-compatible markdown structure", () => {
    const markdown = `# Issue title: SQL Injection in Search\n\nOverall Risk: High\nImpact: High\nExploitability: Medium\nFinding ID: ABC-100001\nComponent: Search API\nCategory: Security\nStatus: New\nAdditional Issue: Unsafe query concatenation | High\n\n## Impact details\n\n- Attackers can extract records.\n\n## Description\n\nInput is interpolated directly into SQL.\n\nEvidence: [src/api/search.ts](src/api/search.ts)\n\n### Code example\n\n\`\`\`ts\nconst q = "SELECT * FROM users WHERE name='" + input + "'";\n\`\`\`\n\n### Example issue scenario\n\nAn attacker sends a crafted payload and dumps all users.\n\n## Recommendation\n\n- Use parameterized queries.\n- Add query validation.\n`;

    const issue = parseIssue(markdown);

    expect(issue.title).toBe("SQL Injection in Search");
    expect(issue.overallRisk).toBe("High");
    expect(issue.findingId).toBe("ABC-100001");
    expect(issue.component).toBe("Search API");
    expect(issue.category).toBe("Security");
    expect(issue.status).toBe("New");
    expect(issue.evidence).toBe("[src/api/search.ts](src/api/search.ts)");
    expect(issue.codeLanguage).toBe("ts");
    expect(issue.codeExample).toContain("SELECT * FROM users");
    expect(issue.extraRows).toEqual([{ title: "Unsafe query concatenation", severity: "High" }]);
  });

  it("handles BOM, CRLF, and case-insensitive metadata keys", () => {
    const markdown =
      "\uFEFF# issue title: Header Hardening\r\n\r\n" +
      "overall risk: Medium\r\n" +
      "impact: Medium\r\n" +
      "exploitability: Medium\r\n" +
      "finding id: ABC-100008\r\n" +
      "component: Reverse Proxy\r\n" +
      "category: Best-practices\r\n" +
      "status: New\r\n" +
      "additional issue: Browser-side attack surface not minimized | Medium\r\n\r\n" +
      "## Description\r\n\r\n" +
      "Missing hardening headers.\r\n\r\n" +
      "evidence: [.docker/Caddyfile.prod](.docker/Caddyfile.prod)\r\n\r\n" +
      "## Recommendation\r\n\r\n" +
      "- Add CSP.\r\n";

    const issue = parseIssue(markdown);

    expect(issue.title).toBe("Header Hardening");
    expect(issue.findingId).toBe("ABC-100008");
    expect(issue.category).toBe("Best-practices");
    expect(issue.evidence).toBe("[.docker/Caddyfile.prod](.docker/Caddyfile.prod)");
    expect(issue.extraRows).toEqual([
      {
        title: "Browser-side attack surface not minimized",
        severity: "Medium",
      },
    ]);
  });

  it("does not treat headings inside fenced code blocks as markdown sections", () => {
    const markdown = `# Issue title: Header Parsing\n\nOverall Risk: Low\nImpact: Low\nExploitability: Low\nFinding ID: ABC-100009\nComponent: Parser\nCategory: Reliability\nStatus: New\n\n## Description\n\nParser must ignore markdown-like text in code blocks.\n\n### Code example\n\n\`\`\`markdown\n## not-a-real-section\n### also-not-a-section\n\`\`\`\n\n### Example issue scenario\n\nBad split loses section data.\n\n## Recommendation\n\n- Keep code fences isolated from heading detection.\n`;

    const issue = parseIssue(markdown);

    expect(issue.codeLanguage).toBe("markdown");
    expect(issue.codeExample).toContain("## not-a-real-section");
    expect(issue.exampleScenario).toBe("Bad split loses section data.");
    expect(issue.recommendation).toContain("Keep code fences isolated");
  });

  it("parses the real regression sample from repository root", () => {
    const samplePath = resolve(process.cwd(), "ABC-100008-missing-security-response-headers.md");
    const markdown = readFileSync(samplePath, "utf8");

    const issue = parseIssue(markdown);

    expect(issue.title).toBe("Security response headers are incomplete for web hardening");
    expect(issue.findingId).toBe("ABC-100008");
    expect(issue.category).toBe("Best-practices");
    expect(issue.codeLanguage).toBe("caddy");
    expect(issue.recommendation.length).toBeGreaterThan(0);
    expect(issue.extraRows.length).toBe(1);
  });
});
