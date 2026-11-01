import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "create-html.tsx"),
  "utf8",
);

describe("archive accessibility", () => {
  it("gives shared file images an alt text (the file name)", () => {
    const fileImages = source.match(/<img className="file"[^>]*>/g) ?? [];
    expect(fileImages.length).toBeGreaterThan(0);
    for (const tag of fileImages) {
      expect(tag).toContain("alt={name}");
    }
  });

  it("marks avatars decorative so screen readers skip the image URL", () => {
    // The sender's name renders immediately beside the avatar, so a
    // non-empty alt would just repeat it.
    expect(source).toContain('<img className="avatar" src={src} alt="" />');
  });
});
