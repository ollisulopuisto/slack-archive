import { describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "create-html.tsx"),
  "utf8",
);

describe("estimates the pages hand to a chart", () => {
  it("never claim a range of exactly nothing", () => {
    // speculative.js only animates a number whose high is above its low, so a
    // { low: estimate, high: estimate } object is the difference between a
    // number that admits it is a guess and one that sits there looking
    // measured. Every share-of-the-missing-days estimate used to be built that
    // way, which is why "Who talks" swapped its numbers and then froze.
    const degenerate = [
      /low:\s*estimate,\s*\n?\s*high:\s*estimate/,
      // An accumulator seeded { low: 0, high: 0 } is fine; a range whose two
      // ends are the same expression is the bug.
      /low:\s*([A-Za-z_][\w.]*),\s*\n?\s*high:\s*\1\s*[,}]/,
    ].filter((pattern) => pattern.test(source));

    expect(degenerate).toEqual([]);
  });
});
