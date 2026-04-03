export function ErrorBanner({ message }: { message: string }) {
  return <p className="text-red-700 bg-red-100 py-2.5 px-3.5 rounded mb-4 text-sm">{message}</p>;
}
