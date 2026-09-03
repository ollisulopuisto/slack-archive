import { describe, it, expect } from "vitest";

import { ChunkData, serializeChunk, deserializeChunk } from "./chunk-types.js";
import { ArchiveMessage } from "./interfaces.js";

describe("ChunkData", () => {
  it("serializeChunk produces valid JSON", () => {
    const messages: ArchiveMessage[] = [
      { ts: "123.456", text: "hi", user: "U1" },
    ];
    const chunk: ChunkData = {
      messages,
      oldestTs: "123.456",
      newestTs: "123.456",
      index: 0,
      total: 1,
    };
    const json = serializeChunk(chunk);
    const parsed = JSON.parse(json);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.index).toBe(0);
  });

  it("deserializeChunk round-trips", () => {
    const original: ChunkData = {
      messages: [{ ts: "123.456", text: "hi", user: "U1" }],
      oldestTs: "123.456",
      newestTs: "123.456",
      index: 0,
      total: 1,
    };
    const json = serializeChunk(original);
    const restored = deserializeChunk(json);
    expect(restored.messages[0].ts).toBe("123.456");
  });
});
