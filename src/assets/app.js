// 画面の振る舞い：配色切替・コードのコピー・目次追従・進捗バー・検索と絞り込み
// DOM は createElement で組む。検索インデックス由来の文字列を innerHTML に渡さない。
(function () {
  "use strict";

  var doc = document.documentElement;

  /* ---------- 配色 ---------- */

  var toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var current = doc.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      var next = current === "dark" ? "light" : "dark";
      doc.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) { /* 保存できなくても切替は効く */ }
    });
  }

  /* ---------- PWA ---------- */

  // file:// では Service Worker を使えないので http(s) のときだけ登録する
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(document.body.dataset.root + "sw.js").catch(function () { /* 登録失敗は閲覧に影響しない */ });
    });
  }

  /* ---------- "/" で検索へ ---------- */

  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    var input = document.getElementById("q") || document.getElementById("nav-q");
    if (input) { e.preventDefault(); input.focus(); }
  });

  /* ---------- コードのコピー ---------- */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    // file:// など clipboard API が使えない環境向け
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".code-copy");
    if (!btn) return;
    var code = btn.closest(".code-block").querySelector("code");
    var lines = Array.prototype.map.call(code.querySelectorAll(".line"), function (l) { return l.textContent; });
    copyText(lines.join("\n")).then(
      function () { flash(btn, "コピーしました", true); },
      function () { flash(btn, "コピーできません", false); }
    );
  });

  function flash(btn, label, ok) {
    btn.textContent = label;
    btn.classList.toggle("done", ok);
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = "コピー"; btn.classList.remove("done"); }, 1600);
  }

  /* ---------- 進捗バーと目次追従 ---------- */

  var bar = document.querySelector(".progress span");
  var prose = document.querySelector(".prose");
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a[data-id]"));
  var heads = tocLinks.map(function (a) { return document.getElementById(a.dataset.id); }).filter(Boolean);

  function onScroll() {
    if (bar && prose) {
      var rect = prose.getBoundingClientRect();
      var total = rect.height - window.innerHeight;
      var p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
      bar.style.width = (p * 100).toFixed(2) + "%";
    }
    if (heads.length) {
      var line = 120;
      var current = heads[0];
      for (var i = 0; i < heads.length; i++) {
        if (heads[i].getBoundingClientRect().top <= line) current = heads[i];
        else break;
      }
      tocLinks.forEach(function (a) { a.classList.toggle("active", a.dataset.id === current.id); });
    }
  }
  if (bar || heads.length) {
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { onScroll(); ticking = false; });
    }, { passive: true });
    onScroll();
  }

  // 狭い画面では目次を最初は閉じておく
  var tocDetails = document.querySelector(".toc details");
  if (tocDetails && window.matchMedia("(max-width: 1080px)").matches) tocDetails.open = false;

  /* ---------- 検索と絞り込み（トップ） ---------- */

  var input = document.getElementById("q");
  var list = document.querySelector("[data-list] .entries");
  if (!input || !list || !window.SEARCH_INDEX) return;

  var status = document.querySelector("[data-status]");
  var countEl = document.querySelector("[data-count]");
  var entries = Array.prototype.slice.call(list.querySelectorAll(".entry"));
  var bySlug = {};
  entries.forEach(function (el) {
    bySlug[el.dataset.slug] = el;
    var a = el.querySelector("h3 a");
    a.dataset.plain = a.textContent;
    var desc = el.querySelector(".entry-body > p");
    if (desc) desc.dataset.plain = desc.textContent;
  });
  var index = window.SEARCH_INDEX.map(function (x) {
    return {
      s: x.s, t: x.t, d: x.d, b: x.b, c: x.c, l: x.l,
      tl: x.t.toLowerCase(), dl: x.d.toLowerCase(), gl: x.g.join(" ").toLowerCase(),
      cl: x.c.toLowerCase(), bl: x.b.toLowerCase()
    };
  });

  var filter = { cat: "", level: "" };

  function count(hay, needle) {
    var n = 0, i = hay.indexOf(needle);
    while (i !== -1 && n < 20) { n++; i = hay.indexOf(needle, i + needle.length); }
    return n;
  }

  function score(item, terms) {
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var s = (item.tl.indexOf(t) !== -1 ? 12 : 0) + (item.gl.indexOf(t) !== -1 ? 8 : 0) +
        (item.cl.indexOf(t) !== -1 ? 4 : 0) + (item.dl.indexOf(t) !== -1 ? 4 : 0) + Math.min(count(item.bl, t), 10);
      if (!s) return 0; // すべての語を含むものだけ残す
      total += s;
    }
    return total;
  }

  /** 文字列中の検索語を <mark> で包んだノード列を el に入れる */
  function fillMarked(el, text, terms) {
    while (el.firstChild) el.removeChild(el.firstChild);
    var lower = text.toLowerCase();
    var pos = 0;
    while (pos < text.length) {
      var best = -1, len = 0;
      for (var i = 0; i < terms.length; i++) {
        var at = lower.indexOf(terms[i], pos);
        if (at !== -1 && (best === -1 || at < best)) { best = at; len = terms[i].length; }
      }
      if (best === -1) { el.appendChild(document.createTextNode(text.slice(pos))); break; }
      if (best > pos) el.appendChild(document.createTextNode(text.slice(pos, best)));
      var m = document.createElement("mark");
      m.textContent = text.slice(best, best + len);
      el.appendChild(m);
      pos = best + len;
    }
  }

  function snippet(item, terms) {
    var at = -1;
    for (var i = 0; i < terms.length && at === -1; i++) at = item.bl.indexOf(terms[i]);
    if (at === -1) return "";
    var start = Math.max(0, at - 40);
    return (start > 0 ? "…" : "") + item.b.slice(start, at + 80) + "…";
  }

  function apply() {
    var q = input.value.trim().toLowerCase();
    var terms = q ? q.split(/\s+/) : [];
    var shown = 0;
    var ranked = [];

    index.forEach(function (item) {
      var el = bySlug[item.s];
      if (!el) return;
      var okCat = !filter.cat || item.c === filter.cat;
      var okLevel = !filter.level || item.l.indexOf(filter.level) !== -1;
      var sc = terms.length ? score(item, terms) : 1;
      var visible = okCat && okLevel && sc > 0;
      el.hidden = !visible;

      var a = el.querySelector("h3 a");
      var desc = el.querySelector(".entry-body > p[data-plain]");
      var old = el.querySelector(".snippet");
      if (old) old.parentNode.removeChild(old);
      if (terms.length && visible) {
        fillMarked(a, a.dataset.plain, terms);
        if (desc) fillMarked(desc, desc.dataset.plain, terms);
        var text = snippet(item, terms);
        if (text) {
          var p = document.createElement("p");
          p.className = "snippet";
          fillMarked(p, text, terms);
          el.querySelector(".entry-meta").before(p);
        }
      } else {
        a.textContent = a.dataset.plain;
        if (desc) desc.textContent = desc.dataset.plain;
      }
      if (visible) { shown++; ranked.push({ el: el, sc: sc, order: entries.indexOf(el) }); }
    });

    // 検索中はスコア順、そうでなければ新しい順
    ranked.sort(function (x, y) { return terms.length ? y.sc - x.sc || x.order - y.order : x.order - y.order; });
    ranked.forEach(function (r) { list.appendChild(r.el); });

    if (countEl) countEl.textContent = shown + "本";
    if (status) {
      // role="status" の領域は消さずに中身だけ替える（hidden にすると読み上げられないことがある）
      var active = terms.length || filter.cat || filter.level;
      status.textContent = !active ? "" : shown
        ? (terms.length ? "「" + input.value.trim() + "」を含む記事 " + shown + "本" : shown + "本に絞り込み中")
        : "該当する記事がありません。語を減らすか、絞り込みを「すべて」に戻してください。";
    }
  }

  document.querySelectorAll(".chip-row").forEach(function (row) {
    row.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      row.querySelectorAll(".chip").forEach(function (c) {
        c.classList.toggle("on", c === chip);
        c.setAttribute("aria-pressed", String(c === chip));
      });
      filter[row.dataset.filter] = chip.dataset.value;
      apply();
    });
  });

  var timer;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      apply();
      // 検索語を URL に残す（戻る・共有用）。file:// では replaceState が失敗することがある
      try {
        var url = new URL(location.href);
        if (input.value.trim()) url.searchParams.set("q", input.value.trim());
        else url.searchParams.delete("q");
        history.replaceState(null, "", url);
      } catch (e) { /* 無視 */ }
    }, 120);
  });

  var initial = new URLSearchParams(location.search).get("q");
  if (initial) {
    input.value = initial;
    apply();
    document.getElementById("articles").scrollIntoView();
  }
})();
