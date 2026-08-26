// The "what is missing" toggle.
//
// Off by default and off on every page load: a number that includes an
// estimate is a different kind of number, and the page should not start by
// showing you one. When it is on, every tile that has a speculative value
// swaps to it and says so; when it is off, the page counts what was archived.
(function () {
  var toggle = document.getElementById("speculate");

  if (!toggle) return;

  var tiles = [].slice.call(document.querySelectorAll("[data-speculative]"));

  function apply() {
    var on = toggle.checked;

    document.body.classList.toggle("speculating", on);

    tiles.forEach(function (tile) {
      var value = tile.querySelector(".viz-tile-value");
      var hint = tile.querySelector(".viz-tile-hint");

      if (!value) return;

      if (on) {
        value.dataset.archived = value.dataset.archived || value.textContent;
        value.textContent = tile.dataset.speculative;
        if (hint) {
          hint.dataset.archived = hint.dataset.archived || hint.textContent;
          hint.textContent = tile.dataset.speculativeHint || "including an estimate";
        }
      } else if (value.dataset.archived) {
        value.textContent = value.dataset.archived;
        if (hint && hint.dataset.archived) hint.textContent = hint.dataset.archived;
      }
    });
  }

  toggle.checked = false;
  toggle.addEventListener("change", apply);
  apply();
})();
