// The "count what is missing too" toggle.
//
// Off by default and off on every page load: a number that includes an
// estimate is a different kind of number, and a page should not open by
// showing you one. When it is on, EVERY number on the page that has an
// estimate swaps - the tiles, the per-person totals, the per-channel totals -
// because a page where some numbers include the missing days and others do not
// is worse than either page on its own.
(function () {
  var toggle = document.getElementById("speculate");

  if (!toggle) return;

  var targets = [].slice.call(document.querySelectorAll("[data-speculative]"));

  var motion = !window.matchMedia
    ? true
    : !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** "1 214 458" -> 1214458, whatever spaces the locale used. */
  function toNumber(text) {
    var digits = (text || "").replace(/[^0-9]/g, "");
    return digits ? parseInt(digits, 10) : null;
  }

  function format(value, like) {
    // Match the grouping the page already uses rather than inventing one.
    var grouped = value.toLocaleString("fi-FI").replace(/\u00a0/g, " ");
    return /\u00a0/.test(like) ? grouped.replace(/ /g, "\u00a0") : grouped;
  }

  /** Count from one number to the other, because a number that CHANGES is
   *  harder to mistake for a number that was always there. */
  function countTo(element, from, to, like) {
    var started = null;
    var span = 520;

    function frame(now) {
      if (started === null) started = now;
      var t = Math.min(1, (now - started) / span);
      var eased = 1 - Math.pow(1 - t, 3);

      element.textContent = format(
        Math.round(from + (to - from) * eased),
        like,
      );

      if (t < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function swap(element, to) {
    if (!element) return;
    if (to === undefined || to === null || to === "") return;

    if (element.dataset.archived === undefined) {
      element.dataset.archived = element.textContent;
    }

    var from = toNumber(element.dataset.archived);
    var target = toNumber(to);

    if (motion && from !== null && target !== null && target !== from) {
      countTo(element, from, target, to);
    } else {
      element.textContent = to;
    }
  }

  function restore(element) {
    if (element && element.dataset.archived !== undefined) {
      element.textContent = element.dataset.archived;
    }
  }

  function apply() {
    var on = toggle.checked;

    document.body.classList.toggle("speculating", on);

    targets.forEach(function (target) {
      // A tile keeps its number in a child; a bar row is the number itself.
      var value = target.querySelector(".viz-tile-value") || target;
      var hint = target.querySelector(".viz-tile-hint");

      if (on) {
        swap(value, target.dataset.speculative);
        swap(hint, target.dataset.speculativeHint);
      } else {
        restore(value);
        restore(hint);
      }
    });
  }

  toggle.checked = false;
  toggle.addEventListener("change", apply);
  apply();
})();
