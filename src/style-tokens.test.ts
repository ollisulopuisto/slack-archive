import { describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const css = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../static/style.css",
  ),
  "utf8",
);

describe("the stylesheet's colour tokens", () => {
  it("never defines a property as itself", () => {
    // `--surface: var(--surface)` is guaranteed-invalid: the token becomes
    // undefined, and everything that used it falls back to transparent. A
    // find-and-replace over an older block produced exactly that, and the only
    // symptom was a sticky header you could see through.
    const selfReferential = [
      ...css.matchAll(/(--[\w-]+):\s*var\(\1\s*\)/g),
    ].map((m) => m[1]);

    expect(selfReferential).toEqual([]);
  });

  it("defines every token it uses", () => {
    const defined = new Set(
      [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    );
    const used = new Set(
      [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]),
    );

    expect([...used].filter((token) => !defined.has(token))).toEqual([]);
  });

  it("keeps the dark scheme to redefining tokens, not restating rules", () => {
    const start = css.indexOf("@media (prefers-color-scheme: dark)");
    const block = css.slice(
      start,
      css.indexOf("\n}\n", css.indexOf(":root", start)),
    );

    expect(block).toContain("--page:");
    expect(block).toContain("--ink:");
    // If this ever contains a selector other than :root, the dark scheme has
    // started to be a second set of rules that can drift from the first.
    expect(block.match(/^\s{2}[.#a-z][^{]*\{/gm)).toBeNull();
  });
});
