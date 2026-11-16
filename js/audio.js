/* 조달관 나르미 — 오디오 (생성 에셋 우선, WebAudio 신스 폴백) */
"use strict";

var NAudio = (function () {
  var ctx = null, master = null, bgmGain = null;
  var enabled = true, started = false;
  var files = {}, ready = {};
  var bgmTimer = null, bgmStep = 0;

  var SFX_FILES = {
    click: "assets/audio/sfx_click.mp3",
    swipe: "assets/audio/sfx_swipe.mp3",
    pick: "assets/audio/sfx_pick.mp3",
    warn: "assets/audio/sfx_warn.mp3",
    crisis: "assets/audio/sfx_crisis.mp3",
    fanfare: "assets/audio/sfx_fanfare.mp3",
    unlock: "assets/audio/sfx_unlock.mp3"
  };

  function ensureCtx() {
    if (ctx) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.16;
      bgmGain.connect(master);
    } catch (e) { return false; }
    return true;
  }

  function preload() {
    Object.keys(SFX_FILES).forEach(function (k) {
      try {
        var a = new Audio(SFX_FILES[k]);
        a.preload = "auto";
        a.addEventListener("canplaythrough", function () { ready[k] = true; }, { once: true });
        a.addEventListener("error", function () { ready[k] = false; }, { once: true });
        files[k] = a;
      } catch (e) { /* 폴백 사용 */ }
    });
    try {
      var b = new Audio("assets/audio/bgm.mp3");
      b.loop = true; b.preload = "auto";
      b.addEventListener("canplaythrough", function () { ready.bgm = true; }, { once: true });
      b.addEventListener("error", function () { ready.bgm = false; }, { once: true });
      files.bgm = b;
    } catch (e) { /* 폴백 사용 */ }
  }

  /* ── 신스 폴백 ── */
  function tone(freq, dur, type, vol, when, dest) {
    if (!ctx) return;
    var t = (when || 0) + ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noiseSweep(dur, vol, from, to) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = "bandpass";
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    var g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  var synth = {
    click: function () { tone(880, 0.06, "square", 0.08); },
    swipe: function () { noiseSweep(0.16, 0.18, 600, 2400); },
    pick: function () { tone(523, 0.09, "triangle", 0.16); tone(784, 0.12, "triangle", 0.14, 0.07); },
    warn: function () { tone(196, 0.22, "sawtooth", 0.12); tone(185, 0.22, "sawtooth", 0.1, 0.18); },
    crisis: function () { tone(330, 0.16, "sawtooth", 0.14); tone(262, 0.16, "sawtooth", 0.14, 0.14); tone(196, 0.4, "sawtooth", 0.16, 0.28); },
    fanfare: function () {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.18, "triangle", 0.16, i * 0.11); });
      tone(1319, 0.5, "triangle", 0.14, 0.46);
    },
    unlock: function () { tone(1047, 0.08, "sine", 0.12); tone(1568, 0.16, "sine", 0.12, 0.07); }
  };

  /* ── 생성 BGM 폴백: 부드러운 코드 루프 ── */
  var CHORDS = [
    [220.0, 261.63, 329.63],   /* Am */
    [174.61, 220.0, 261.63],   /* F  */
    [196.0, 246.94, 293.66],   /* G  */
    [164.81, 196.0, 246.94]    /* Em */
  ];
  var MELODY = [440, 523.25, 587.33, 523.25, 440, 392, 440, 523.25,
                587.33, 659.25, 587.33, 523.25, 440, 392, 329.63, 392];

  function bgmTick() {
    if (!enabled || !ctx) return;
    var chord = CHORDS[Math.floor(bgmStep / 4) % CHORDS.length];
    chord.forEach(function (f) { tone(f, 1.7, "triangle", 0.05, 0, bgmGain); });
    var m = MELODY[bgmStep % MELODY.length];
    if (bgmStep % 2 === 0) tone(m, 0.5, "sine", 0.06, 0.1, bgmGain);
    bgmStep++;
  }

  function startBgm() {
    if (!enabled) return;
    if (ready.bgm && files.bgm) {
      try { files.bgm.volume = 0.35; files.bgm.play().catch(function () {}); return; } catch (e) {}
    }
    if (!ensureCtx()) return;
    if (bgmTimer) return;
    bgmStep = 0;
    bgmTick();
    bgmTimer = setInterval(bgmTick, 1800);
  }

  function stopBgm() {
    if (files.bgm) { try { files.bgm.pause(); } catch (e) {} }
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  return {
    preload: preload,
    setEnabled: function (on) {
      enabled = on;
      if (!on) stopBgm();
      else if (started) startBgm();
    },
    isEnabled: function () { return enabled; },
    /* 첫 사용자 제스처에서 호출 */
    unlock: function () {
      started = true;
      if (ensureCtx() && ctx.state === "suspended") { ctx.resume().catch(function () {}); }
      if (enabled) startBgm();
    },
    sfx: function (name) {
      if (!enabled) return;
      if (ready[name] && files[name]) {
        try {
          var a = files[name].cloneNode();
          a.volume = 0.6;
          a.play().catch(function () {});
          return;
        } catch (e) {}
      }
      if (!ensureCtx()) return;
      if (ctx.state === "suspended") ctx.resume().catch(function () {});
      if (synth[name]) synth[name]();
    },
    stopBgm: stopBgm
  };
})();