// Land where you were sent: at the message in the URL, or at the newest one.
//
// And when the message is NOT on this page, do not just sit there. Pages are
// cut newest-first in blocks of a thousand, so one new message pushes one off
// the end of every page after it: a link built from an older index points at a
// page that no longer holds its message. There is no error - the reader lands
// at the top of roughly the right era and nothing says why.
//
// So a miss hands the reader to the channel's entry page, at the same
// timestamp. The entry page resolves the timestamp against the chunk index
// shipped with THIS render, and when the archive does not have the message it
// degrades to the channel - it never redirects again - so the hand-off cannot
// loop. A link that has drifted repairs itself; one that was never valid ends
// up on a channel rather than in a silence.
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

  window.location.replace(channel + ".html#" + id);
})();
