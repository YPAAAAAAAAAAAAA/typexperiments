(function () {
  "use strict";

  var PHRASE = "BEND EACH LINE THEN LET THEM FALL HOME";
  var WORDS = PHRASE.split(" ");
  var LETTERS = [];
  var wi, ci;
  for (wi = 0; wi < WORDS.length; wi++) {
    for (ci = 0; ci < WORDS[wi].length; ci++) LETTERS.push(WORDS[wi].charAt(ci));
  }

  var FONT_STACK = 'Georgia, "Liberation Serif", "Nimbus Roman", "Noto Serif", "Times New Roman", serif';

  var canvas = document.getElementById("canvas");
  var toggle = document.getElementById("fx-toggle");
  var dock = document.getElementById("dock");
  var ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
  if (!ctx) return;
  var buttons = dock.querySelectorAll("button[data-mode]");

  var glyphs = [];
  var lineBuckets = [];
  var widthAt100 = null;
  var mode = "wave";
  var modeT = 0;
  var fontPx = 32;
  var W = 0;
  var H = 0;
  var dpr = 1;
  var placed = false;
  var readySent = false;
  var lastCssW = 0;
  var lastCssH = 0;
  var lastDpr = 0;
  var pointer = null;
  var activeId = null;
  var downX = 0;
  var downY = 0;
  var lava = { x: 0, y: 0, heat: 0 };
  var caret = null;

  var HEAT = [];
  var hi;
  for (hi = 0; hi <= 24; hi++) {
    var t = hi / 24;
    var r = (246 + (255 - 246) * t) | 0;
    var gch = (243 + (214 - 243) * t) | 0;
    var b = (236 + (186 - 236) * t) | 0;
    HEAT.push("rgb(" + r + "," + gch + "," + b + ")");
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function ease(u) {
    u = clamp(u, 0, 1);
    return u * u * (3 - 2 * u);
  }

  function elasticOut(u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    var c = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * c) + 1;
  }

  function unit(i, salt) {
    var x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function heatColor(h) {
    var i = (clamp(h, 0, 1) * 24) | 0;
    return HEAT[i];
  }

  function primeWidths() {
    if (widthAt100) return;
    widthAt100 = {};
    ctx.font = "700 100px " + FONT_STACK;
    var i, ch;
    for (i = 0; i < LETTERS.length; i++) {
      ch = LETTERS[i];
      if (widthAt100[ch] == null) widthAt100[ch] = ctx.measureText(ch).width;
    }
  }

  function adv(ch, px, precise) {
    var track = px * 0.04;
    if (precise) return ctx.measureText(ch).width + track;
    return widthAt100[ch] * (px / 100) + track;
  }

  function layout(px, maxWidth, topPad, usableH, precise) {
    if (precise) ctx.font = "700 " + px + "px " + FONT_STACK;
    var track = px * 0.04;
    var space = px * 0.32;
    var wordW = new Array(WORDS.length);
    var longest = 0;
    var i, s, w, c;
    for (i = 0; i < WORDS.length; i++) {
      s = 0;
      w = WORDS[i];
      for (c = 0; c < w.length; c++) s += adv(w.charAt(c), px, precise);
      wordW[i] = s;
      if (s > longest) longest = s;
    }
    var lines = [];
    var cur = [];
    var curW = 0;
    for (i = 0; i < WORDS.length; i++) {
      if (cur.length && curW + space + wordW[i] > maxWidth) {
        lines.push({ words: cur, width: curW });
        cur = [i];
        curW = wordW[i];
      } else {
        if (cur.length) curW += space;
        cur.push(i);
        curW += wordW[i];
      }
    }
    if (cur.length) lines.push({ words: cur, width: curW });

    var lh = px * 1.32;
    var blockH = lines.length * lh;
    var y0 = topPad + Math.max(0, (usableH - blockH) * 0.5) + lh * 0.5;
    var pos = new Array(LETTERS.length);
    var gi = 0;
    var maxRun = 0;
    var li, k, line, x, y, word, cw;
    for (li = 0; li < lines.length; li++) {
      line = lines[li];
      if (line.words.length > maxRun) maxRun = line.words.length;
      x = (W - line.width) * 0.5;
      y = y0 + li * lh;
      for (k = 0; k < line.words.length; k++) {
        if (k) x += space;
        word = WORDS[line.words[k]];
        for (c = 0; c < word.length; c++) {
          cw = adv(word.charAt(c), px, precise);
          pos[gi++] = { x: x + cw * 0.5, y: y, line: li };
          x += cw;
        }
      }
    }
    while (gi < LETTERS.length) pos[gi++] = { x: W * 0.5, y: H * 0.5, line: 0 };
    return { pos: pos, lineCount: lines.length, blockH: blockH, longest: longest, maxRun: maxRun };
  }

  function ensureGlyphs() {
    var i, g;
    if (glyphs.length === LETTERS.length) return;
    glyphs.length = 0;
    for (i = 0; i < LETTERS.length; i++) {
      g = {
        ch: LETTERS[i],
        i: i,
        ax: 0, ay: 0, aline: 0,
        bx: 0, by: 0, bline: 0,
        x: 0, y: 0, vx: 0, vy: 0,
        rot: 0, scale: 1, alpha: 1, heat: 0
      };
      glyphs.push(g);
    }
  }

  function fitType() {
    var topPad = 54;
    var bottomPad = 34;
    var usableH = Math.max(48, H - topPad - bottomPad);
    var wideW = Math.max(48, W - 28);
    var narrowW = Math.max(48, wideW * 0.46);
    primeWidths();
    var cap = Math.floor(Math.min(92, wideW * 0.34, usableH * 0.22));
    if (cap < 18) cap = 18;
    var morphPick = null;
    var fitPick = null;
    var px, wide, narrow, fits, morphs;
    for (px = cap; px >= 16; px -= 2) {
      wide = layout(px, wideW, topPad, usableH, false);
      narrow = layout(px, narrowW, topPad, usableH, false);
      fits = wide.blockH <= usableH + 0.5 && narrow.blockH <= usableH + 0.5 &&
        wide.longest <= wideW + 0.5 && narrow.longest <= narrowW + 0.5;
      if (!fits) continue;
      if (!fitPick) fitPick = { px: px, wide: wide, narrow: narrow };
      morphs = wide.maxRun >= 2 && narrow.lineCount >= wide.lineCount + 2;
      if (morphs) {
        morphPick = { px: px, wide: wide, narrow: narrow };
        break;
      }
    }
    var pick = morphPick || fitPick;
    if (!pick) pick = { px: 16 };
    fontPx = pick.px;
    var wideFinal = layout(fontPx, wideW, topPad, usableH, true);
    var narrowFinal = layout(fontPx, narrowW, topPad, usableH, true);
    var guard = 0;
    while (guard < 3 && fontPx > 16 && (
      wideFinal.blockH > usableH + 1 || narrowFinal.blockH > usableH + 1 ||
      wideFinal.longest > wideW + 1 || narrowFinal.longest > narrowW + 1
    )) {
      fontPx -= 1;
      guard += 1;
      wideFinal = layout(fontPx, wideW, topPad, usableH, true);
      narrowFinal = layout(fontPx, narrowW, topPad, usableH, true);
    }
    pick = { px: fontPx, wide: wideFinal, narrow: narrowFinal };
    ensureGlyphs();
    var home = pick.narrow.lineCount >= pick.wide.lineCount ? pick.narrow : pick.wide;
    var away = home === pick.narrow ? pick.wide : pick.narrow;
    var i, g, a, b, dx, dy;
    for (i = 0; i < glyphs.length; i++) {
      g = glyphs[i];
      a = away.pos[i];
      b = home.pos[i];
      dx = b.x - g.bx;
      dy = b.y - g.by;
      if (placed && mode === "lava") {
        g.x += dx;
        g.y += dy;
      }
      g.ax = a.x;
      g.ay = a.y;
      g.aline = a.line;
      g.bx = b.x;
      g.by = b.y;
      g.bline = b.line;
    }
    placed = true;
  }

  function measure() {
    var cssW = canvas.clientWidth | 0;
    var cssH = canvas.clientHeight | 0;
    var next = Math.min(2, window.devicePixelRatio || 1);
    if (cssW < 2 || cssH < 2) return;
    if (cssW === lastCssW && cssH === lastCssH && next === lastDpr) return;
    lastCssW = cssW;
    lastCssH = cssH;
    lastDpr = next;
    dpr = next;
    W = cssW;
    H = cssH;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    fitType();
    if (!lava.x && !lava.y) {
      lava.x = W * 0.5;
      lava.y = H * 0.46;
    }
  }

  function poseWave() {
    var i, g, wob;
    for (i = 0; i < glyphs.length; i++) {
      g = glyphs[i];
      wob = Math.sin(modeT * 2.45 + g.i * 0.48 + 1.15);
      g.x = g.bx + Math.cos(modeT * 1.25 + g.i * 0.48) * fontPx * 0.03;
      g.y = g.by + wob * fontPx * 0.15;
      g.rot = wob * 0.14;
      g.scale = 1 + wob * 0.04;
      g.alpha = 1;
      g.heat = Math.max(0, wob) * 0.4;
    }
    caret = null;
  }

  function poseMorph() {
    var period = 3.8;
    var ph = (modeT % period) / period;
    var p;
    if (ph < 0.38) p = ease(ph / 0.38);
    else if (ph < 0.5) p = 1;
    else if (ph < 0.88) p = 1 - ease((ph - 0.5) / 0.38);
    else p = 0;
    var n = glyphs.length;
    var i, g, delay, u, arc;
    for (i = 0; i < n; i++) {
      g = glyphs[i];
      delay = n <= 1 ? 0 : (g.i / (n - 1)) * 0.18;
      u = ease(clamp((p - delay) / 0.82, 0, 1));
      g.x = g.bx + (g.ax - g.bx) * u;
      g.y = g.by + (g.ay - g.by) * u;
      arc = Math.sin(u * Math.PI);
      g.rot = arc * 0.2 * (g.i % 2 ? 1 : -1);
      g.scale = 1 + arc * 0.05;
      g.alpha = 1;
      g.heat = arc * 0.55;
    }
    caret = null;
  }

  function poseExplode() {
    var span = 2.65;
    var t = (modeT % span) / span;
    var burst = Math.sin(t * Math.PI);
    var i, g, ang, dist;
    var reach = Math.min(W, H) * 0.38;
    for (i = 0; i < glyphs.length; i++) {
      g = glyphs[i];
      ang = unit(g.i, 1) * Math.PI * 2;
      dist = (fontPx * 0.7 + unit(g.i, 2) * reach) * burst;
      g.x = g.bx + Math.cos(ang) * dist;
      g.y = g.by + Math.sin(ang) * dist * 0.8 - burst * fontPx * 0.5;
      g.rot = (unit(g.i, 3) - 0.5) * burst * 3.1;
      g.scale = 1 - burst * 0.22;
      g.alpha = 1 - burst * burst * 0.4;
      g.heat = burst;
    }
    caret = null;
  }

  function posePour() {
    var per = 0.1;
    var flight = 0.7;
    var lastLine = 0;
    var i, g, start, u, e;
    for (i = 0; i < glyphs.length; i++) {
      if (glyphs[i].bline > lastLine) lastLine = glyphs[i].bline;
    }
    var cycle = lastLine * per + flight + 1.05;
    for (i = 0; i < glyphs.length; i++) {
      g = glyphs[i];
      start = g.bline * per + (g.i % 3) * 0.02;
      u = clamp((modeT - start) / flight, 0, 1);
      e = elasticOut(u);
      g.x = g.bx;
      g.y = g.by - (1 - e) * (fontPx * 2.1 + g.bline * fontPx * 0.12);
      g.alpha = Math.min(1, u * 1.4);
      g.scale = 0.84 + 0.16 * e;
      g.rot = (1 - Math.min(1, u)) * 0.18;
      g.heat = (1 - Math.min(1, Math.max(0, e))) * 0.45;
    }
    if (modeT > cycle) modeT = 0;
    caret = null;
  }

  function poseType() {
    var per = 0.048;
    var n = glyphs.length;
    var shown = modeT / per;
    var cycle = n * per + 1.3;
    var fade = modeT > cycle - 0.32 ? Math.max(0, (cycle - modeT) / 0.32) : 1;
    var i, g, local, e;
    caret = null;
    for (i = 0; i < n; i++) {
      g = glyphs[i];
      local = shown - g.i;
      g.x = g.bx;
      g.rot = 0;
      if (local <= 0) {
        g.alpha = 0;
        g.y = g.by + fontPx * 0.22;
        g.scale = 0.9;
        g.heat = 0;
      } else if (local < 1) {
        e = ease(local);
        g.alpha = e * fade;
        g.y = g.by + (1 - e) * fontPx * 0.32;
        g.scale = 0.86 + 0.14 * e;
        g.rot = (1 - e) * 0.22;
        g.heat = (1 - e) * 0.6;
      } else {
        g.alpha = fade;
        g.y = g.by;
        g.scale = 1;
        g.heat = 0;
      }
    }
    if (shown < n && fade > 0.85 && ((modeT * 7) | 0) % 2 === 0) {
      g = glyphs[Math.min(n - 1, Math.floor(shown))];
      caret = { x: g.bx + fontPx * 0.36, y: g.by };
    }
    if (modeT > cycle) modeT = 0;
  }

  function poseVortex() {
    var n = glyphs.length;
    var flight = 0.92;
    var stagger = 0.014;
    var outEnd = flight + Math.max(0, n - 1) * stagger;
    var holdEnd = outEnd + 1.05;
    var backEnd = holdEnd + 0.5;
    var cx = W * 0.5;
    var cy = H * 0.46;
    var back = modeT > holdEnd ? ease(clamp((modeT - holdEnd) / 0.5, 0, 1)) : 0;
    var i, g, start, u, spin, swirl, x, y;
    for (i = 0; i < n; i++) {
      g = glyphs[i];
      if (back > 0) {
        u = 1 - back;
      } else {
        start = g.i * stagger;
        u = ease(clamp((modeT - start) / flight, 0, 1));
      }
      spin = (1 - u) * (Math.PI * 2.5 + g.i * 0.09);
      swirl = (1 - u) * fontPx * 1.7;
      x = cx + (g.bx - cx) * u;
      y = cy + (g.by - cy) * u;
      g.x = x + Math.cos(spin) * swirl;
      g.y = y + Math.sin(spin) * swirl;
      g.rot = (1 - u) * 1.35 * (g.i % 2 ? 1 : -1);
      g.scale = 0.22 + 0.78 * u;
      g.alpha = Math.min(1, u * 1.7);
      g.heat = 1 - u;
    }
    if (modeT > backEnd) modeT = 0;
    caret = null;
  }

  function poseLava(dt, now) {
    var follow = pointer;
    var k;
    if (follow) {
      k = 1 - Math.exp(-16 * dt);
      lava.x += (follow.x - lava.x) * k;
      lava.y += (follow.y - lava.y) * k;
      lava.heat += (1 - lava.heat) * (1 - Math.exp(-10 * dt));
    } else {
      lava.heat += (0.7 - lava.heat) * (1 - Math.exp(-2.4 * dt));
      lava.x = W * 0.5 + Math.sin(now * 0.62) * W * 0.26;
      lava.y = H * 0.46 + Math.cos(now * 0.47) * H * 0.14;
    }
    var R = Math.max(78, fontPx * 3.5);
    var R2 = R * R;
    var i, g, ax, ay, dx, dy, d2, d, push, heat, sp, cap;
    for (i = 0; i < glyphs.length; i++) {
      g = glyphs[i];
      ax = (g.bx - g.x) * 46;
      ay = (g.by - g.y) * 46;
      dx = g.x - lava.x;
      dy = g.y - lava.y;
      d2 = dx * dx + dy * dy;
      heat = 0;
      if (d2 < R2 && d2 > 0.8) {
        d = Math.sqrt(d2);
        push = (1 - d / R) * (1 - d / R) * 5600 * lava.heat;
        ax += (dx / d) * push;
        ay += (dy / d) * push * 0.9;
        heat = (1 - d / R) * lava.heat;
        g.rot = clamp((dx / d) * heat * 0.85, -0.95, 0.95);
      } else {
        g.rot += (0 - g.rot) * Math.min(1, dt * 6);
      }
      g.vx = (g.vx + ax * dt) * Math.exp(-6.2 * dt);
      g.vy = (g.vy + ay * dt) * Math.exp(-6.2 * dt);
      sp = Math.hypot(g.vx, g.vy);
      cap = 1700;
      if (sp > cap) {
        g.vx = (g.vx / sp) * cap;
        g.vy = (g.vy / sp) * cap;
      }
      g.x = clamp(g.x + g.vx * dt, -W * 0.25, W * 1.25);
      g.y = clamp(g.y + g.vy * dt, -H * 0.25, H * 1.25);
      g.scale = 1 + heat * 0.16;
      g.alpha = 1;
      g.heat = heat;
    }
    caret = null;
  }

  function tick(dt, now) {
    modeT += dt;
    if (mode === "wave") poseWave();
    else if (mode === "morph") poseMorph();
    else if (mode === "explode") poseExplode();
    else if (mode === "pour") posePour();
    else if (mode === "type") poseType();
    else if (mode === "vortex") poseVortex();
    else if (mode === "lava") poseLava(dt, now);
  }

  function strokeRibbons() {
    if (mode === "morph" || mode === "explode" || mode === "vortex" || mode === "pour") return;
    var i, g, b, arr, p, dx, dy, limit;
    for (i = 0; i < lineBuckets.length; i++) lineBuckets[i].length = 0;
    for (i = 0; i < glyphs.length; i++) {
      g = glyphs[i];
      if (g.alpha < 0.45) continue;
      while (lineBuckets.length <= g.bline) lineBuckets.push([]);
      lineBuckets[g.bline].push(g);
    }
    ctx.lineWidth = Math.max(1.25, fontPx * 0.045);
    ctx.strokeStyle = "rgba(255, 93, 58, 0.5)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    limit = fontPx * fontPx * 3.2;
    for (i = 0; i < lineBuckets.length; i++) {
      arr = lineBuckets[i];
      if (!arr || arr.length < 2) continue;
      arr.sort(function (a, c) { return a.x - c.x; });
      ctx.beginPath();
      ctx.moveTo(arr[0].x, arr[0].y + fontPx * 0.28);
      for (b = 1; b < arr.length; b++) {
        g = arr[b];
        p = arr[b - 1];
        dx = g.x - p.x;
        dy = g.y - p.y;
        if (dx * dx + dy * dy > limit) ctx.moveTo(g.x, g.y + fontPx * 0.28);
        else ctx.lineTo(g.x, g.y + fontPx * 0.28);
      }
      ctx.stroke();
    }
  }

  function paintLava() {
    if (mode !== "lava") return;
    var rad = Math.max(86, fontPx * 3.8);
    var grd = ctx.createRadialGradient(lava.x, lava.y, fontPx * 0.1, lava.x, lava.y, rad);
    var hot = lava.heat;
    grd.addColorStop(0, "rgba(255, 214, 150, " + (0.95 * hot) + ")");
    grd.addColorStop(0.22, "rgba(255, 90, 30, " + (0.72 * hot) + ")");
    grd.addColorStop(0.55, "rgba(180, 30, 12, " + (0.28 * hot) + ")");
    grd.addColorStop(1, "rgba(255, 60, 20, 0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(lava.x, lava.y, rad, 0, Math.PI * 2);
    ctx.fill();
    var s, a, sx, sy;
    for (s = 0; s < 4; s++) {
      a = modeT * 2.2 + s * 1.6;
      sx = lava.x + Math.cos(a) * rad * (0.28 + s * 0.08);
      sy = lava.y + Math.sin(a * 1.25) * rad * (0.16 + s * 0.04);
      ctx.fillStyle = "rgba(255, 196, 120, " + (0.35 * hot) + ")";
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2, fontPx * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W * 0.5, H * 0.4, fontPx * 0.4, W * 0.5, H * 0.46, Math.max(W, H) * 0.68);
    glow.addColorStop(0, "rgba(255, 112, 64, 0.18)");
    glow.addColorStop(0.42, "rgba(36, 58, 120, 0.12)");
    glow.addColorStop(1, "rgba(11, 16, 32, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    paintLava();
    strokeRibbons();

    ctx.font = "700 " + fontPx + "px " + FONT_STACK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var i, g, drop;
    drop = Math.max(1, fontPx * 0.04);
    for (i = 0; i < glyphs.length; i++) {
      g = glyphs[i];
      if (g.alpha < 0.02) continue;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.rot);
      ctx.scale(g.scale, g.scale);
      ctx.globalAlpha = g.alpha * (0.22 + g.heat * 0.55);
      ctx.fillStyle = "#ff5d3a";
      ctx.fillText(g.ch, 0, drop);
      ctx.globalAlpha = g.alpha;
      ctx.fillStyle = heatColor(g.heat);
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
    }

    if (caret && mode === "type") {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#ff5d3a";
      var chh = fontPx * 0.72;
      ctx.fillRect(caret.x, caret.y - chh * 0.5, Math.max(2, fontPx * 0.07), chh);
      ctx.globalAlpha = 1;
    }
  }

  function markReady() {
    if (readySent) return;
    if (window.__gbSandbox && typeof window.__gbSandbox.ready === "function") {
      readySent = true;
      window.__gbSandbox.ready();
    }
  }

  function frame(now) {
    var dt = lastStamp ? Math.min(0.05, (now - lastStamp) / 1000) : 0.016;
    lastStamp = now;
    measure();
    if (W >= 2 && H >= 2 && glyphs.length) {
      tick(dt, now / 1000);
      paint();
      markReady();
    }
    requestAnimationFrame(frame);
  }

  var lastStamp = 0;

  function showMode(name) {
    mode = name;
    modeT = 0;
    var i, b, g;
    for (i = 0; i < buttons.length; i++) {
      b = buttons[i];
      var on = b.getAttribute("data-mode") === name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (name === "lava") {
      pointer = null;
      lava.heat = 0.65;
      lava.x = W * 0.5;
      lava.y = H * 0.46;
      for (i = 0; i < glyphs.length; i++) {
        g = glyphs[i];
        g.x = g.bx;
        g.y = g.by;
        g.vx = 0;
        g.vy = 0;
      }
    }
  }

  function halt(e) {
    e.stopPropagation();
  }

  var blockEv = ["pointerdown", "pointerup", "pointermove", "touchstart", "touchend", "mousedown", "mouseup", "click", "wheel"];
  var bi;
  for (bi = 0; bi < blockEv.length; bi++) {
    toggle.addEventListener(blockEv[bi], halt);
    dock.addEventListener(blockEv[bi], halt);
  }

  toggle.addEventListener("click", function (e) {
    e.stopPropagation();
    var on = document.documentElement.classList.toggle("gb-ui-open");
    toggle.setAttribute("aria-expanded", on ? "true" : "false");
    toggle.textContent = on ? "\u00d7" : "Aa";
  });

  for (bi = 0; bi < buttons.length; bi++) {
    buttons[bi].addEventListener("click", function (e) {
      e.stopPropagation();
      showMode(e.currentTarget.getAttribute("data-mode"));
    });
  }

  function localPoint(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (activeId !== null) return;
    if (e.cancelable) e.preventDefault();
    activeId = e.pointerId;
    downX = e.clientX;
    downY = e.clientY;
    pointer = localPoint(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }, { passive: false });

  canvas.addEventListener("pointermove", function (e) {
    if (e.pointerId !== activeId) return;
    pointer = localPoint(e);
  });

  function endPointer(e) {
    if (e.pointerId !== activeId) return;
    var dx = e.clientX - downX;
    var dy = e.clientY - downY;
    var moved = dx * dx + dy * dy > 144;
    if (!moved && mode !== "wave" && mode !== "lava") modeT = 0;
    pointer = null;
    activeId = null;
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  // Measure from the frame only. Setting canvas.width clears the bitmap, so a
  // resize observer must not run between that write and the next paint.
  measure();
  if (W >= 2 && glyphs.length) {
    tick(0.016, 0.4);
    paint();
    markReady();
  }
  requestAnimationFrame(frame);
})();
