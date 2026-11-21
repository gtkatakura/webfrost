/**
 * The web UI's files embedded in the binary: URL path -> embedded file path.
 *
 * `null` when running from source, where the server reads packages/ui/dist. The binary
 * build (build-binary.ts) swaps this module for one that imports every file of
 * packages/ui/dist with `type: "file"`, which embeds them in the executable.
 */
export const embeddedUi: Record<string, string> | null = null;
