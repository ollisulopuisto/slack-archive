import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(
  path.join(here, "../scripts/publish.sh"),
  "utf8",
);

describe("publish.sh", () => {
  it("stages the picture readings for the render", () => {
    // The website's search database is built from the staged directory. A
    // reading that is not copied in is a reading the website never has, however
    // many pictures have been read.
    const copied = script.slice(
      script.indexOf("for f in channels.json"),
      script.indexOf("done", script.indexOf("for f in channels.json")),
    );

    expect(copied).toContain("ocr.jsonl");
  });

  it("does not stop for readings that do not exist yet", () => {
    // Nothing has been read on a fresh install; the copy must say nothing and
    // go on.
    const copy = script.slice(
      script.indexOf('cp "$ARCHIVE/data/$f"'),
      script.indexOf("\ndone", script.indexOf('cp "$ARCHIVE/data/$f"')),
    );

    expect(copy).toContain("|| true");
  });
});
