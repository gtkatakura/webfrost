import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Snippet, decodeEntities } from "./Snippet";

afterEach(cleanup);

describe("Snippet", () => {
  test("renders <mark> highlights as mark elements", () => {
    const { container } = render(
      <Snippet text={"hello <mark>world</mark> and <mark>more</mark>"} />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(2);
    expect(marks[0]?.textContent).toBe("world");
    expect(marks[1]?.textContent).toBe("more");
    expect(container.textContent).toBe("hello world and more");
  });

  test("escaped HTML renders as literal text", () => {
    const { container } = render(<Snippet text={"&lt;img src=x onerror=alert(1)&gt;"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  test("raw tag-looking text renders literally", () => {
    const { container } = render(
      <Snippet text={"<img src=x onerror=alert(1)> <script>x</script> <mark>hit</mark>"} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelectorAll("mark").length).toBe(1);
    expect(container.textContent).toBe("<img src=x onerror=alert(1)> <script>x</script> hit");
  });

  test("decodes entities in marked text and does not double-decode", () => {
    const { container } = render(
      <Snippet text={"<mark>a &amp; b</mark> &amp;lt; &quot;q&quot; &#39;s&#39;"} />,
    );
    expect(container.querySelector("mark")?.textContent).toBe("a & b");
    expect(container.textContent).toBe("a & b &lt; \"q\" 's'");
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });
});
