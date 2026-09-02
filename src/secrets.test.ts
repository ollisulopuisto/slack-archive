import { describe, expect, it } from "vitest";

import { redactToken } from "./secrets.js";

describe("redactToken", () => {
  it("keeps enough to recognise the token and nothing that is the token", () => {
    expect(redactToken("xoxp-1234567890-abcdefgh")).toBe("xoxp-…efgh");
  });

  it("does not print a missing token as undefined", () => {
    expect(redactToken(undefined)).toBe("(none)");
    expect(redactToken("")).toBe("(none)");
  });
});
