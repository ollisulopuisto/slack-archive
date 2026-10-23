import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("the search page's scripts", () => {
  const template = fs.readFileSync(
    path.join(here, "../static/search.html"),
    "utf8",
  );
  const search = fs.readFileSync(path.join(here, "search.ts"), "utf8");

  it("does not compile JSX in the browser and does not fetch a CDN", () => {
    expect(template).not.toContain("text/babel");
    expect(template).not.toContain("babel");
    expect(search).not.toContain("jsdelivr");
    expect(search).not.toContain("cdn.");
    expect(search).not.toContain("getScript(");
  });

  it("loads the app as a file, so a CSP can forbid inline script", () => {
    expect(template).toContain("<!-- search-app -->");
    expect(search).toContain('"<!-- search-app -->"');
  });

  it("can instantiate and render search-app without reference or runtime errors", async () => {
    const React = await import("react");
    const vm = await import("vm");
    const appSource = fs.readFileSync(
      path.join(here, "../lib/search-app.js"),
      "utf8",
    );
    const stripped = appSource
      .replace(/^import .+;?\n/gm, "")
      .replace(/export \{\};\n?/g, "");

    let renderedElement: any = null;
    const context = vm.createContext({
      React: React.default || React,
      ReactDOM: {
        render: (element: any) => {
          renderedElement = element;
        },
      },
      window: {
        location: { search: "" },
        addEventListener: () => {},
        removeEventListener: () => {},
        SEARCH_INDEXES: { db: true },
        SEARCH_METADATA: { channels: {}, users: {} },
      },
      URLSearchParams: globalThis.URLSearchParams,
      document: {
        getElementById: () => ({}),
        baseURI: "http://localhost/",
      },
      splitEmoji: () => [],
      splitSearchHighlight: () => [],
      messageLink: () => "#",
      console,
    });

    // Execute the stripped script as browser does
    expect(() => {
      vm.runInContext(stripped, context);
    }).not.toThrow();

    expect(renderedElement).toBeDefined();
    // Instantiate App and call render() to verify render logic does not throw ReferenceError
    const appInstance = new renderedElement.type({});
    expect(() => {
      appInstance.render();
    }).not.toThrow();

    // Verify render branches with various filter states
    appInstance.state.timeRange = "custom";
    appInstance.state.fromDate = "2025-01-01";
    appInstance.state.toDate = "2025-12-31";
    appInstance.state.searchValue = "hello";
    appInstance.state.matchingMessages = [
      { id: "1", c: "C1", u: "U1", t: "123.456", m_text: "hello world" },
    ];
    appInstance.state.channels = { C1: "general" };
    appInstance.state.users = { U1: "alice" };
    expect(() => {
      appInstance.render();
    }).not.toThrow();

    // Media mode, before and after the database worker is open
    appInstance.state.mode = "media";
    expect(() => {
      appInstance.render();
    }).not.toThrow();

    appInstance.worker = { db: { query: async () => [] } };
    appInstance.state.mediaFiles = [
      {
        id: "F1",
        c: "C1",
        u: "U1",
        t: "123.456",
        filename: "F1.png",
        is_image: 1,
        name: "cat.png",
      },
    ];
    expect(() => {
      appInstance.render();
    }).not.toThrow();

    // Error state
    appInstance.state.error = "test failure";
    expect(() => {
      appInstance.render();
    }).not.toThrow();
  });
});

describe("the reactions and replies on a result", () => {
  async function renderResult(message: Record<string, unknown>) {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const vm = await import("vm");
    const appSource = fs.readFileSync(
      path.join(here, "../lib/search-app.js"),
      "utf8",
    );
    const stripped = appSource
      .replace(/^import .+;?\n/gm, "")
      .replace(/export \{\};\n?/g, "");

    const context = vm.createContext({
      React: React.default || React,
      ReactDOM: { render: () => {} },
      window: {
        location: { search: "" },
        addEventListener: () => {},
        removeEventListener: () => {},
        SEARCH_INDEXES: { db: true },
        SEARCH_METADATA: { channels: {}, users: {} },
      },
      URLSearchParams: globalThis.URLSearchParams,
      document: {
        getElementById: () => ({}),
        baseURI: "http://localhost/",
      },
      splitEmoji: (text: string) =>
        text === ":party:"
          ? [{ kind: "image", name: "party", ref: "emojis/party.png" }]
          : [{ kind: "text", text }],
      splitSearchHighlight: () => [],
      messageLink: () => "#",
      console,
    });
    vm.runInContext(stripped, context);

    const Message = vm.runInContext("Message", context);
    return renderToStaticMarkup(
      React.createElement(Message, {
        message: {
          id: "1",
          c: "C1",
          u: "U1",
          t: "123.456",
          m_text: "hei",
          ...message,
        },
        channels: { C1: "general" },
        users: { U1: "alice" },
        query: "",
      }),
    );
  }

  const PAIR = "\u001e";
  const FIELD = "\u001f";
  const reactions = (...pairs: Array<[string, number]>) =>
    pairs.map(([name, count]) => `${name}${FIELD}${count}`).join(PAIR);

  it("shows each emoji with how many reacted with it", async () => {
    const html = await renderResult({
      reaction_list: reactions(["cat", 2], ["joy", 1]),
    });

    expect(html).toContain("MessageReaction");
    expect(html).toContain(":cat:");
    expect(html).toContain(">2<");
    expect(html).toContain(":joy:");
    expect(html).toContain(">1<");
  });

  it("puts the most reacted emoji first, whatever order the query gave", async () => {
    const html = await renderResult({
      reaction_list: reactions(["joy", 1], ["cat", 5], ["eyes", 5]),
    });

    // Equal counts fall back to the name, so the order is the same each time.
    expect(html.indexOf(":cat:")).toBeLessThan(html.indexOf(":eyes:"));
    expect(html.indexOf(":eyes:")).toBeLessThan(html.indexOf(":joy:"));
  });

  it("draws a custom emoji as its picture", async () => {
    const html = await renderResult({
      reaction_list: reactions(["party", 3]),
    });

    expect(html).toContain('src="html/emojis/party.png"');
    expect(html).toContain(">3<");
  });

  it("keeps a skin tone in the emoji's name", async () => {
    // The colons in the name are why the list is not split on a colon.
    const html = await renderResult({
      reaction_list: reactions(["+1::skin-tone-3", 2]),
    });

    expect(html).toContain(":+1::skin-tone-3:");
    expect(html).toContain(">2<");
  });

  it("shows how many replied, in the singular for one", async () => {
    expect(await renderResult({ reply_count: 2 })).toContain("2 replies");
    expect(await renderResult({ reply_count: 1 })).toContain("1 reply<");
  });

  it("shows nothing for a message nobody reacted to or replied to", async () => {
    const html = await renderResult({ reaction_list: null, reply_count: 0 });

    expect(html).not.toContain("MessageReaction");
    expect(html).not.toContain("repl");
  });

  it("shows nothing from a search that did not ask", async () => {
    // The fallback index in the browser has neither to give.
    const html = await renderResult({});

    expect(html).not.toContain("MessageReaction");
    expect(html).not.toContain("MessageSignal");
  });
});
