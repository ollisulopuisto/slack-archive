/**
 * The front page's answer to a link written before the archive had per-page
 * URLs.
 *
 * Those links name a channel and a moment - `index.html?c=C123&ts=...` - and
 * the archive's own messages carry thousands of them, people paste them around
 * Slack, and the bot generates them. A page number is an accident of how the
 * channel was chunked and changes as it grows, so the page is worked out here
 * from the timestamp and the reader is sent on.
 *
 * It lives in its own function because it shipped broken: the base was written
 * as an escaped `${base}` inside a template literal, so the redirect went to
 * a URL with those seven characters in it and every old link 404ed. A string
 * that is assembled to be executed elsewhere is worth a test.
 */
export function selfHealingRedirect(base: string): string {
  return `
            var params = new URLSearchParams(window.location.search);
            var channelValue = params.get("c");
            var tsValue = params.get("ts");

            if (channelValue) {
              var channel = decodeURIComponent(channelValue);
              var pages = window.ARCHIVE_PAGES || {};

              // A permalink names the channel and the moment, not the page
              // number - a page number is an accident of how the archive was
              // chunked, and it changes as the channel grows.
              if (!/-\\d+$/.test(channel)) {
                var boundaries = pages[channel];
                var page = 0;

                if (boundaries && tsValue) {
                  page = boundaries.findIndex(function (start) {
                    return start < tsValue;
                  });
                  if (page < 0) page = boundaries.length - 1;
                }

                channel = channel + '-' + Math.max(0, page);
              }

              // Marked, so a page that still cannot find the message sends
              // nobody back here: one hop, then an honest landing.
              window.location.replace(
                ${JSON.stringify(base)} + channel + '.html?resolved=1' +
                  (tsValue ? '#' + tsValue : '')
              );
            }
            `;
}
