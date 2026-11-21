import type { ImportResult } from "@webfrost/sdk";
import { History, Upload } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/ui/StateViews";
import { ImportForm } from "../features/import/ImportForm";
import { ImportHistory } from "../features/import/ImportHistory";
import { ImportResultCard } from "../features/import/ImportResultCard";

type TabId = "import" | "history";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "import", label: "Import", icon: <Upload size={13} /> },
  { id: "history", label: "History", icon: <History size={13} /> },
];

export function ImportPage() {
  const [activeTab, setActiveTab] = useState<TabId>("import");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  function onTabKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = activeTab === "import" ? "history" : "import";
    setActiveTab(next);
    document.getElementById(`import-tab-${next}`)?.focus();
  }

  return (
    <main className="mx-auto max-w-[720px] px-4 py-8 sm:px-5">
      <PageHeader icon={<Upload size={20} />} title="Import URLs" />

      <div
        role="tablist"
        aria-label="Import sections"
        onKeyDown={onTabKeyDown}
        className="mb-6 flex gap-0.5 border-b border-border"
      >
        {TABS.map(({ id, label, icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              id={`import-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`import-panel-${id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                setActiveTab(id);
                if (id === "import") setImportResult(null);
              }}
              className={`-mb-px inline-flex items-center gap-1.5 border-0 border-b-2 bg-transparent px-3.5 py-2 text-ui-base transition-colors ${
                active
                  ? "border-accent font-semibold text-accent"
                  : "border-transparent text-mid hover:text-high"
              }`}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`import-panel-${activeTab}`}
        aria-labelledby={`import-tab-${activeTab}`}
      >
        {activeTab === "import" &&
          (importResult ? (
            <ImportResultCard result={importResult} onReset={() => setImportResult(null)} />
          ) : (
            <ImportForm onSuccess={setImportResult} />
          ))}
        {activeTab === "history" && <ImportHistory />}
      </div>
    </main>
  );
}
