// Pages written ahead of a release and hidden from the site until it ships. Removed from the
// navigation, search and the prerendered pages, so the URL answers 404 until then.
//
// @webfrost/sdk: the reference is complete; flip this when the package is on npm.
export const sdkPublished = false;

/** Content files (relative to content/docs) the site leaves out for now. */
export const hiddenDocs: ReadonlySet<string> = new Set(sdkPublished ? [] : ["reference/sdk.mdx"]);
