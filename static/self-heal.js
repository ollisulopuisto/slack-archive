/**
 * The front page's answer to a link written before the archive had per-page
 * URLs: index.html?c=C123&ts=...
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
    var pages = window.ARCHIVE_PAGES || {};

    if (!/-\d+$/.test(channel)) {
      var boundaries = pages[channel];
      var page = 0;

      if (boundaries && tsValue) {
        page = boundaries.findIndex(function (start) {
          return start < tsValue;
        });
        if (page < 0) page = boundaries.length - 1;
      }

      channel = channel + "-" + Math.max(0, page);
    }

    window.location.replace(
      base + channel + ".html?resolved=1" + (tsValue ? "#" + tsValue : ""),
    );
  }
})();
