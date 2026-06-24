/* Qwen OCR change-review viewer.
   Reads window.REVIEW_DATA (emitted by build_review.py) and renders an
   image + content-diff workbench. No build step / server required. */
(function () {
  "use strict";

  var DATA = (window.REVIEW_DATA || { docs: [] });
  var docs = DATA.docs;
  var view = docs.slice();      // current filtered/sorted order
  var current = null;           // current doc id

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return (s || "").replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  // Similarity 0..1 -> red→amber→green badge colour.
  function simColor(r) {
    var h = Math.max(0, Math.min(120, (r - 0.5) * 2 * 120)); // .5→0(red) 1→120(green)
    return "hsl(" + h + ",70%,62%)";
  }

  /* ----------------------------- sidebar ----------------------------- */
  function applyView() {
    var q = $("filter").value.trim().toLowerCase();
    var onlyChanged = $("onlyChanged").checked;
    var sort = $("sortSel").value;

    view = docs.filter(function (d) {
      if (onlyChanged && d.n_changes === 0) return false;
      if (q && d.id.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    view.sort(function (a, b) {
      if (sort === "name") return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      if (sort === "least") return b.ratio - a.ratio;
      return a.ratio - b.ratio; // changed: lowest similarity first
    });
    renderList();
  }

  function renderList() {
    var ul = $("doclist");
    ul.innerHTML = "";
    view.forEach(function (d) {
      var li = document.createElement("li");
      li.dataset.id = d.id;
      if (d.id === current) li.className = "active";

      var name = document.createElement("div");
      name.className = "name";
      name.textContent = shortName(d.id);
      name.title = d.id;

      var meta = document.createElement("div");
      meta.className = "meta";
      var sim = Math.round(d.ratio * 1000) / 10;
      var badge = '<span class="simbadge" style="background:' +
        simColor(d.ratio) + '">' + sim.toFixed(1) + "%</span>";
      var counts = d.n_changes === 0
        ? '<span>no changes</span>'
        : '<span class="cnt-add">+' + d.added + "</span>" +
          '<span class="cnt-del">-' + d.deleted + "</span>" +
          '<span>~' + d.sub_old + "</span>";
      meta.innerHTML = badge + counts;

      li.appendChild(name);
      li.appendChild(meta);
      li.addEventListener("click", function () { select(d.id); });
      ul.appendChild(li);
    });
  }

  // Trim the long repository prefix so list items stay readable.
  function shortName(id) {
    return id
      .replace(/^四部丛刊初编【[^】]*】/, "四部·")
      .replace(/^四部丛刊·/, "");
  }

  /* ----------------------------- selection ----------------------------- */
  function indexOfCurrent() {
    for (var i = 0; i < view.length; i++) if (view[i].id === current) return i;
    return -1;
  }

  function select(id) {
    var d = docs.find(function (x) { return x.id === id; });
    if (!d) return;
    current = id;

    // sidebar active state + scroll into view
    Array.prototype.forEach.call($("doclist").children, function (li) {
      var on = li.dataset.id === id;
      li.className = on ? "active" : "";
      if (on) li.scrollIntoView({ block: "nearest" });
    });

    $("docTitle").textContent = d.id;
    $("docTitle").title = d.id;

    var pos = indexOfCurrent();
    $("position").textContent = (pos + 1) + " / " + view.length;

    renderStats(d);
    renderImage(d);
    renderInline(d);
    renderChangeList(d);
    $("origText").textContent = d.original;
    $("modelText").textContent = d.model;
  }

  function renderStats(d) {
    var sim = (d.ratio * 100).toFixed(1);
    $("statbar").innerHTML =
      '<span class="pill">sim <b style="color:' + simColor(d.ratio) + '">' + sim + "%</b></span>" +
      '<span class="pill">orig <b>' + d.len_a + "</b></span>" +
      '<span class="pill add">added <b>+' + d.added + "</b></span>" +
      '<span class="pill del">removed <b>-' + d.deleted + "</b></span>" +
      '<span class="pill">subst <b>' + d.sub_old + "→" + d.sub_new + "</b></span>";
  }

  function renderImage(d) {
    var img = $("docImg");
    img.src = encodeURI(d.img);
    img.onerror = function () { img.alt = "⚠ could not load image: " + d.img; };
    $("openImg").href = encodeURI(d.img);
    applyZoom();
  }

  /* unified content diff from precomputed segments */
  function renderInline(d) {
    var html = d.segments.map(function (s) {
      if (s.t === "eq") return '<span class="eq">' + esc(s.a) + "</span>";
      if (s.t === "ins") return '<span class="ins">' + esc(s.b) + "</span>";
      if (s.t === "del") return '<span class="del">' + esc(s.a) + "</span>";
      // replace: show removed then added
      return '<span class="del">' + esc(s.a) + "</span>" +
             '<span class="ins">' + esc(s.b) + "</span>";
    }).join("");
    $("inlineDiff").innerHTML = html ||
      '<span class="empty">No content differences.</span>';
  }

  function ctxHtml(ctx) {
    // context strings mark the changed span with ⟨ ⟩
    return esc(ctx)
      .replace("⟨", '<mark>')
      .replace("⟩", "</mark>");
  }

  function renderChangeList(d) {
    var out = [];
    if (d.subs.length) {
      out.push("<h3>Substitutions (" + d.subs.length + ")</h3>");
      d.subs.forEach(function (s) {
        out.push('<div class="chg"><div class="lead">' +
          '<span class="old">' + '<code>' + esc(s[0]) + "</code></span> → " +
          '<span class="new"><code>' + esc(s[1]) + "</code></span></div>" +
          '<div class="ctx">' + ctxHtml(s[2]) + "</div></div>");
      });
    }
    if (d.adds.length) {
      out.push("<h3>Additions (" + d.adds.length + ")</h3>");
      d.adds.forEach(function (a) {
        out.push('<div class="chg"><div class="lead"><span class="sz">+' +
          a[0].length + '</span> <code>' + esc(a[0]) + "</code></div>" +
          '<div class="ctx">' + ctxHtml(a[1]) + "</div></div>");
      });
    }
    if (d.dels.length) {
      out.push("<h3>Deletions (" + d.dels.length + ")</h3>");
      d.dels.forEach(function (x) {
        out.push('<div class="chg"><div class="lead"><span class="sz">-' +
          x[0].length + '</span> <code>' + esc(x[0]) + "</code></div>" +
          '<div class="ctx">' + ctxHtml(x[1]) + "</div></div>");
      });
    }
    $("changeList").innerHTML = out.join("") ||
      '<div class="empty">The model made no changes to this transcription.</div>';
  }

  /* ----------------------------- zoom ----------------------------- */
  var zoomFit = false;
  function applyZoom() {
    var img = $("docImg");
    if (zoomFit) {
      img.style.width = "100%";
      img.style.maxWidth = "100%";
    } else {
      img.style.maxWidth = "none";
      img.style.width = $("zoom").value + "%";
    }
  }
  $("zoom").addEventListener("input", function () { zoomFit = false; applyZoom(); });
  $("zoomIn").addEventListener("click", function () {
    zoomFit = false; $("zoom").value = Math.min(400, +$("zoom").value + 20); applyZoom();
  });
  $("zoomOut").addEventListener("click", function () {
    zoomFit = false; $("zoom").value = Math.max(20, +$("zoom").value - 20); applyZoom();
  });
  $("zoomFit").addEventListener("click", function () { zoomFit = true; applyZoom(); });

  /* ----------------------------- tabs ----------------------------- */
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      document.querySelectorAll(".tabpane").forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      $("tab-" + t.dataset.tab).classList.add("active");
    });
  });

  /* ----------------------------- navigation ----------------------------- */
  function step(delta) {
    if (!view.length) return;
    var i = indexOfCurrent();
    i = i === -1 ? 0 : Math.max(0, Math.min(view.length - 1, i + delta));
    select(view[i].id);
  }
  $("prevBtn").addEventListener("click", function () { step(-1); });
  $("nextBtn").addEventListener("click", function () { step(1); });
  document.addEventListener("keydown", function (e) {
    if (/input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === "ArrowDown" || e.key === "j") { step(1); e.preventDefault(); }
    if (e.key === "ArrowUp" || e.key === "k") { step(-1); e.preventDefault(); }
  });

  /* ----------------------------- filters ----------------------------- */
  $("filter").addEventListener("input", applyView);
  $("sortSel").addEventListener("change", applyView);
  $("onlyChanged").addEventListener("change", applyView);

  /* ----------------------------- init ----------------------------- */
  applyView();
  if (view.length) select(view[0].id);
})();
