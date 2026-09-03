import { describe, it, expect } from "vitest";

import { ChunkData, serializeChunk, deserializeChunk } from "./chunk-types.js";

describe("ChunkData", () => {
  it("serializeChunk carries the pre-rendered markup, not the raw messages", () => {
    const chunk: ChunkData = {
      html: '<div class="message-gutter" id="123.456">hi</div>',
      oldestTs: "123.456",
      newestTs: "124.456",
      index: 0,
      total: 1,
    };
    const parsed = JSON.parse(serializeChunk(chunk));

    expect(parsed.html).toContain('id="123.456"');
    expect(parsed.oldestTs).toBe("123.456");
    expect(parsed.newestTs).toBe("124.456");
    expect(parsed.messages).toBeUndefined();
  });

  it("deserializeChunk round-trips", () => {
    const original: ChunkData = {
      html: "<div></div>",
      oldestTs: "123.456",
      newestTs: "124.456",
      index: 3,
      total: 7,
    };

    expect(deserializeChunk(serializeChunk(original))).toEqual(original);
  });
});
