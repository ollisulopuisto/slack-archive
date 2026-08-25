/**
 * Year -> month -> day -> hour, by clicking.
 *
 * The page ships one bucket per day and hour (see DayHourCube); every level
 * above that is summed here. Counting each level separately would let them
 * disagree, and a drill-down whose totals do not add up is worse than none.
 *
 * Bars are <button>s rather than SVG rects: a rect is not focusable, and this
 * is a control, not a picture. Keyboard and screen readers come free.
 *
 * No modules, no imports - these pages are opened straight off a disk over
 * file://, where a module script is blocked by CORS.
 */
(function () {
  "use strict";

  var MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  function count(hours) {
    var total = 0;
    for (var hour in hours) total += hours[hour];
    return total;
  }

  function formatCount(value) {
    return value.toLocaleString("fi-FI").replace(/ /g, " ");
  }

  /** The buckets to draw at the current depth, in calendar order. */
  function levelData(cube, path) {
    var buckets = [];
    var key;

    if (path.length === 0) {
      var years = {};
      for (key in cube) {
        var year = key.slice(0, 4);
        years[year] = (years[year] || 0) + count(cube[key]);
      }
      var names = Object.keys(years).sort();
      // Every year between the first and the last, so a silent year is a gap
      // rather than being closed up as though it never happened.
      if (names.length) {
        for (var y = Number(names[0]); y <= Number(names[names.length - 1]); y++) {
          buckets.push({ id: String(y), label: String(y), value: years[String(y)] || 0 });
        }
      }
      return buckets;
    }

    if (path.length === 1) {
      var byMonth = {};
      for (key in cube) {
        if (key.slice(0, 4) !== path[0]) continue;
        var month = key.slice(0, 7);
        byMonth[month] = (byMonth[month] || 0) + count(cube[key]);
      }
      for (var m = 1; m <= 12; m++) {
        var id = path[0] + "-" + String(m).padStart(2, "0");
        buckets.push({ id: id, label: MONTHS[m - 1], value: byMonth[id] || 0 });
      }
      return buckets;
    }

    if (path.length === 2) {
      var parts = path[1].split("-");
      var days = new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
      for (var d = 1; d <= days; d++) {
        var dayId = path[1] + "-" + String(d).padStart(2, "0");
        buckets.push({
          id: dayId,
          label: String(d),
          value: cube[dayId] ? count(cube[dayId]) : 0,
        });
      }
      return buckets;
    }

    var hours = cube[path[2]] || {};
    for (var h = 0; h < 24; h++) {
      buckets.push({
        id: path[2] + "T" + h,
        label: String(h),
        value: hours[h] || 0,
      });
    }
    return buckets;
  }

  var LEVEL_NAMES = ["Years", "Months", "Days", "Hours"];

  function render(root, cube, path) {
    var buckets = levelData(cube, path);
    var max = Math.max(1, ...buckets.map(function (b) { return b.value; }));
    var total = buckets.reduce(function (sum, b) { return sum + b.value; }, 0);

    root.textContent = "";

    var crumbs = document.createElement("div");
    crumbs.className = "dd-crumbs";

    var labels = ["All years"].concat(
      path.map(function (part, i) {
        if (i === 1) {
          return MONTHS[Number(part.slice(5, 7)) - 1] + " " + part.slice(0, 4);
        }
        return part;
      }),
    );

    labels.forEach(function (label, i) {
      if (i > 0) {
        var sep = document.createElement("span");
        sep.className = "dd-sep";
        sep.textContent = "/";
        crumbs.appendChild(sep);
      }

      if (i === labels.length - 1) {
        var here = document.createElement("span");
        here.className = "dd-here";
        here.textContent = label;
        crumbs.appendChild(here);
        return;
      }

      var back = document.createElement("button");
      back.type = "button";
      back.className = "dd-back";
      back.textContent = label;
      back.addEventListener("click", function () {
        render(root, cube, path.slice(0, i));
      });
      crumbs.appendChild(back);
    });

    var summary = document.createElement("span");
    summary.className = "dd-total";
    summary.textContent =
      formatCount(total) + " messages · " + LEVEL_NAMES[path.length];
    crumbs.appendChild(summary);

    root.appendChild(crumbs);

    var chart = document.createElement("div");
    chart.className = "dd-chart";

    buckets.forEach(function (bucket) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "dd-cell";
      cell.disabled = path.length >= 3 || bucket.value === 0;
      cell.title = bucket.label + ": " + formatCount(bucket.value) + " messages";

      var bar = document.createElement("span");
      bar.className = "dd-bar";
      bar.style.height = Math.round((bucket.value / max) * 100) + "%";
      cell.appendChild(bar);

      var label = document.createElement("span");
      label.className = "dd-cell-label";
      label.textContent = bucket.label;
      cell.appendChild(label);

      if (!cell.disabled) {
        cell.addEventListener("click", function () {
          render(root, cube, path.concat(bucket.id));
        });
      }

      chart.appendChild(cell);
    });

    root.appendChild(chart);
  }

  function start() {
    var roots = document.querySelectorAll("[data-drilldown]");

    Array.prototype.forEach.call(roots, function (root) {
      var source = document.getElementById(root.getAttribute("data-drilldown"));
      if (!source) return;

      var cube;
      try {
        cube = JSON.parse(source.textContent);
      } catch (error) {
        return;
      }

      render(root, cube, []);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
