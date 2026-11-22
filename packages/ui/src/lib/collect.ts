/** Every item of a lazily paginated list (the SDK's `iterate*` methods), as one array. */
export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}
