import touchIcon from "@/assets/brand/mark.svg?preset=touch-icon";
import { PrefetchLink } from "@/components/prefetch-link";
import type { SharedProps } from "fumadocs-ui/components/dialog/search";
import { RootProvider } from "fumadocs-ui/provider/react-router";
import { Suspense, lazy, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import NotFound from "./routes/not-found";

// The search dialog and its index (about 150 KB) load the first time someone opens search, not with
// every page: Fumadocs mounts the dialog on every page, closed, so it renders nothing until then.
const LazySearch = lazy(() => import("@/components/search"));
function SearchDialog(props: SharedProps) {
  const [wanted, setWanted] = useState(props.open);
  if (props.open && !wanted) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <LazySearch {...props} />
    </Suspense>
  );
}

// The search shortcut. Fumadocs picks Ctrl or ⌘ only after hydration, so the prerendered ⌘ would flicker to
// Ctrl on Linux and Windows; both are rendered and CSS shows the one the script in <head> chose.
const hotKey = [
  {
    display: (
      <>
        <span className="kbd-mac">⌘</span>
        <span className="kbd-ctrl">Ctrl</span>
      </>
    ),
    key: (e: KeyboardEvent) => e.metaKey || e.ctrlKey,
  },
  { display: "K", key: "k" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant, run before the first paint
          dangerouslySetInnerHTML={{
            __html:
              "if(/Windows|Linux/i.test(navigator.userAgent))document.documentElement.dataset.os='ctrl'",
          }}
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href={touchIcon} />
        <meta name="theme-color" content="#080c16" />
        <Meta />
        <Links />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ SearchDialog, hotKey }} components={{ Link: PrefetchLink }}>
          {children}
        </RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  const details = isRouteErrorResponse(error)
    ? error.statusText
    : import.meta.env.DEV && error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
  return (
    <main className="mx-auto w-full max-w-[1400px] p-4 pt-16">
      <h1>Error</h1>
      <p>{details}</p>
    </main>
  );
}
