import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "mitata";
import { openDb } from "../db";
import { readabilityExtractor } from "./readability";

const testDir = join(tmpdir(), `readability-bench-${Date.now()}`);
mkdirSync(testDir, { recursive: true });
const db = openDb(testDir);
db.query(
  "INSERT INTO snapshots (url, status) VALUES ('https://example.com/article', 'pending')",
).run();

// Simulate a typical news article page
const ARTICLE_HTML = `
<html>
  <head><title>Breaking News: WebFrost Achieves Record Performance</title></head>
  <body>
    <header><nav>Home | News | Tech</nav></header>
    <article>
      <h1>Breaking News: WebFrost Achieves Record Performance</h1>
      <p class="byline">By Staff Reporter</p>
      <p>${"WebFrost is a self-hosted web archiving toolkit that delivers blazing-fast performance. ".repeat(20)}</p>
      <p>${"The system uses a single shared HTTP cache and one browser navigation per snapshot. ".repeat(20)}</p>
      <p>${"Durable open formats including SQLite and plain files ensure no vendor lock-in. ".repeat(20)}</p>
    </article>
    <footer>© 2026 WebFrost</footer>
  </body>
</html>
`;

bench("readabilityExtractor: parse typical news article", () => {
  readabilityExtractor(db, 1, "https://example.com/article", ARTICLE_HTML);
});

await run();
db.close();
try {
  rmSync(testDir, { recursive: true, force: true });
} catch {
  // best-effort
}
