import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";

import { writeChunk, ensureChunkDir } from "./chunk-writer.js";

const testDir = "/tmp/test-chunks-writer";

describe("chunk-writer", () => {
  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe("ensureChunkDir", () => {
    it("creates the chunk directory for a channel", async () => {
      const dir = await ensureChunkDir("C123", testDir);
      expect(dir).toBe(path.join(testDir, "C123"));
      const exists = await fs.pathExists(dir);
      expect(exists).toBe(true);
    });
  });

  describe("writeChunk", () => {
    it("creates JSON file with correct structure", async () => {
      const chunk = {
        messages: [{ ts: "123.456", text: "hello", user: "U1" }],
        oldestTs: "123.456",
        newestTs: "123.456",
        index: 0,
        total: 1,
      };

      await writeChunk(testDir, "C123", 0, chunk);

      const content = await fs.readFile(
        path.join(testDir, "C123", "chunk-0.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.index).toBe(0);
      expect(parsed.oldestTs).toBe("123.456");
      expect(parsed.newestTs).toBe("123.456");
      expect(parsed.total).toBe(1);
    });

    it("writes multiple chunks to the same channel directory", async () => {
      const chunk1 = {
        messages: [{ ts: "123.456", text: "first", user: "U1" }],
        oldestTs: "123.456",
        newestTs: "123.456",
        index: 0,
        total: 2,
      };
      const chunk2 = {
        messages: [{ ts: "123.457", text: "second", user: "U1" }],
        oldestTs: "123.457",
        newestTs: "123.457",
        index: 1,
        total: 2,
      };

      await writeChunk(testDir, "C123", 0, chunk1);
      await writeChunk(testDir, "C123", 1, chunk2);

      const content1 = await fs.readFile(
        path.join(testDir, "C123", "chunk-0.json"),
        "utf-8",
      );
      const content2 = await fs.readFile(
        path.join(testDir, "C123", "chunk-1.json"),
        "utf-8",
      );

      expect(JSON.parse(content1).index).toBe(0);
      expect(JSON.parse(content2).index).toBe(1);
    });
  });
});