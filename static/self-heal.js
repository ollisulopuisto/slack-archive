/**
 * Self-heal for old permalink format (index.html?c=CHANNEL&ts=TS).
 * Redirects to the channel's entry page, at the message: CHANNEL.html#TS.
 *
 * The entry page resolves the timestamp itself (its chunk index says which
 * file holds it), and when the archive does not have the message it degrades
 * to the channel - it never redirects again - so no hop mark is needed.
 *
 * The prefix to the html directory is on <html data-archive-base>, so this
 * file can be the same on every page and a CSP can forbid inline script.
 */
(function () {
  var params = new URLSearchParams(window.location.search);
  var channelValue = params.get("c");
  var tsValue = params.get("ts");
  var base = document.documentElement.getAttribute("data-archive-base") || "";

  if (channelValue) {
    var channel = decodeURIComponent(channelValue);
    window.location.replace(base + "html/" + channel + ".html#" + tsValue);
  }
})();
