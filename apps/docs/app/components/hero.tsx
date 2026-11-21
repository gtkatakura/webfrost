/*
 * Adapted from "Split Developer Hero with Interactive Code Terminal" by themeocean on 21st.dev
 * (https://21st.dev/@themeocean/components/split-developer-hero-with-interactive-code-terminal).
 * Changes: the background glow uses color-mix on the theme token, the code window shows a shell
 * prompt for commands, and nothing outside this file is required.
 */
import { cn } from "@/lib/cn";
import * as React from "react";
import { Link } from "react-router";

export interface HeroAction {
  label: string;
  href: string;
  external?: boolean;
}

export interface CodeTab {
  label: string;
  language: string;
  code: string;
}

/* ---------- A tiny syntax highlighter (no library) ---------- */

type TokenType = "string" | "comment" | "keyword" | "number" | "function" | "flag";

// Nord's syntax colors: Aurora green strings, Frost blues for code, Aurora purple numbers.
const TOKEN_CLASS: Record<TokenType, string> = {
  string: "text-[var(--tint-3)]",
  comment: "italic text-muted-foreground",
  keyword: "text-primary",
  number: "text-[var(--tint-3)]",
  function: "text-[var(--tint-2)]",
  flag: "text-[var(--tint-2)]",
};

const KEYWORDS =
  "const|let|await|async|import|from|export|new|return|for|of|true|false|null|services|image|environment|volumes|ports";
const TOKEN_ORDER: TokenType[] = ["string", "comment", "keyword", "number", "function", "flag"];

function buildPattern(language: string) {
  const shell = /^(bash|shell|sh)$/i.test(language);
  const hashComments = shell || /^(yaml|yml)$/i.test(language);
  return new RegExp(
    [
      `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)`,
      hashComments ? "(#.*)" : "(\\/\\/.*)",
      `\\b(${KEYWORDS})\\b`,
      "(\\b\\d+(?:\\.\\d+)?\\b)",
      "(\\b[A-Za-z_]\\w*(?=\\())",
      shell ? "((?<=\\s)--?[A-Za-z][\\w-]*)" : "(?!)",
    ].join("|"),
    "g",
  );
}

function highlight(line: string, language: string): React.ReactNode[] {
  const pattern = buildPattern(language);
  const out: React.ReactNode[] = [];
  let last = 0;
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
    if (match[0] === "") {
      pattern.lastIndex++;
      continue;
    }
    if (match.index > last) out.push(line.slice(last, match.index));
    const type = TOKEN_ORDER[match.findIndex((g, i) => i > 0 && g !== undefined) - 1] ?? "keyword";
    out.push(
      <span key={match.index} className={TOKEN_CLASS[type]}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/* ---------- Copy button with a self-drawing tick ---------- */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the code shown changes
  React.useEffect(() => {
    setCopied(false);
    return () => window.clearTimeout(timer.current);
  }, [text]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <span className="relative size-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cn(
            "absolute inset-0 size-4 transition-all duration-200 motion-reduce:transition-none",
            copied ? "scale-50 opacity-0" : "scale-100 opacity-100",
          )}
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cn(
            "absolute inset-0 size-4 text-emerald-500 transition-all duration-200 motion-reduce:transition-none",
            copied ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
        >
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            style={{
              strokeDasharray: 24,
              strokeDashoffset: copied ? 0 : 24,
              transition: "stroke-dashoffset 0.35s ease-out 0.05s",
            }}
          />
        </svg>
      </span>
      <span aria-live="polite" className="w-11 text-left">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

/* ---------- Code window with tabs ---------- */

export function CodeWindow({ tabs }: { tabs: CodeTab[] }) {
  const baseId = React.useId();
  const [active, setActive] = React.useState(0);
  const [shown, setShown] = React.useState(0);
  const [visible, setVisible] = React.useState(true);
  const fade = React.useRef<number | undefined>(undefined);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  React.useEffect(() => () => window.clearTimeout(fade.current), []);

  const select = (index: number) => {
    if (index === active) return;
    setActive(index);
    setVisible(false);
    window.clearTimeout(fade.current);
    fade.current = window.setTimeout(() => {
      setShown(index);
      setVisible(true);
    }, 90);
  };

  // Arrow keys, Home and End move between tabs (roving tabindex).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight"
        ? (active + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (active - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  const current = tabs[shown] ?? tabs[0];
  if (!current) return null;
  const lines = current.code.replace(/\n$/, "").split("\n");
  const shell = /^(bash|shell|sh)$/i.test(current.language);

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl shadow-blue-900/10 dark:shadow-blue-500/10 dark:shadow-black/50">
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="hidden gap-1.5 sm:flex" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <div
          role="tablist"
          aria-label="Ways to run WebFrost"
          onKeyDown={handleKeyDown}
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${i}`}
              aria-selected={active === i}
              aria-controls={`${baseId}-panel`}
              tabIndex={active === i ? 0 : -1}
              onClick={() => select(i)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                active === i
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton text={current.code} />
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${active}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable code panel must be reachable by keyboard
        tabIndex={0}
        className={cn(
          "overflow-x-auto p-4 font-mono text-[13px] leading-6 transition-opacity duration-150 motion-reduce:transition-none",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        <pre className="w-max min-w-full">
          <code>
            {lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are static and positional
              <div key={i} className="flex">
                <span
                  aria-hidden="true"
                  className="w-6 shrink-0 select-none pr-3 text-right text-muted-foreground/50"
                >
                  {shell && line && !line.startsWith(" ") && !line.startsWith("#") ? "$" : i + 1}
                </span>
                <span className="whitespace-pre">
                  {line ? highlight(line, current.language) : " "}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ---------- Hero ---------- */

function ActionButton({
  action,
  variant,
}: { action: HeroAction; variant: "primary" | "secondary" }) {
  const classes = cn(
    "group inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-medium transition-all active:scale-[0.98]",
    variant === "primary"
      ? "bg-primary text-primary-foreground shadow-sm hover:opacity-90"
      : "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
  );
  const content = (
    <>
      {action.label}
      {variant === "primary" && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-4 transition-transform group-hover:translate-x-0.5"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )}
    </>
  );
  return action.external ? (
    <a href={action.href} className={classes} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <Link to={action.href} className={classes}>
      {content}
    </Link>
  );
}

export function SplitDeveloperHero({
  badge,
  title,
  description,
  primaryAction,
  secondaryAction,
  codeTabs,
  art,
}: {
  badge?: string;
  title: React.ReactNode;
  description: string;
  primaryAction: HeroAction;
  secondaryAction?: HeroAction;
  codeTabs?: CodeTab[];
  /** Shown in the right column instead of the code window. */
  art?: React.ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden py-16 sm:py-20 lg:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-fd-primary)_14%,transparent),transparent)]"
      />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0 space-y-6">
          {badge && (
            <div
              className="rise inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm"
              style={{ "--i": 0 } as React.CSSProperties}
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {badge}
            </div>
          )}
          <h1
            className="rise text-balance text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            {title}
          </h1>
          <p
            className="rise max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            {description}
          </p>
          <div
            className="rise flex flex-col gap-3 pt-2 sm:flex-row"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            <ActionButton action={primaryAction} variant="primary" />
            {secondaryAction && <ActionButton action={secondaryAction} variant="secondary" />}
          </div>
        </div>
        <div className="rise relative min-w-0" style={{ "--i": 4 } as React.CSSProperties}>
          <div
            aria-hidden="true"
            className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-tr from-primary/20 via-transparent to-primary/10 blur-2xl"
          />
          {art ?? (codeTabs && <CodeWindow tabs={codeTabs} />)}
        </div>
      </div>
    </section>
  );
}
