/**
 * Headers every direct HTTP request of WebFrost sends (the page fetch, SingleFile's resource
 * fetches, bookmark and feed imports): the ones Chrome sends on a navigation. Some servers
 * reset the connection or answer an error to a client that does not look like a browser, while
 * the headless Chromium of the same run gets the page; the fetch and the browser should see the
 * same site.
 *
 * The Chrome major version follows the Chromium that Playwright ships (a test fails when a
 * Playwright upgrade moves it). Like Chrome itself, the UA carries the major version only.
 */
export const CHROME_MAJOR_VERSION = 159;

export const BROWSER_USER_AGENT = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR_VERSION}.0.0.0 Safari/537.36`;

export const BROWSER_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "user-agent": BROWSER_USER_AGENT,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
});
