/* 조달관 나르미 — 코어 엔진 */
"use strict";

var Narumi = (function () {
  var SAVE_KEY = "narumi_save_v1";
  var TURN_MAX = 12;

  /* ── 저장 ── */
  function defaultSave() {
    return { codex: [], endings: [], ach: [], plays: 0, audio: true, best: null };
  }
  var save = defaultSave();
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      var p = JSON.parse(raw);
      if (p && typeof p === "object") {
        save.codex = Array.isArray(p.codex) ? p.codex : [];
        save.endings = Array.isArray(p.endings) ? p.endings : [];
        save.ach = Array.isArray(p.ach) ? p.ach : [];
        save.plays = p.plays | 0;
        save.audio = p.audio !== false;
        save.best = p.best || null;
      }
    }
  } catch (e) { save = defaultSave(); }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 시크릿 모드 등 */ }
  }

  /* ── RNG (?seed= QA 훅) ── */
  var rng = Math.random;
  try {
    var seedParam = new URLSearchParams(location.search).get("seed");
    if (seedParam !== null && seedParam !== "") {
      var s = (parseInt(seedParam, 10) >>> 0) || 1;
      rng = function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        var t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
  } catch (e) { /* file:// 등에서는 기본 RNG */ }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* ── DOM 헬퍼 ── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ── 상태 ── */
  var run = null;
  var busy = false;
  var cardMap = {};
  CARDS.forEach(function (c) { cardMap[c.id] = c; });

  /* ── 토스트 ── */
  function toast(msg, kind) {
    var layer = $("toast-layer");
    var t = el("div", "toast" + (kind ? " " + kind : ""), esc(msg));
    layer.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 350);
    }, 2400);
    while (layer.children.length > 3) layer.firstChild.remove();
  }

  /* ── 화면 전환 ── */
  function showScreen(id) {
    ["screen-title", "screen-game", "screen-end"].forEach(function (s) {
      $(s).classList.toggle("active", s === id);
    });
  }
  function openOverlay(id) { $(id).classList.add("open"); }
  function closeOverlay(id) { $(id).classList.remove("open"); }
  function anyOverlayOpen() {
    return ["overlay-codex", "overlay-ach", "overlay-help"].some(function (o) {
      return $(o).classList.contains("open");
    });
  }

  /* ── 게이지 UI ── */
  var disp = { b: 50, f: 50, i: 50, s: 50 };
  var tweenRaf = null;

  function buildGauges() {
    var row = $("gauges");
    row.innerHTML = "";
    GAUGES.forEach(function (g) {
      var cell = el("div", "gauge");
      cell.id = "gauge-" + g.key;
      cell.innerHTML =
        '<div class="gauge-top"><span class="gauge-icon">' + g.icon + '</span>' +
        '<span class="gauge-name">' + g.name + '</span>' +
        '<span class="gauge-val retro" id="gv-' + g.key + '">50</span></div>' +
        '<div class="gauge-bar"><div class="gauge-fill" id="gf-' + g.key +
        '" style="width:50%;background:' + g.color + '"></div></div>';
      row.appendChild(cell);
    });
  }

  function paintGauges() {
    GAUGES.forEach(function (g) {
      var v = Math.round(disp[g.key]);
      $("gv-" + g.key).textContent = v;
      $("gf-" + g.key).style.width = v + "%";
      var cell = $("gauge-" + g.key);
      cell.classList.toggle("danger", run && run.g[g.key] < 20);
    });
  }

  function tweenGauges(target, done) {
    if (tweenRaf) cancelAnimationFrame(tweenRaf);
    var from = { b: disp.b, f: disp.f, i: disp.i, s: disp.s };
    var t0 = performance.now(), dur = 520;
    function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      GAUGES.forEach(function (g) { disp[g.key] = from[g.key] + (target[g.key] - from[g.key]) * e; });
      paintGauges();
      if (k < 1) tweenRaf = requestAnimationFrame(step);
      else { tweenRaf = null; if (done) done(); }
    }
    tweenRaf = requestAnimationFrame(step);
  }

  function deltaPopups(fx) {
    GAUGES.forEach(function (g, idx) {
      var d = fx[idx];
      if (!d) return;
      var cell = $("gauge-" + g.key);
      var pop = el("span", "delta " + (d > 0 ? "up" : "down"), (d > 0 ? "+" : "") + d);
      cell.appendChild(pop);
      setTimeout(function () { pop.remove(); }, 1000);
    });
  }

  /* ── 월 배너 ── */
  function monthBanner(turn, cb) {
    var b = $("month-banner");
    b.innerHTML = '<span class="mb-month">' + MONTHS[turn - 1] + '</span>' +
      '<span class="mb-turn retro">TURN ' + String(turn).padStart(2, "0") + ' / 12</span>';
    b.classList.remove("play");
    void b.offsetWidth;
    b.classList.add("play");
    setTimeout(cb, 780);
  }

  /* ── 카드 렌더 ── */
  function artHtml(card) {
    var emoji = ART_EMOJI[card.art] || "📋";
    return '<div class="card-art" data-art="' + card.art + '">' +
      '<img src="assets/img/art/' + card.art + '.png" alt="" ' +
      'onerror="this.parentNode.classList.add(\'noimg\');this.remove();">' +
      '<span class="art-fallback">' + emoji + '</span></div>';
  }

  function renderCard(card) {
    var sp = SPEAKERS[card.sp];
    var c = $("card-cur");
    c.className = "card";
    c.style.transform = "";
    c.style.opacity = "";
    c.innerHTML =
      '<div class="card-speaker"><span class="sp-icon">' + sp.icon + '</span>' +
      '<span class="sp-meta"><b>' + sp.name + '</b><i>' + sp.role + '</i></span>' +
      (card.tag ? '<span class="sp-tag">정책</span>' : '') + '</div>' +
      artHtml(card) +
      '<p class="card-txt">' + esc(card.txt) + '</p>' +
      '<div class="hint hint-l">' + esc(card.L.t) + '</div>' +
      '<div class="hint hint-r">' + esc(card.R.t) + '</div>';
    $("btn-left").innerHTML = '<span class="arrow">←</span> ' + esc(card.L.t);
    $("btn-right").innerHTML = esc(card.R.t) + ' <span class="arrow">→</span>';
    c.classList.remove("enter");
    void c.offsetWidth;
    c.classList.add("enter");
  }

  /* ── 런 시작 ── */
  function buildSchedule() {
    var scens = shuffle(SCENARIOS).slice(0, 2);
    var pool = shuffle(CARDS.filter(function (c) { return !c.next && c.id.charAt(0) === "c"; })).slice(0, 4);
    var sched = [];
    function chain(startId) {
      var id = startId;
      while (id) { sched.push(id); id = cardMap[id].next || null; }
    }
    sched.push(pool[0].id);
    chain(scens[0].start);
    sched.push(pool[1].id);
    chain(scens[1].start);
    sched.push(pool[2].id, pool[3].id);
    return sched;
  }

  function startRun() {
    NAudio.unlock();
    save.plays++;
    persist();
    checkAch("a10", save.plays >= 3);
    run = {
      g: { b: 50, f: 50, i: 50, s: 50 },
      turn: 0,
      sched: buildSchedule(),
      crisis: false,
      picks: [],
      newCodex: [], newAch: []
    };
    disp = { b: 50, f: 50, i: 50, s: 50 };
    busy = false;
    buildGauges();
    paintGauges();
    $("advisor").classList.add("show");
    showScreen("screen-game");
    setBg("office");
    nextTurn(true);
  }

  function setBg(key) {
    var g = BG_GRADIENTS[key] || BG_GRADIENTS.office;
    $("screen-game").style.background = "linear-gradient(180deg," + g[0] + "," + g[1] + ")";
  }

  function nextTurn(first) {
    run.turn++;
    var card = cardMap[run.sched[run.turn - 1]];
    if (card.bg) setBg(card.bg);
    updatePips();
    monthBanner(run.turn, function () {
      renderCard(card);
      busy = false;
      if (first) $("advisor").classList.add("show");
    });
  }

  function updatePips() {
    var pips = $("turn-pips");
    pips.innerHTML = "";
    for (var i = 1; i <= TURN_MAX; i++) {
      var d = el("span", "pip" + (i < run.turn ? " done" : i === run.turn ? " now" : ""));
      pips.appendChild(d);
    }
    $("month-badge").textContent = MONTHS[run.turn - 1];
  }

  /* ── 선택 처리 ── */
  function commit(dir) {
    if (busy || !run || anyOverlayOpen()) return;
    var card = cardMap[run.sched[run.turn - 1]];
    if (!card) return;
    busy = true;
    $("advisor").classList.remove("show");
    var choice = dir < 0 ? card.L : card.R;
    run.picks.push({ id: card.id, dir: dir });

    NAudio.sfx("swipe");
    var c = $("card-cur");
    c.classList.add("fly");
    c.style.transform = "translateX(" + (dir < 0 ? -620 : 620) + "px) rotate(" + (dir < 0 ? -24 : 24) + "deg)";
    c.style.opacity = "0";

    setTimeout(function () {
      NAudio.sfx("pick");
      var fx = choice.fx;
      var before = { b: run.g.b, f: run.g.f, i: run.g.i, s: run.g.s };
      GAUGES.forEach(function (g, i) {
        run.g[g.key] = Math.max(0, Math.min(100, run.g[g.key] + fx[i]));
        if (run.g[g.key] < 20) run.crisis = true;
      });
      tweenGauges(run.g);
      deltaPopups(fx);
      toast(choice.fb, "fb");

      var bigHit = fx.some(function (v) { return v <= -10; });
      if (bigHit) {
        NAudio.sfx("warn");
        var gs = $("screen-game");
        gs.classList.remove("shake");
        void gs.offsetWidth;
        gs.classList.add("shake");
      }

      /* 도감 해금 */
      if (card.tag && save.codex.indexOf(card.tag) < 0) {
        save.codex.push(card.tag);
        run.newCodex.push(card.tag);
        var entry = CODEX.filter(function (x) { return x.id === card.tag; })[0];
        setTimeout(function () {
          NAudio.sfx("unlock");
          toast("📚 정책 도감 해금 — " + entry.name, "unlock");
        }, 700);
        checkAch("a7", save.codex.length >= CODEX.length);
      }
      /* 게이지 80 업적 */
      checkAch("a3", run.g.f >= 80);
      checkAch("a4", run.g.i >= 80);
      checkAch("a5", run.g.b >= 80);
      checkAch("a6", run.g.s >= 80);
      persist();

      /* 엔딩 판정 */
      var dead = null;
      GAUGES.forEach(function (g) {
        if (run.g[g.key] <= 0 && (!dead || run.g[g.key] < run.g[dead])) dead = g.key;
      });
      if (dead) {
        setTimeout(function () { showEnding("e_" + dead); }, 950);
        return;
      }
      if (run.turn >= TURN_MAX) {
        setTimeout(function () { showEnding(pickClearEnding()); }, 950);
        return;
      }
      setTimeout(function () { nextTurn(false); }, 950);
    }, 270);
  }

  function pickClearEnding() {
    var g = run.g;
    var vals = [g.b, g.f, g.i, g.s];
    var avg = (g.b + g.f + g.i + g.s) / 4;
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    if (avg >= 70 && min >= 50) return "e_hero";
    if (g.i === max && g.i >= 75) return "e_innov";
    if (g.f === max && g.f >= 75) return "e_fair";
    return "e_plain";
  }

  /* ── 업적 ── */
  function checkAch(id, cond) {
    if (!cond || save.ach.indexOf(id) >= 0) return;
    save.ach.push(id);
    if (run) run.newAch.push(id);
    persist();
    var a = ACHIEVEMENTS.filter(function (x) { return x.id === id; })[0];
    setTimeout(function () {
      NAudio.sfx("unlock");
      toast("🏅 업적 달성 — " + a.name, "unlock");
    }, 1200);
  }

  /* ── 엔딩 ── */
  var GRADE_RANK = { S: 4, A: 3, B: 2, D: 1 };

  function showEnding(id) {
    var e = ENDINGS[id];
    var isNew = save.endings.indexOf(id) < 0;
    if (isNew) save.endings.push(id);
    if (e.kind === "clear") {
      checkAch("a1", true);
      var g = run.g;
      checkAch("a2", g.b >= 50 && g.f >= 50 && g.i >= 50 && g.s >= 50);
      checkAch("a9", !run.crisis);
    }
    checkAch("a8", save.endings.length >= Object.keys(ENDINGS).length);
    if (!save.best || GRADE_RANK[e.grade] > GRADE_RANK[save.best.grade]) {
      save.best = { grade: e.grade, title: e.title };
    }
    persist();

    NAudio.sfx(e.kind === "clear" ? "fanfare" : "crisis");
    var box = $("end-box");
    var gaugesHtml = GAUGES.map(function (g) {
      return '<div class="end-g"><span>' + g.icon + ' ' + g.name + '</span>' +
        '<div class="end-bar"><div style="width:' + run.g[g.key] + '%;background:' + g.color + '"></div></div>' +
        '<b class="retro">' + run.g[g.key] + '</b></div>';
    }).join("");
    var unlockHtml = "";
    if (isNew) unlockHtml += '<span class="chip new">새 엔딩</span>';
    run.newCodex.forEach(function (cid) {
      var c = CODEX.filter(function (x) { return x.id === cid; })[0];
      unlockHtml += '<span class="chip">📚 ' + esc(c.name) + '</span>';
    });
    run.newAch.forEach(function (aid) {
      var a = ACHIEVEMENTS.filter(function (x) { return x.id === aid; })[0];
      unlockHtml += '<span class="chip">🏅 ' + esc(a.name) + '</span>';
    });
    box.innerHTML =
      '<div class="end-head ' + e.kind + '">' +
      '<span class="stamp retro grade-' + e.grade + '">' + e.grade + '</span>' +
      '<span class="end-kind">' + (e.kind === "clear" ? "12개월 완주" : "조기 엔딩 · 게이지 고갈") + '</span></div>' +
      '<h2 class="end-title">' + esc(e.title) + '</h2>' +
      '<p class="end-body">' + esc(e.body) + '</p>' +
      '<div class="end-msg"><b>조달 정책 메시지</b><p>' + esc(e.msg) + '</p></div>' +
      '<div class="end-gauges">' + gaugesHtml + '</div>' +
      (unlockHtml ? '<div class="end-chips">' + unlockHtml + '</div>' : '') +
      '<div class="end-btns">' +
      '<button class="btn primary" id="btn-again">다시 하기</button>' +
      '<button class="btn" id="btn-end-codex">정책 도감</button>' +
      '<button class="btn ghost" id="btn-end-title">타이틀로</button></div>';
    showScreen("screen-end");
    $("btn-again").onclick = function () { NAudio.sfx("click"); startRun(); };
    $("btn-end-codex").onclick = function () { NAudio.sfx("click"); renderCodex(); openOverlay("overlay-codex"); };
    $("btn-end-title").onclick = function () { NAudio.sfx("click"); goTitle(); };
    if (e.kind === "clear") confetti();
  }

  /* ── 컨페티 ── */
  function confetti() {
    var cv = $("confetti");
    cv.width = innerWidth; cv.height = innerHeight;
    var cx = cv.getContext("2d");
    var colors = ["#0047A0", "#CD2E3A", "#00A884", "#7C4DFF", "#FF7043", "#FFC53D"];
    var parts = [];
    for (var i = 0; i < 130; i++) {
      parts.push({
        x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        vy: 2 + Math.random() * 3, vx: -1 + Math.random() * 2,
        rot: Math.random() * Math.PI, vr: -0.1 + Math.random() * 0.2,
        color: colors[i % colors.length]
      });
    }
    var t0 = performance.now();
    function frame(now) {
      cx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        cx.save();
        cx.translate(p.x, p.y); cx.rotate(p.rot);
        cx.fillStyle = p.color;
        cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cx.restore();
      });
      if (now - t0 < 3200) requestAnimationFrame(frame);
      else cx.clearRect(0, 0, cv.width, cv.height);
    }
    requestAnimationFrame(frame);
  }

  /* ── 타이틀 ── */
  function goTitle() {
    showScreen("screen-title");
    $("stat-plays").textContent = save.plays;
    $("stat-codex").textContent = save.codex.length + "/" + CODEX.length;
    $("stat-ach").textContent = save.ach.length + "/" + ACHIEVEMENTS.length;
    $("stat-end").textContent = save.endings.length + "/" + Object.keys(ENDINGS).length;
    var best = $("best-record");
    if (save.best) {
      best.innerHTML = '최고 기록 <span class="retro grade-' + save.best.grade + '">' +
        save.best.grade + '</span> ' + esc(save.best.title);
      best.classList.add("show");
    } else best.classList.remove("show");
  }

  /* ── 도감 ── */
  function renderCodex() {
    $("codex-progress").textContent = save.codex.length + " / " + CODEX.length + " 해금";
    var grid = $("codex-grid");
    grid.innerHTML = "";
    CODEX.forEach(function (c) {
      var un = save.codex.indexOf(c.id) >= 0;
      var cell = el("button", "codex-cell" + (un ? "" : " locked"));
      cell.innerHTML = '<span class="cx-icon">' + (un ? c.icon : "❔") + '</span>' +
        '<span class="cx-name">' + (un ? esc(c.name) : "???") + '</span>';
      if (un) cell.onclick = function () { NAudio.sfx("click"); showCodexDetail(c); };
      grid.appendChild(cell);
    });
    $("codex-detail").classList.remove("show");
    $("codex-grid").classList.remove("hide");
    $("codex-head").classList.remove("hide");
  }

  function showCodexDetail(c) {
    $("codex-grid").classList.add("hide");
    $("codex-head").classList.add("hide");
    var d = $("codex-detail");
    d.innerHTML = '<button class="btn ghost small" id="cx-back">← 목록</button>' +
      '<div class="cx-d-icon">' + c.icon + '</div>' +
      '<h3>' + esc(c.name) + '</h3>' +
      '<p class="cx-desc">' + esc(c.desc) + '</p>' +
      '<div class="cx-tip">💡 ' + esc(c.tip) + '</div>';
    d.classList.add("show");
    $("cx-back").onclick = function () { NAudio.sfx("click"); renderCodex(); };
  }

  /* ── 업적 ── */
  function renderAch() {
    $("ach-progress").textContent = save.ach.length + " / " + ACHIEVEMENTS.length + " 달성";
    var list = $("ach-list");
    list.innerHTML = "";
    ACHIEVEMENTS.forEach(function (a) {
      var un = save.ach.indexOf(a.id) >= 0;
      var row = el("div", "ach-row" + (un ? "" : " locked"));
      row.innerHTML = '<span class="ach-icon">' + (un ? a.icon : "🔒") + '</span>' +
        '<span class="ach-meta"><b>' + esc(a.name) + '</b><i>' + esc(a.desc) + '</i></span>' +
        (un ? '<span class="ach-done retro">DONE</span>' : '');
      list.appendChild(row);
    });
  }

  /* ── 드래그 입력 ── */
  function setupDrag() {
    var c = $("card-cur");
    var dragging = false, startX = 0, dx = 0, lastX = 0, lastT = 0, vx = 0;

    c.addEventListener("pointerdown", function (ev) {
      if (busy || anyOverlayOpen()) return;
      dragging = true; startX = ev.clientX; dx = 0; vx = 0;
      lastX = ev.clientX; lastT = performance.now();
      c.classList.add("dragging");
      c.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    c.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      dx = ev.clientX - startX;
      var now = performance.now();
      var dt = now - lastT;
      if (dt > 0) vx = (ev.clientX - lastX) / dt;
      lastX = ev.clientX; lastT = now;
      var rot = Math.max(-18, Math.min(18, dx / 12));
      c.style.transform = "translateX(" + dx + "px) rotate(" + rot + "deg)";
      var hl = c.querySelector(".hint-l"), hr = c.querySelector(".hint-r");
      if (hl) hl.style.opacity = Math.max(0, Math.min(1, -dx / 90));
      if (hr) hr.style.opacity = Math.max(0, Math.min(1, dx / 90));
    });
    function release() {
      if (!dragging) return;
      dragging = false;
      c.classList.remove("dragging");
      var fling = Math.abs(vx) > 0.55 && Math.abs(dx) > 28;
      if (Math.abs(dx) > 90 || fling) {
        commit(dx < 0 ? -1 : 1);
      } else {
        c.style.transform = "";
        var hl = c.querySelector(".hint-l"), hr = c.querySelector(".hint-r");
        if (hl) hl.style.opacity = "";
        if (hr) hr.style.opacity = "";
      }
    }
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", release);
  }

  /* ── 초기화 ── */
  function init() {
    NAudio.preload();
    NAudio.setEnabled(save.audio);
    updateAudioBtn();
    buildGauges();
    setupDrag();

    $("btn-start").onclick = function () { NAudio.sfx("click"); startRun(); };
    $("btn-title-codex").onclick = function () { NAudio.unlock(); NAudio.sfx("click"); renderCodex(); openOverlay("overlay-codex"); };
    $("btn-title-ach").onclick = function () { NAudio.unlock(); NAudio.sfx("click"); renderAch(); openOverlay("overlay-ach"); };
    $("btn-title-help").onclick = function () { NAudio.unlock(); NAudio.sfx("click"); openOverlay("overlay-help"); };
    $("btn-left").onclick = function () { commit(-1); };
    $("btn-right").onclick = function () { commit(1); };
    $("btn-game-home").onclick = function () {
      NAudio.sfx("click");
      if (confirm("진행 중인 플레이를 끝내고 타이틀로 돌아갈까요?")) goTitle();
    };

    ["overlay-codex", "overlay-ach", "overlay-help"].forEach(function (o) {
      $(o).addEventListener("click", function (ev) {
        if (ev.target === $(o) || ev.target.classList.contains("ov-close")) {
          NAudio.sfx("click"); closeOverlay(o);
        }
      });
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        ["overlay-codex", "overlay-ach", "overlay-help"].forEach(closeOverlay);
        return;
      }
      if (anyOverlayOpen()) return;
      if ($("screen-game").classList.contains("active")) {
        if (ev.key === "ArrowLeft") commit(-1);
        if (ev.key === "ArrowRight") commit(1);
      } else if ($("screen-title").classList.contains("active") && ev.key === "Enter") {
        startRun();
      } else if ($("screen-end").classList.contains("active") && ev.key === "Enter") {
        startRun();
      }
    });

    var audioBtns = [$("btn-audio-title"), $("btn-audio-game")];
    audioBtns.forEach(function (b) {
      if (!b) return;
      b.onclick = function () {
        save.audio = !save.audio;
        persist();
        NAudio.setEnabled(save.audio);
        if (save.audio) NAudio.unlock();
        updateAudioBtn();
        NAudio.sfx("click");
      };
    });

    goTitle();
  }

  function updateAudioBtn() {
    var icon = save.audio ? "🔊" : "🔇";
    ["btn-audio-title", "btn-audio-game"].forEach(function (id) {
      var b = $(id);
      if (b) b.textContent = icon;
    });
  }

  /* QA 훅 */
  window.NARUMI_DEBUG = {
    get state() { return { run: run, save: save, busy: busy }; },
    start: startRun,
    commit: commit,
    setGauges: function (b, f, i, s) {
      if (!run) return;
      run.g = { b: b, f: f, i: i, s: s };
      tweenGauges(run.g);
    },
    ending: showEnding,
    save: function () { return save; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { start: startRun, commit: commit };
})();