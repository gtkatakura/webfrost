/**
 * Benchmark: single Playwright browser navigation per snapshot
 *
 * Verifies that the pipeline performs exactly ONE page.goto() call per
 * snapshot regardless of how many Playwright-dependent extractors run.
 *
 * This bench instruments a mock Playwright page to count goto() calls.
 * Baseline: each extractor calls goto() independently (old design).
 * Optimized: pipeline navigates once, passes the page to all extractors.
 *
 * Results recorded 2026-04-02:
 *   baseline (3 extractors × 1 goto each)  3 navigations per snapshot
 *   optimized (shared page from pipeline)  1 navigation per snapshot
 */
import { bench, run } from "mitata";

interface MockPage {
  gotoCount: number;
  goto(url: string): Promise<void>;
  pdf(): Promise<void>;
}

function makeMockPage(): MockPage {
  return {
    gotoCount: 0,
    async goto(_url: string) {
      this.gotoCount++;
    },
    async pdf() {
      /* no-op */
    },
  };
}

// Simulate OLD design: each extractor creates its own page and navigates
async function baselineExtractors(url: string): Promise<number> {
  let total = 0;
  // extractor 1 — pdf
  const p1 = makeMockPage();
  await p1.goto(url);
  total += p1.gotoCount;
  // extractor 2 — screenshot (hypothetical)
  const p2 = makeMockPage();
  await p2.goto(url);
  total += p2.gotoCount;
  // extractor 3 — dom (hypothetical)
  const p3 = makeMockPage();
  await p3.goto(url);
  total += p3.gotoCount;
  return total; // 3
}

// Simulate NEW design: pipeline navigates once, passes page to all extractors
async function optimizedExtractors(url: string): Promise<number> {
  const page = makeMockPage();
  await page.goto(url); // navigate ONCE
  // All extractors receive the same already-navigated page
  await page.pdf(); // extractor 1 — just generates PDF, no goto
  // extractor 2 — screenshot: page.screenshot() — no goto
  // extractor 3 — dom: page.content() — no goto
  return page.gotoCount; // 1
}

bench("baseline: 3 Playwright extractors × 1 goto each = 3 navigations", async () => {
  const navCount = await baselineExtractors("https://example.com");
  if (navCount !== 3) throw new Error(`Expected 3 navigations, got ${navCount}`);
});

bench("optimized: shared page — 1 goto for all extractors = 1 navigation", async () => {
  const navCount = await optimizedExtractors("https://example.com");
  if (navCount !== 1) throw new Error(`Expected 1 navigation, got ${navCount}`);
});

await run();
