export function SkeletonRow() {
  return (
    <li
      className="py-3 px-4 rounded-md flex justify-between items-center gap-4 border"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--border-default)",
      }}
    >
      <span
        className="inline-block w-3/5 h-4 rounded animate-pulse"
        style={{ background: "var(--bg-overlay)" }}
      />
      <span
        className="inline-block w-[10%] h-4 rounded animate-pulse"
        style={{ background: "var(--bg-overlay)" }}
      />
    </li>
  );
}
