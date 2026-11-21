import { STORAGE_KEYS, readStorage, writeStorage } from "../../lib/storage";

export const MAX_SAVED = 10;

export interface SavedSearch {
  name: string;
  q: string;
}

export function loadSaved(): SavedSearch[] {
  try {
    const parsed: unknown = JSON.parse(readStorage(STORAGE_KEYS.savedSearches) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (s): s is SavedSearch => typeof s?.q === "string" && typeof s?.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function persistSaved(list: SavedSearch[]) {
  writeStorage(STORAGE_KEYS.savedSearches, JSON.stringify(list.slice(0, MAX_SAVED)));
}
