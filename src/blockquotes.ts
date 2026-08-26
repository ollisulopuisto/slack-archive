/**
 * Slack's quoted messages, told apart from the rest of the text.
 *
 * Slack escapes `<`, `>` and `&` in message text, so a quote arrives as
 * `&gt; the thing somebody said`. The markdown renderer looks for `>` and does
 * not find it, so the quote is rendered as ordinary text with a stray angle
 * bracket in front - which is what a decade of quoted articles in this archive
 * looked like.
 *
 * Unescaping the text first would fix the quotes and open every message in the
 * archive to whatever HTML somebody typed into Slack ten years ago. So the
 * marker is recognised in its escaped form, stripped, and the block is marked
 * as a quote; the text itself is never unescaped.
 */
export interface TextBlock {
  quote: boolean;
  text: string;
}

/** `>` or Slack's escaped `&gt;`, at the start of a line, and what follows. */
const QUOTE_LINE = /^(?:&gt;|>)\s?(.*)$/;
/** `>>>`: everything from here on is quoted. */
const QUOTE_REST = /^(?:(?:&gt;){3}|>{3})\s?(.*)$/;

export function splitQuotes(text: string | undefined): Array<TextBlock> {
  if (!text) return [];

  const lines = text.split("\n");
  const blocks: Array<TextBlock> = [];
  let current: TextBlock | undefined;

  const start = (quote: boolean, line: string) => {
    current = { quote, text: line };
    blocks.push(current);
  };

  for (const [i, line] of lines.entries()) {
    const rest = line.match(QUOTE_REST);

    if (rest) {
      // Slack's own semantics: >>> quotes the remainder of the message.
      const remainder = [rest[1], ...lines.slice(i + 1)].join("\n");
      blocks.push({ quote: true, text: remainder });
      return blocks.filter((block) => block.text.length > 0 || block.quote);
    }

    const quoted = line.match(QUOTE_LINE);

    if (quoted) {
      if (current?.quote) current.text += `\n${quoted[1]}`;
      else start(true, quoted[1]);
      continue;
    }

    if (current && !current.quote) current.text += `\n${line}`;
    else start(false, line);
  }

  return blocks.filter((block) => block.text.trim().length > 0);
}
