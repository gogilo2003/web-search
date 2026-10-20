import type { PageDetails, SearchReport } from "./types.js";

const WIDTH = 100;

function wrap(text: string, indent: string, width = WIDTH): string[] {
  const available = Math.max(20, width - indent.length);
  const lines: string[] = [];

  for (const paragraph of text.split(/\n{2,}/)) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!current) {
        current = word;
      } else if (current.length + word.length + 1 <= available) {
        current += ` ${word}`;
      } else {
        lines.push(`${indent}${current}`);
        current = word;
      }
    }
    if (current) lines.push(`${indent}${current}`);
  }

  return lines;
}

function formatDetails(details: PageDetails): string[] {
  if (details.error) {
    return [`   Details unavailable: ${details.error}`];
  }

  const lines: string[] = [];
  lines.push(`   Details: ${details.wordCount} words`);

  if (details.finalUrl && details.finalUrl !== details.url) {
    lines.push(`   Resolved URL: ${details.finalUrl}`);
  }

  if (details.description) {
    lines.push(...wrap(details.description, "   "));
  }

  if (details.headings.length > 0) {
    lines.push(`   Headings: ${details.headings.join(" | ")}`);
  }

  const paragraphs = details.text.split(/\n{2,}/).filter(Boolean);
  for (const paragraph of paragraphs) {
    lines.push(...wrap(paragraph, "   "));
  }

  if (details.truncated) {
    lines.push("   [content truncated]");
  }

  return lines;
}

export function formatReport(report: SearchReport): string {
  const lines: string[] = [];
  const followed = report.results.filter((result) => result.details).length;

  lines.push(`Search: ${report.query}`);
  lines.push(
    `Found ${report.results.length} result(s); followed ${followed}. ${report.searchedAt}`,
  );

  if (report.instantAnswer) {
    const answer = report.instantAnswer;
    lines.push("");
    lines.push("Instant answer:");
    lines.push(...wrap(answer.text, "  "));
    if (answer.source) lines.push(`  Source: ${answer.source}`);
    if (answer.url) lines.push(`  ${answer.url}`);
    if (answer.related.length > 0) {
      lines.push("  Related:");
      for (const related of answer.related) {
        lines.push(`  - ${related.text}`);
        lines.push(`    ${related.url}`);
      }
    }
  }

  for (const result of report.results) {
    lines.push("");
    lines.push(`${result.position}. ${result.title}`);
    lines.push(`   ${result.url}`);
    if (result.snippet) {
      lines.push(...wrap(result.snippet, "   "));
    }
    if (result.details) {
      lines.push(...formatDetails(result.details));
    }
  }

  if (report.storage) {
    lines.push("");
    lines.push(`Saved to ${report.storage.dir}`);
    lines.push(`  report:   ${report.storage.resultsFile}`);
    lines.push(`  manifest: ${report.storage.manifestFile}`);
    lines.push(`  pages:    ${report.storage.pages.length}`);
    lines.push(`  index:    ${report.storage.indexFile}`);
  }

  return lines.join("\n");
}
