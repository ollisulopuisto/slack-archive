// Close the drawer once you have picked something out of it: on a phone it
// covers the very thing you just asked to read. The drawer itself is a
// checkbox and needs no script; this is only the courtesy.
(function () {
  var toggle = document.getElementById("nav-toggle");
  var list = document.getElementById("channels");

  if (!toggle || !list) return;

  list.addEventListener("click", function (event) {
    if (event.target.closest("a")) toggle.checked = false;
  });
})();
