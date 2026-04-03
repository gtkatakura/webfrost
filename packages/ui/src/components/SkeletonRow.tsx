export function SkeletonRow() {
  return (
    <li className="py-3 px-4 border border-gray-200 rounded-md flex justify-between items-center gap-4">
      <span className="inline-block w-3/5 h-4 bg-gray-200 rounded animate-pulse" />
      <span className="inline-block w-[10%] h-4 bg-gray-200 rounded animate-pulse" />
    </li>
  );
}
