import { describe, expect, it } from "vitest";

import { splitQuotes } from "./blockquotes.js";

describe("splitQuotes()", () => {
  it("finds a quote Slack has escaped", () => {
    // Slack escapes <, > and & in message text, so a quoted message arrives as
    // "&gt; ..." - which the markdown renderer does not recognise as a quote,
    // and the browser then draws as a literal > in front of the sentence.
    expect(splitQuotes("&gt; There's always incredible music")).toEqual([
      { quote: true, text: "There's always incredible music" },
    ]);
  });

  it("finds one Slack has not", () => {
    expect(splitQuotes("> quoted")).toEqual([{ quote: true, text: "quoted" }]);
  });

  it("keeps a quote and the reply to it apart", () => {
    expect(splitQuotes("&gt; the claim\nno it isn't")).toEqual([
      { quote: true, text: "the claim" },
      { quote: false, text: "no it isn't" },
    ]);
  });

  it("joins the lines of one quote into one block", () => {
    expect(splitQuotes("&gt; first\n&gt; second\nafter")).toEqual([
      { quote: true, text: "first\nsecond" },
      { quote: false, text: "after" },
    ]);
  });

  it("quotes everything after >>>, which is what Slack means by it", () => {
    expect(splitQuotes("look:\n&gt;&gt;&gt; all\nof\nthis")).toEqual([
      { quote: false, text: "look:" },
      { quote: true, text: "all\nof\nthis" },
    ]);
  });

  it("leaves a > that is in the middle of a sentence alone", () => {
    expect(splitQuotes("5 &gt; 4 and always has been")).toEqual([
      { quote: false, text: "5 &gt; 4 and always has been" },
    ]);
  });

  it("does not mistake an arrow for a quote", () => {
    expect(splitQuotes("-&gt; that way")).toEqual([
      { quote: false, text: "-&gt; that way" },
    ]);
  });

  it("has nothing to say about an empty message", () => {
    expect(splitQuotes("")).toEqual([]);
    expect(splitQuotes(undefined)).toEqual([]);
  });

  it("keeps a blank line inside a quote from splitting it in two", () => {
    expect(splitQuotes("&gt; one\n&gt;\n&gt; two")).toEqual([
      { quote: true, text: "one\n\ntwo" },
    ]);
  });
});
