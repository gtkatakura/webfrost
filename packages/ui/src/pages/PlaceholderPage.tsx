export function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">{title}</h1>
      <p className="text-gray-400">Coming soon.</p>
    </main>
  );
}
