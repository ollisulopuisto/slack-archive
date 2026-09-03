// The channel entry page's infinite scroll (channelId.html).
//
// The server pre-rendered every chunk of the channel into a JSON file holding
// finished HTML - emoji, links, avatars, gap dividers all drawn - so this file
// has nothing to do but fetch and insert. It also owns the URL: a #timestamp
// in the address bar becomes a scroll to the message, and scrolling writes the
// message nearest the top back into the address bar, so the link you copy is
// the one you are looking at.
//
// The static channelId-N.html pages do the same job with no JavaScript - for
// file://, for crawlers, for the links already sent. This file is what makes a
// ten-year channel one page.
(function () {
  var list = document.getElementById("channel-messages");
  if (!list) return;

  var channelId = list.getAttribute("data-channel-id");
  var chunksTotal = Number(list.getAttribute("data-chunks") || 0);
  var boundaries = (window.ARCHIVE_CHUNKS || {})[channelId] || [];

  // Which chunk a timestamp is in, or null when the archive does not hold it.
  // Chunk 0 is the newest; the ranges shrink as the index grows.
  function chunkFor(ts) {
    var t = Number.parseFloat(ts);
    if (!Number.isFinite(t) || t <= 0) return null;

    for (var i = 0; i < boundaries.length; i++) {
      var oldest = Number.parseFloat(boundaries[i].oldestTs);
      var newest = Number.parseFloat(boundaries[i].newestTs);
      if (t >= oldest && t <= newest) return i;
    }
    return null;
  }

  function showFallback() {
    list.textContent = "";
    var p = document.createElement("p");
    p.className = "chunk-fallback";
    p.textContent = "The scrolling view could not load this channel. ";
    var a = document.createElement("a");
    a.href = channelId + "-0.html";
    a.textContent = "Read the channel as static pages instead.";
    p.appendChild(a);
    list.appendChild(p);
  }

  if (location.protocol === "file:" || typeof fetch !== "function") {
    showFallback();
    return;
  }

  // The two edges of the loaded range. A sentinel sits at each; when one comes
  // into view - well before it is reached - the next chunk is loaded. DOM order
  // is oldest at the top, so the older sentinel is the first child and the
  // newer one the last.
  var olderSentinel = document.createElement("div");
  olderSentinel.className = "chunk-sentinel";
  var newerSentinel = document.createElement("div");
  newerSentinel.className = "chunk-sentinel";
  list.textContent = "";
  list.appendChild(olderSentinel);
  list.appendChild(newerSentinel);

  var loaded = {};
  var pending = {}; // chunk index -> the callbacks waiting for it to land
  var minLoaded = Infinity; // the oldest chunk on screen (highest index)
  var maxLoaded = -Infinity; // the newest (lowest index)
  var brokenOlder = false;
  var brokenNewer = false;
  var gutters = [];
  var syncIdx = 0;
  var lastSyncedTs = null;

  // Rebuilt whenever a chunk lands: the rows whose position the URL tracks.
  function refreshGutters() {
    gutters = Array.prototype.slice.call(
      list.querySelectorAll(".message-gutter"),
    );
    if (lastSyncedTs) {
      for (var i = 0; i < gutters.length; i++) {
        if (gutters[i].id === lastSyncedTs) {
          syncIdx = i;
          break;
        }
      }
    }
  }

  function anyPending() {
    for (var i in pending) return true;
    return false;
  }

  function chunkElement(data) {
    var el = document.createElement("div");
    el.className = "chunk";
    el.innerHTML = data.html;
    return el;
  }

  // Inserting older messages above the viewport shifts everything down; the
  // reader's place in the conversation must not move. overflow-anchor is off
  // on the list (style.css), so nothing else compensates for it. Nothing
  // moves when the insertion lands below the fold - the first load - and the
  // page must be left where it was.
  function insertOlder(el) {
    var anchor = olderSentinel.nextSibling;
    var rect = anchor.getBoundingClientRect();
    var aboveTheFold = rect.top < window.innerHeight;

    list.insertBefore(el, olderSentinel.nextSibling);

    if (aboveTheFold) {
      window.scrollBy(0, anchor.getBoundingClientRect().top - rect.top);
    }
  }

  function loadChunk(i, done) {
    if (i < 0 || i >= chunksTotal) {
      if (done) done(false);
      return;
    }

    if (loaded[i]) {
      // A caller may ask for a chunk that is already on screen: the answer is
      // immediate, and a callback that never fires is a scroll that never
      // happens.
      if (done) done(true);
      return;
    }

    if (!pending[i]) pending[i] = [];
    if (done) pending[i].push(done);
    if (pending[i].length > 1) return; // someone else is already fetching it

    list.classList.add("chunk-loading");

    fetch(channelId + "/chunk-" + i + ".json")
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        var dones = pending[i];
        delete pending[i];
        loaded[i] = true;
        var wasEmpty = minLoaded === Infinity;
        var isOlder = i < minLoaded;
        minLoaded = Math.min(minLoaded, i);
        maxLoaded = Math.max(maxLoaded, i);

        var el = chunkElement(data);
        if (wasEmpty || isOlder) insertOlder(el);
        else list.insertBefore(el, newerSentinel);

        refreshGutters();
        list.classList.toggle("chunk-loading", anyPending());

        for (var d = 0; d < dones.length; d++) dones[d](true);
      })
      .catch(function () {
        var dones = pending[i];
        delete pending[i];
        list.classList.toggle("chunk-loading", anyPending());

        // One broken file should not sink the conversation already on screen:
        // stop loading in that direction and say so, unless nothing loaded at
        // all, in which case there is no conversation to save.
        if (Object.keys(loaded).length === 0) {
          showFallback();
          for (var d = 0; d < dones.length; d++) dones[d](false);
          return;
        }

        if (i < minLoaded) brokenOlder = true;
        else brokenNewer = true;

        var note = document.createElement("p");
        note.className = "chunk-broken";
        note.textContent = "Some messages could not be loaded.";
        if (i < minLoaded) list.insertBefore(note, olderSentinel.nextSibling);
        else list.insertBefore(note, newerSentinel);

        for (var f = 0; f < dones.length; f++) dones[f](false);
      });
  }

  var observer = new IntersectionObserver(
    function (entries) {
      for (var e = 0; e < entries.length; e++) {
        if (!entries[e].isIntersecting) continue;

        if (entries[e].target === olderSentinel && !brokenOlder) {
          loadChunk(minLoaded - 1);
        } else if (entries[e].target === newerSentinel && !brokenNewer) {
          loadChunk(maxLoaded + 1);
        }
      }
    },
    { rootMargin: "3000px 0px" },
  );
  observer.observe(olderSentinel);
  observer.observe(newerSentinel);

  // The URL is the permalink. A hash on load, or on back/forward, becomes a
  // scroll. A thread reply is rendered inside its parent's chunk, and its own
  // timestamp can sit above that chunk's range - so a miss walks the chunks
  // above (the newer ones), where the parent lives.
  function scrollPermalink(ts) {
    function found() {
      return document.getElementById(ts);
    }

    if (found()) {
      found().scrollIntoView({ block: "center" });
      return;
    }

    var start = chunkFor(ts);
    if (start === null) return; // The archive does not hold this message.

    var tryAt = function (i) {
      if (i >= chunksTotal) return;
      loadChunk(i, function (ok) {
        if (found()) {
          found().scrollIntoView({ block: "center" });
        } else if (ok && i + 1 < chunksTotal) {
          tryAt(i + 1);
        }
      });
    };

    tryAt(start);
  }

  // The browser's own scroll restoration restores a pixel position, which is
  // the wrong idea in a list that grows: the hash is the position.
  if (history.scrollRestoration) history.scrollRestoration = "manual";

  window.addEventListener("popstate", function () {
    var ts = (location.hash || "").slice(1);
    if (ts) scrollPermalink(ts);
  });

  // The ten-year channel read with the hands on the keyboard: j and k step
  // through the conversation, g and G jump to the edges. The page scrolls,
  // not a box, so the jumps go to the document, not to a container.
  window.addEventListener("keydown", function (e) {
    var target = e.target;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }

    switch (e.key) {
      case "j":
        window.scrollBy({ top: 200, behavior: "smooth" });
        break;
      case "k":
        window.scrollBy({ top: -200, behavior: "smooth" });
        break;
      case "g":
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "G":
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth",
        });
        break;
    }
  });

  // Scrolling writes the message nearest the top of the viewport into the URL,
  // so a copied link reopens the reader where they left off. Throttled, and the
  // walk starts where it last stopped, because a scroll crosses a few messages,
  // not all of them.
  var lastUrlUpdate = 0;
  window.addEventListener(
    "scroll",
    function () {
      var now = Date.now();
      if (now - lastUrlUpdate < 300) return;
      lastUrlUpdate = now;

      if (gutters.length === 0) return;
      var line = window.innerHeight * 0.3;
      var i = Math.min(syncIdx, gutters.length - 1);

      while (
        i + 1 < gutters.length &&
        gutters[i + 1].getBoundingClientRect().top < line
      ) {
        i++;
      }
      while (i > 0 && gutters[i - 1].getBoundingClientRect().top > line) {
        i--;
      }
      syncIdx = i;

      var ts = gutters[i].id;
      if (ts && ts !== lastSyncedTs) {
        lastSyncedTs = ts;
        history.replaceState(null, "", "#" + ts);
      }
    },
    { passive: true },
  );

  // The opening move: a permalink lands on its message, a bare visit lands on
  // the newest one - the way the static pages always did.
  var initialTs = (location.hash || "").slice(1);
  var initialChunk = chunkFor(initialTs);

  if (initialTs && initialChunk === null) {
    // The archive does not hold it: read from the newest, as if no link came.
    initialTs = "";
  }

  loadChunk(initialChunk || 0, function () {
    if (initialTs) {
      // scrollPermalink, not a bare getElementById: a thread reply lives in
      // its parent's chunk, which may not be the one the timestamp's range
      // points at, and the walk finds it.
      scrollPermalink(initialTs);
    } else {
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
  });
})();
