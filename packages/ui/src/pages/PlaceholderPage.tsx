export function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">{title}</h1>
      <div className="text-center mt-16">
        <p className="text-4xl mb-3">🚧</p>
        <p className="text-gray-500 dark:text-gray-400 font-medium">Coming soon</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
          This page is under construction.
        </p>
      </div>
    </main>
  );
}
