// Land where you were sent: at the message in the URL, or at the newest one.
//
// And when the message is NOT on this page, do not just sit there. Pages are
// cut newest-first in blocks of a thousand, so one new message pushes one off
// the end of every page after it: a link built from an older index points at a
// page that no longer holds its message. There is no error - the reader lands
// at the top of roughly the right era and nothing says why.
//
// So a miss hands the timestamp to the front page, which resolves it against
// the pages index shipped with THIS render and sends the reader on. A link
// that has drifted repairs itself; one that was never valid ends up on a front
// page rather than in a silence.
(function () {
  var id = (window.location.hash || "").slice(1);

  if (!id) {
    window.scrollTo(0, document.body.scrollHeight);
    return;
  }

  var target = document.getElementById(id);

  if (target) {
    target.scrollIntoView();
    return;
  }

  // "C2GVD3L85-451.html" -> "C2GVD3L85". Only a timestamp is worth resolving;
  // anything else is somebody's own anchor and is left alone.
  var page = (window.location.pathname.split("/").pop() || "").replace(
    /\.html$/,
    "",
  );
  var channel = page.replace(/-\d+$/, "");

  if (!/^[CDG][A-Z0-9]+$/.test(channel) || !/^\d+\.\d+$/.test(id)) return;

  // Only once: if the front page sends us back here and the message still is
  // not on the page, the archive does not have it and a loop helps nobody.
  if (window.location.search.indexOf("resolved=1") !== -1) return;

  window.location.replace(
    "../index.html?c=" +
      encodeURIComponent(channel) +
      "&ts=" +
      encodeURIComponent(id) +
      "&from=page",
  );
})();
