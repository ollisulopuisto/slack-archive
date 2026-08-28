/**
 * Where the emoji in a line of text are, shared with the search page.
 *
 * The archive's own pages render emoji on the server: emoji-text.ts rewrites
 * the HTML that slack-markdown produced, with the emoji list and the emoji
 * directory both at hand. The search page has neither. It is a template with a
 * browser-side app in it, and what it renders is the raw message text out of
 * the index - so `:nuclear-huutonaurut:` stayed `:nuclear-huutonaurut:` there
 * long after it had become a picture everywhere else.
 *
 * This is the part both can share: given a line and a list of what the emoji
 * are, say which pieces of it are text and which are emoji. What to DO with
 * them differs - the renderer writes an <img> tag, the search page makes a
 * React element - so that part is left to each caller.
 *
 * It imports nothing, because the compiled file is inlined into the search
 * page with the `export` keywords stripped out. See createSearchHTML.
 */

/**
 * A shortcode as Slack writes one: `:tada:`, `:handshake-3d:`, `:+1:`.
 *
 * The lookarounds are what keep a clock from becoming an emoji. `12:30:45`
 * contains `:30:`, which is the right shape and the wrong thing entirely; the
 * digits either side are the only evidence that it is a time, so a shortcode
 * is one only when it is not glued to a word or a number.
 */
export const SHORTCODE_SOURCE = "(?<![\\w:])(:([a-z0-9_+'-]+):)(?![\\w:])";

/** A fresh regex every time: a shared /g one carries its lastIndex along. */
export function shortcodePattern(): RegExp {
  return new RegExp(SHORTCODE_SOURCE, "gi");
}

/**
 * What the browser is told about this workspace's emoji.
 *
 * `unicode` is every standard shortcode mapped to the character it means, and
 * `custom` is every emoji this workspace made and this archive downloaded,
 * mapped to the file, relative to the html directory - the same reference the
 * rendered pages use.
 */
export interface EmojiIndex {
  unicode?: Record<string, string>;
  custom?: Record<string, string>;
}

/** A run of ordinary text, or one emoji found in it. */
export type EmojiPart =
  | { kind: "text"; text: string }
  | { kind: "image"; name: string; ref: string };

/**
 * A line split into text and the emoji in it, in the order they were typed.
 *
 * A standard emoji becomes its character and stays inside the text around it -
 * it is a letter, not a picture. A custom one becomes an image part. A
 * shortcode this archive has no emoji for is left exactly as typed: better the
 * shortcode than an empty box, which is what the rendered pages do too.
 */
export function splitEmoji(text: string, index: EmojiIndex): Array<EmojiPart> {
  const unicode = index.unicode || {};
  const custom = index.custom || {};
  const parts: Array<EmojiPart> = [];
  const pattern = shortcodePattern();

  let plain = "";
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const name = match[2].toLowerCase();
    const ref = unicode[name] ? undefined : custom[name];

    plain += text.slice(last, match.index);
    last = match.index + match[0].length;

    if (ref) {
      if (plain) parts.push({ kind: "text", text: plain });
      plain = "";
      parts.push({ kind: "image", name, ref });
    } else {
      plain += unicode[name] || match[0];
    }
  }

  plain += text.slice(last);
  if (plain) parts.push({ kind: "text", text: plain });

  return parts;
}
