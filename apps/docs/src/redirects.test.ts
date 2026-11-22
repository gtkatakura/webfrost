import { describe, expect, test } from "bun:test";
import { redirectFor } from "./redirects";

describe("redirectFor", () => {
  test("sends a moved page to its new address", () => {
    expect(redirectFor("/docs/guides/web-ui")).toBe("/docs/reference/web-ui");
    expect(redirectFor("/docs/guides/web-ui/")).toBe("/docs/reference/web-ui");
  });

  test("keeps the anchor of a page folded into another", () => {
    expect(redirectFor("/docs/guides/authenticated-pages")).toBe(
      "/docs/guides/troubleshooting#authenticated-pages",
    );
  });

  test("sends route data to the new page's route data, without the anchor", () => {
    expect(redirectFor("/docs/guides/web-ui.data")).toBe("/docs/reference/web-ui.data");
    expect(redirectFor("/docs/guides/authenticated-pages.data")).toBe(
      "/docs/guides/troubleshooting.data",
    );
  });

  test("leaves every other path alone", () => {
    expect(redirectFor("/docs/reference/web-ui")).toBeNull();
    expect(redirectFor("/docs/guides/web-ui-extra")).toBeNull();
    expect(redirectFor("/")).toBeNull();
  });
});
