// Land where you were sent: at the message in the URL, or at the newest one.
//
// getElementById(hash) never worked - the hash carries its own "#" - and a
// message id that is not on this page threw, which stopped the rest of the
// page's scripts. The archive has plenty of both.
(function () {
  var id = (window.location.hash || "").slice(1);
  var target = id ? document.getElementById(id) : null;

  if (target) {
    target.scrollIntoView();
  } else if (!id) {
    window.scrollTo(0, document.body.scrollHeight);
  }
})();
