/** Every localStorage key the UI uses, in one place. */
export const STORAGE_KEYS = {
  theme: "webfrost-theme",
  sidebarCollapsed: "webfrost-sidebar-collapsed",
  snapshotDensity: "webfrost-snapshot-density",
  savedSearches: "webfrost-saved-searches",
  viewerDetails: "webfrost-viewer-details",
} as const;

/** localStorage can throw (private windows, blocked site data), so every access goes through here. */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persisting a preference is best effort.
  }
}
