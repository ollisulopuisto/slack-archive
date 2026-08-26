// "3 days ago" for the <time> elements the pages carry.
//
// The pages are static files that may be read a minute or a year after they
// were written, so the absolute moment is what gets rendered into the HTML and
// the phrase is worked out in the reader's browser, against their clock. With
// no JavaScript the date itself is still there and still true.

function relativeTime(iso, now) {
  const then = new Date(iso).getTime();

  if (!isFinite(then)) return "";

  const seconds = Math.round((now.getTime() - then) / 1000);

  // Clock skew, or a page generated a moment ago on a machine running fast.
  if (seconds < 45) return "just now";

  const units = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2592000],
    ["year", 31536000],
  ];

  let name = "minute";
  let size = 60;

  for (const [unitName, unitSize] of units) {
    if (seconds >= unitSize) {
      name = unitName;
      size = unitSize;
    }
  }

  const n = Math.round(seconds / size);

  return `${n} ${name}${n === 1 ? "" : "s"} ago`;
}

function applyRelativeTimes(root, now) {
  for (const element of root.querySelectorAll("time[data-relative]")) {
    const phrase = relativeTime(element.getAttribute("datetime"), now);

    if (!phrase) continue;

    // The exact moment stays reachable on hover; the page says the useful
    // thing.
    if (!element.title) element.title = element.textContent.trim();
    element.textContent = phrase;
  }
}

if (typeof document !== "undefined") {
  applyRelativeTimes(document, new Date());
}
