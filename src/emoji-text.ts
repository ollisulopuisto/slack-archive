import { getEmojiRef, getEmojiUnicode, isEmojiUnicode } from "./emoji.js";
import { shortcodePattern } from "./emoji-render.js";

/**
 * A shortcode as Slack writes one, defined once in emoji-render.ts and used
 * here and by the search page, which does the same job in the browser. Two
 * copies of this regex would be two ideas of what an emoji is.
 *
 * Shared safely because `replace` with a global regex starts at the beginning
 * and leaves lastIndex where it found it.
 */
const SHORTCODE = shortcodePattern();

/** Tags whose contents are quoted text and must be left exactly as typed. */
const VERBATIM = /^<\/?(code|pre)\b/i;

/**
 * Emoji in message text, rendered the way reactions have always been.
 *
 * Reactions have shown custom emoji as pictures since the beginning. Message
 * text did not: the same emoji was an image below a message and the literal
 * `:handshake-3d:` inside it, which reads as though the archive failed to
 * fetch something it in fact had on disk.
 *
 * This works on the HTML slack-markdown has already produced, so it splits on
 * tags and only ever touches the text between them. Rewriting inside a tag
 * would turn a URL containing a colon pair into an image and break the link.
 */
export function renderEmojiInHtml(html: string, base: string): string {
  let verbatimDepth = 0;

  return html.replace(/<[^>]*>|[^<]+/g, (chunk) => {
    if (chunk.startsWith("<")) {
      if (VERBATIM.test(chunk)) {
        verbatimDepth += chunk.startsWith("</") ? -1 : 1;
      }

      return chunk;
    }

    if (verbatimDepth > 0) {
      return chunk;
    }

    return chunk.replace(SHORTCODE, (whole, _shortcode, name: string) => {
      const lower = name.toLowerCase();

      if (isEmojiUnicode(lower)) {
        return getEmojiUnicode(lower);
      }

      const ref = getEmojiRef(lower);

      // An emoji this workspace made but never downloaded: better the
      // shortcode than an empty box. The text still says what was meant.
      return ref
        ? `<img class="emoji" src="${base}${ref}" alt=":${lower}:" title=":${lower}:">`
        : whole;
    });
  });
}
