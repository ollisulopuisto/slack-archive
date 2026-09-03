/**
 * Self-heal for old permalink format (index.html?c=CHANNEL&ts=TS).
 * Redirects to new infinite-scroll channel entry point: CHANNEL.html#TS&resolved=1
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
    window.location.replace(
      base + "html/" + channel + ".html#" + tsValue + "&resolved=1",
    );
  }
})();
