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

  // ------------------------------------------------------------------
  // Instability, on purpose.
  //
  // A static number with an error bar gets read as "the answer, plus a
  // decoration". A number that will not sit still gets read as what it is: a
  // draw from a range, and we do not know which draw is right. Every second or
  // so, everything speculative is redrawn somewhere else inside its own
  // interval - the digits shuffle, the dotted line moves, the hollow caps
  // breathe.
  //
  // Only things whose range was actually computed take part. A number invented
  // by scaling somebody's share has no measured spread, and inventing a wobble
  // for it would be inventing a claim.
  // ------------------------------------------------------------------

  var wobblers = targets
    .map(function (target) {
      var value = target.querySelector(".viz-tile-value") || target;
      var low = Number(target.dataset.low);
      var high = Number(target.dataset.high);

      return isFinite(low) && isFinite(high) && high > low
        ? { element: value, low: low, high: high, like: target.dataset.speculative }
        : null;
    })
    .filter(Boolean);

  var lines = [].slice.call(document.querySelectorAll(".viz-estimate[data-low]"));
  var caps = [].slice.call(document.querySelectorAll(".viz-estimate-cap[data-low]"));

  /** A draw that favours the middle: three uniforms averaged, clamped. */
  function draw(low, high) {
    var t = (Math.random() + Math.random() + Math.random()) / 3;
    return low + (high - low) * t;
  }

  function points(text) {
    return (text || "").split(" ").map(function (pair) {
      var xy = pair.split(",");
      return [Number(xy[0]), Number(xy[1])];
    });
  }

  function shuffle() {
    if (!toggle.checked || !motion) return;

    wobblers.forEach(function (w) {
      w.element.textContent = format(Math.round(draw(w.low, w.high)), w.like);
    });

    lines.forEach(function (line) {
      var low = points(line.dataset.low);
      var high = points(line.dataset.high);
      // One draw for the whole run, wobbled per point: a month's estimate is
      // not independent of the month beside it, and a line drawn from
      // independent draws looks like noise rather than like uncertainty.
      var shared = draw(0, 1);

      line.setAttribute(
        "points",
        low
          .map(function (p, i) {
            var t = Math.min(1, Math.max(0, shared + (Math.random() - 0.5) * 0.25));
            return p[0] + "," + (p[1] + (high[i][1] - p[1]) * t);
          })
          .join(" "),
      );
    });

    caps.forEach(function (cap) {
      var base = Number(cap.dataset.base);
      var floor = Number(cap.dataset.floor);
      var top = draw(Number(cap.dataset.low), Number(cap.dataset.high));

      cap.setAttribute("y", String(base - top));
      cap.setAttribute("height", String(Math.max(1, top - floor)));
    });
  }

  var ticking = null;

  function startShuffling() {
    if (ticking || !motion) return;
    ticking = setInterval(shuffle, 1100);
    shuffle();
  }

  function stopShuffling() {
    if (!ticking) return;
    clearInterval(ticking);
    ticking = null;
  }

  toggle.addEventListener("change", function () {
    if (toggle.checked) startShuffling();
    else stopShuffling();
  });

  toggle.checked = false;
  toggle.addEventListener("change", apply);
  apply();
})();
