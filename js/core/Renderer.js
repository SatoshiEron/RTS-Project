export default class Renderer {
  constructor(canvas, game, camera) {
    this.inputHandler = null;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.camera = camera;
    this.selectionManager = null;
    this.bgImage = null;
    this.bgLoaded = false;
    this.paused = false;

    // ===== ЗОНЫ КОНТРОЛЯ =====
    this.fogMode = 0;
    this.fogCityRadius = 0.12;
    this.fogUnitRadius = 0.15;

    this.animTime = 0;
    this.fogMovementStretch = 3.0;
    this.fogMovementForwardBias = 0.35;

    // ===== ТЕРРИТОРИЯ (distance field) =====
    this.territoryR = 0.12;
    this.territorySoftK = 0.03;
    this.territoryNoiseAmp = 0.15;
    this.territoryContestedW = 0.012;
    this.territoryFieldRes = 120;
    this.territoryMaskLand = true;
    this.territoryColors = { player: [50, 150, 255], ai: [255, 80, 80] };

    this.territoryLayer = document.createElement("canvas");
    this.territoryLayer.width = 256;
    this.territoryLayer.height = 256;
    this.territoryCtx = this.territoryLayer.getContext("2d");
    this.territoryDirty = true;
    this._territorySig = null;

    // ИЗМЕНЕНО: throttle + кэш маски суши
    this.territoryMinInterval = 1000;
    this._territoryLastBuild = -Infinity;
    this._territoryLastSigCheck = 0;
    this._territoryLandMask = null;
    this._territoryMaskKey = "";

    // ИЗМЕНЕНО: нейтральная зона вокруг городов без владельца
    this.territoryNeutralR = 0.09;
    this.territoryNeutralStrength = 1.2;

    this.citySprites = {};        // type -> Image
    this.citySpritesLoaded = false;
    this._citySpritesLoading = null;

    // ===== ФЛАГИ ГОРОДОВ =====
    this.cityFlags = new Map();
    this.flagAnimMs = 800;

    // ===== МОСТЫ =====
    // WeakMap: road -> Set<segIndex>, где сегмент пересекает воду.
    this._bridgeCache = new WeakMap();
    this._bridgeCacheDirty = true;

    // ===== АНИМАЦИЯ ДОРОГ =====
    this.roadAnim = {
      enabled: true,
      minLen: 0.04,
      road: {
        color: [255, 160, 50],
        speed: 0.045,
        spacing: 0.18,
        min: 1, max: 3,
        glow: 14,
        alpha: 0.85,
        bidirectional: true
      },
      rail: {
        color: [255, 245, 190],
        speed: 0.085,
        spacing: 0.10,
        min: 2, max: 4,
        glow: 18,
        alpha: 1.0,
        bidirectional: false,
        dashSpeed: 30
      }
    };
    this._roadGeomCache = new WeakMap();
    this._glowSprites = new Map();
    this._tmpPt = { x: 0, y: 0 };
  }

  invalidateBridges() {
    this._bridgeCacheDirty = true;
  }

  showPauseOverlay(paused) {
    this.paused = paused;
  }

  setSelectionManager(manager) {
    this.selectionManager = manager;
  }

  setInputHandler(handler) {
    this.inputHandler = handler;
  }

  setBackgroundImage(img) {
    this.bgImage = img;
    this.bgLoaded = !!img;
  }

  loadCitySprites(basePath = 'assets/icons/') {
    const types = ['city', 'port', 'airfield', 'farm', 'mine', 'factory', 'trade'];
    let loaded = 0;

    this._citySpritesLoading = new Promise((resolve) => {
      for (const type of types) {
        const img = new Image();
        img.onload = () => {
          loaded++;
          if (loaded === types.length) {
            this.citySpritesLoaded = true;
            resolve();
          }
        };
        img.onerror = () => {
          console.warn(`⚠️ Спрайт не загружен: ${type}.png`);
          loaded++;
          if (loaded === types.length) {
            this.citySpritesLoaded = true;
            resolve();
          }
        };
        img.src = `${basePath}${type}.png`;
        this.citySprites[type] = img;
      }
    });

    return this._citySpritesLoading;
  }

  // ============================================================
  // ТЕРРИТОРИЯ
  // ============================================================

  markTerritoryDirty() {
    this.territoryDirty = true;
  }

  _ownerSignature() {
    let h = 0;
    for (const c of this.game.cities || []) h = (h * 31 + c.owner + 1) | 0;
    return h;
  }

  // ИЗМЕНЕНО: маска суши кэшируется (считается один раз).
  _getTerritoryLandMask(TW, TH) {
    const key = TW + "x" + TH;
    if (this._territoryLandMask && this._territoryMaskKey === key) {
      return this._territoryLandMask;
    }

    const g = this.game;
    const mask = new Uint8Array(TW * TH);

    for (let py = 0; py < TH; py++) {
      const wy = (py + 0.5) / TH;
      for (let px = 0; px < TW; px++) {
        mask[py * TW + px] = g.isWalkable((px + 0.5) / TW, wy) ? 1 : 0;
      }
    }

    this._territoryLandMask = mask;
    this._territoryMaskKey = key;
    return mask;
  }

  rebuildTerritoryLayer() {
    const t0 = performance.now();
    const g = this.game;
    const ctx = this.territoryCtx;
    const TW = this.territoryLayer.width;
    const TH = this.territoryLayer.height;

    ctx.clearRect(0, 0, TW, TH);
    this.territoryDirty = false;
    this._territoryLastBuild = t0;
    this._territorySig = this._ownerSignature();

    const P = [], A = [], Neu = [];
    for (const c of g.cities || []) {
      if (c.owner === g.playerId) P.push(c);
      else if (c.owner === g.aiId) A.push(c);
      else Neu.push(c);  // ИЗМЕНЕНО: нейтралы — в отдельный список
    }
    if (!P.length && !A.length) return;

    const N = this.territoryFieldRes;
    const R = this.territoryR;
    const K = this.territorySoftK;
    const amp = this.territoryNoiseAmp;
    const Wc = this.territoryContestedW;

    // ---------- Этап 1: поля reach и s на грубой сетке ----------
    const reachF = new Float32Array(N * N);
    const sF = new Float32Array(N * N);

    for (let gy = 0; gy < N; gy++) {
      const wy = (gy + 0.5) / N;

      for (let gx = 0; gx < N; gx++) {
        const wx = (gx + 0.5) / N;

        let sumP = 0, nPd = Infinity, nP = null;
        for (let i = 0; i < P.length; i++) {
          const c = P[i];
          const dx = wx - c.x, dy = wy - c.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          sumP += Math.exp(-d / K);
          if (d < nPd) { nPd = d; nP = c; }
        }

        let sumA = 0, nAd = Infinity, nA = null;
        for (let i = 0; i < A.length; i++) {
          const c = A[i];
          const dx = wx - c.x, dy = wy - c.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          sumA += Math.exp(-d / K);
          if (d < nAd) { nAd = d; nA = c; }
        }

        const dP = sumP > 0 ? -K * Math.log(sumP) : Infinity;
        const dA = sumA > 0 ? -K * Math.log(sumA) : Infinity;
        const d = Math.min(dP, dA);

        const nf = amp > 0
          ? 1 + amp * (Math.sin(wx * 47.3 + wy * 31.7) * 0.5 + Math.sin(wx * 13.1 - wy * 57.3) * 0.5)
          : 1;

        // ИЗМЕНЕНО: штраф от ближайшего нейтрала.
        let neutralPenalty = 0;
        if (Neu.length > 0) {
          let dN = Infinity;
          for (let i = 0; i < Neu.length; i++) {
            const c = Neu[i];
            const dx = wx - c.x, dy = wy - c.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < dN) dN = dist;
          }
          const nr = this.territoryNeutralR;
          if (dN < nr) {
            neutralPenalty = (nr - dN) * this.territoryNeutralStrength;
          }
        }

        // Эффективное расстояние = расстояние фракции + штраф от нейтрала.
        const dEff = d + neutralPenalty;

        let s;
        if (nP && nA) {
          const ex = nA.x - nP.x, ey = nA.y - nP.y;
          const distPA = Math.sqrt(ex * ex + ey * ey);
          s = distPA < 1e-6 ? 0 : (nAd * nAd - nPd * nPd) / (2 * distPA);
          s = Math.max(-1, Math.min(1, s));
        } else {
          s = nP ? 1 : -1;
        }

        const idx = gy * N + gx;
        reachF[idx] = R - dEff * nf;   // ← dEff вместо d
        sF[idx] = s;
      }
    }

    // ---------- Этап 2: рендер слоя ----------
    const sm = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    const ix0 = new Int16Array(TW);
    const ix1 = new Int16Array(TW);
    const itx = new Float32Array(TW);
    for (let px = 0; px < TW; px++) {
      const fx = Math.max(0, Math.min(N - 1, ((px + 0.5) / TW) * N - 0.5));
      const x0 = Math.floor(fx);
      ix0[px] = x0;
      ix1[px] = Math.min(N - 1, x0 + 1);
      itx[px] = fx - x0;
    }

    const PC = this.territoryColors.player;
    const AC = this.territoryColors.ai;
    const landMask = this.territoryMaskLand ? this._getTerritoryLandMask(TW, TH) : null;
    const hatchPeriod = Math.max(2, Math.round(12 * TW / 512));
    const hatchHalf = hatchPeriod / 2;

    const img = ctx.createImageData(TW, TH);
    const data = img.data;

    for (let py = 0; py < TH; py++) {
      const fy = Math.max(0, Math.min(N - 1, ((py + 0.5) / TH) * N - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(N - 1, y0 + 1);
      const ty = fy - y0;
      const r0 = y0 * N, r1 = y1 * N;

      for (let px = 0; px < TW; px++) {
        const x0 = ix0[px], x1 = ix1[px], tx = itx[px];
        const a = r0 + x0, b = r0 + x1, c = r1 + x0, d = r1 + x1;

        const reach =
          (reachF[a] * (1 - tx) + reachF[b] * tx) * (1 - ty) +
          (reachF[c] * (1 - tx) + reachF[d] * tx) * ty;

        if (reach <= 0) continue;

        const edge = sm(0, 0.004, reach);
        if (edge <= 0) continue;
        if (landMask && !landMask[py * TW + px]) continue;

        const s =
          (sF[a] * (1 - tx) + sF[b] * tx) * (1 - ty) +
          (sF[c] * (1 - tx) + sF[d] * tx) * ty;

        const cw = 1 - sm(Wc * 0.8, Wc * 1.2, Math.abs(s));

        const sideC = s > 0 ? PC : AC;
        const hatchC = ((px + py) % hatchPeriod) < hatchHalf ? PC : AC;

        const rim = 1 - sm(0, 0.02, reach);
        const dark = 1 - 0.35 * rim;

        const alpha = Math.min(1, edge * (0.34 + 0.40 * rim) * (1 + 0.3 * cw));

        const o = (py * TW + px) * 4;
        data[o]     = (sideC[0] + (hatchC[0] - sideC[0]) * cw) * dark;
        data[o + 1] = (sideC[1] + (hatchC[1] - sideC[1]) * cw) * dark;
        data[o + 2] = (sideC[2] + (hatchC[2] - sideC[2]) * cw) * dark;
        data[o + 3] = Math.round(alpha * 255);
      }
    }

    ctx.putImageData(img, 0, 0);

    console.log(`🗺️ Территория пересобрана за ${(performance.now() - t0).toFixed(0)}мс`);
  }

  drawTerritory() {
    if (this.fogMode === 2 || !this.game.cities) return;

    const now = performance.now();

    // Страховка: сверка sig раз в секунду
    if (now - this._territoryLastSigCheck >= 1000) {
      this._territoryLastSigCheck = now;
      const sig = this._ownerSignature();
      if (sig !== this._territorySig) {
        this._territorySig = sig;
        this.territoryDirty = true;
      }
    }

    // Throttle: пересборка не чаще territoryMinInterval
    if (this.territoryDirty && now - this._territoryLastBuild >= this.territoryMinInterval) {
      this.rebuildTerritoryLayer();
    }

    // Каждый кадр — только drawImage из кэша
    const tl = this.worldToScreen(0, 0);
    const br = this.worldToScreen(1, 1);

    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.territoryLayer, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.restore();
  }

  worldToScreen(wx, wy) {
    return this.camera.worldToScreen(wx, wy);
  }

  render() {
    const ctx = this.ctx;

    this.animTime = performance.now();

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // ===== ФОН =====
    if (this.bgLoaded && this.bgImage) {
      const topLeft = this.camera.worldToScreen(0, 0);
      const bottomRight = this.camera.worldToScreen(1, 1);

      const x = topLeft.x;
      const y = topLeft.y;
      const w = bottomRight.x - topLeft.x;
      const h = bottomRight.y - topLeft.y;

      ctx.save();
      ctx.drawImage(this.bgImage, x, y, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#0a0d14";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    const map = this.game.map;

    if (!map) return;

    // ===== ТЕРРИТОРИЯ =====
    this.drawTerritory();

    this.drawProvinces(map.provinces || []);

    const roads = (map.roads || []).filter(
      (r) => r.type === "road" || r.type === undefined
    );

    const rails = (map.roads || []).filter(
      (r) => r.type === "rail"
    );

    this.drawRoads(roads, "#666666", 2, null, "road");
    this.drawRoads(rails, "#ffcc00", 3, [6, 4], "rail");

    this.drawFrontline();

    this.drawPoints(map.points || []);

    // ===== ФЛАГИ ГОРОДОВ =====
    this.drawCityFlags();

    for (const city of this.game.cities || []) {
      this.drawCity(city);
    }

    for (const unit of this.game.units || []) {
      this.drawUnit(unit);
    }

    this.drawUnitTarget();

    this.drawCombatEffects();

    // ===== РАМКА ВЫДЕЛЕНИЯ =====
    if (this.selectionManager) {
      const rect = this.selectionManager.getSelectionRect();

      if (rect) {
        const p1 = this.worldToScreen(rect.x1, rect.y1);
        const p2 = this.worldToScreen(rect.x2, rect.y2);

        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);

        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);

        ctx.save();

        ctx.strokeStyle = "rgba(74, 158, 255, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);

        ctx.fillStyle = "rgba(74, 158, 255, 0.08)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // ===== ПАУЗА =====
    if (this.paused) {
      ctx.save();

      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      ctx.fillStyle = "#ffffff";
      ctx.font = "48px Segoe UI";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillText("⏸ ПАУЗА", this.canvas.width / 2, this.canvas.height / 2 - 20);

      ctx.font = "18px Segoe UI";
      ctx.fillStyle = "#aaaaaa";

      ctx.fillText("Нажмите ESC, чтобы продолжить", this.canvas.width / 2, this.canvas.height / 2 + 40);

      ctx.restore();
    }
    this.drawHoverCandidate();
    this.drawSelection();
  }

  // ============================================================
  // МОСТЫ
  // ============================================================

  _isBridgeSegment(road, i) {
    const a = road.points[i];
    const b = road.points[i + 1];
    if (!a || !b) return false;
    // Переиспользуем детект воды из GameState.
    return this.game._lineCrossesWater(a.x, a.y, b.x, b.y, 10);
  }

  _getBridgeSegments(road) {
    let cache = this._bridgeCache.get(road);

    if (this._bridgeCacheDirty || !cache) {
      if (!cache) {
        cache = new Set();
        this._bridgeCache.set(road, cache);
      }
      cache.clear();
      for (let i = 0; i < road.points.length - 1; i++) {
        if (this._isBridgeSegment(road, i)) cache.add(i);
      }
    }

    return cache;
  }

  drawBridgeSegment(a, b, width, style = "wood") {
    const ctx = this.ctx;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    // Параметры стиля.
    const cfg = style === "rail"
      ? { sleeper: "#2a2a2a", rail: "#6a6a6a", shadow: "rgba(0,0,0,0.40)", step: 8, halfW: width + 2.0 }
      : { sleeper: "#5a3a1a", rail: "#8a6a3a", shadow: "rgba(0,0,0,0.35)", step: 5, halfW: width + 1.5 };

    const halfW = cfg.halfW;

    ctx.save();
    ctx.lineCap = "butt";

    // 1. Тень под мостом.
    ctx.strokeStyle = cfg.shadow;
    ctx.lineWidth = halfW * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // 2. Перила (две параллельные).
    ctx.strokeStyle = cfg.rail;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * halfW, a.y + ny * halfW);
    ctx.lineTo(b.x + nx * halfW, b.y + ny * halfW);
    ctx.moveTo(a.x - nx * halfW, a.y - ny * halfW);
    ctx.lineTo(b.x - nx * halfW, b.y - ny * halfW);
    ctx.stroke();

    // 3. Шпалы.
    ctx.strokeStyle = cfg.sleeper;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = cfg.step; t < len; t += cfg.step) {
      const px = a.x + ux * t;
      const py = a.y + uy * t;
      ctx.moveTo(px + nx * halfW, py + ny * halfW);
      ctx.lineTo(px - nx * halfW, py - ny * halfW);
    }
    ctx.stroke();

    ctx.restore();
  }

  // ============================================================
  // АНИМАЦИЯ ДОРОГ (караваны по road, поток по rail)
  // ============================================================

  // Сброс кэша геометрии. Нужен, только если road.points меняется «на месте».
  // При замене массива points кэш инвалидируется сам (см. _getRoadGeom).
  invalidateRoadGeometry() {
    this._roadGeomCache = new WeakMap();
    this._bridgeCacheDirty = true;
  }

  _polylineLength(points) {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return len;
  }

  _pointAtDistance(points, dist, cum = null, out = null) {
    const res = out || { x: 0, y: 0 };
    const n = points.length;

    if (n === 0) { res.x = 0; res.y = 0; return res; }
    if (n === 1 || !(dist > 0)) { res.x = points[0].x; res.y = points[0].y; return res; }

    let a = null, b = null, segStart = 0, segLen = 0;

    if (cum) {
      if (dist >= cum[n - 1]) { res.x = points[n - 1].x; res.y = points[n - 1].y; return res; }
      let lo = 0, hi = n - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cum[mid] <= dist) lo = mid; else hi = mid - 1;
      }
      a = points[lo]; b = points[lo + 1];
      segStart = cum[lo]; segLen = cum[lo + 1] - cum[lo];
    } else {
      let acc = 0;
      for (let i = 0; i < n - 1; i++) {
        const l = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
        if (acc + l >= dist) { a = points[i]; b = points[i + 1]; segStart = acc; segLen = l; break; }
        acc += l;
      }
      if (!a) { res.x = points[n - 1].x; res.y = points[n - 1].y; return res; }
    }

    const t = segLen > 1e-12 ? (dist - segStart) / segLen : 0;
    res.x = a.x + (b.x - a.x) * t;
    res.y = a.y + (b.y - a.y) * t;
    return res;
  }

  _getRoadGeom(road) {
    const pts = road.points;
    let g = this._roadGeomCache.get(road);
    if (g && g.pts === pts && g.n === pts.length) return g;

    const n = pts.length;
    const cum = new Float64Array(n);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const id = Number.isFinite(road.id) ? road.id : 0;
    const seed = (Math.imul(id + 1, 2654435761) >>> 0) / 4294967296;

    g = { pts, n, cum, len: n ? cum[n - 1] : 0, minX, minY, maxX, maxY, seed };
    this._roadGeomCache.set(road, g);
    return g;
  }

  _getGlowSprite(rgb) {
    const key = rgb.join(",");
    let sp = this._glowSprites.get(key);
    if (sp) return sp;

    const S = 32, c = S / 2;
    sp = document.createElement("canvas");
    sp.width = S;
    sp.height = S;
    const g = sp.getContext("2d");
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.00, "rgba(255,255,255,1)");
    grad.addColorStop(0.18, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`);
    grad.addColorStop(0.45, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.30)`);
    grad.addColorStop(1.00, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);

    this._glowSprites.set(key, sp);
    return sp;
  }

  _getViewWorldRect(margin = 0.02) {
    const a = this.camera.screenToWorld(0, 0);
    const b = this.camera.screenToWorld(this.canvas.width, this.canvas.height);
    return {
      x0: Math.min(a.x, b.x) - margin, y0: Math.min(a.y, b.y) - margin,
      x1: Math.max(a.x, b.x) + margin, y1: Math.max(a.y, b.y) + margin
    };
  }

  drawRoadTravellers(road, color, opts = {}) {
    const pts = road.points;
    if (!pts || pts.length < 2) return;

    const g = this._getRoadGeom(road);
    const minLen = opts.minLen ?? this.roadAnim.minLen;
    if (!(g.len >= minLen)) return;

    const v = opts.view;
    if (v && (g.maxX < v.x0 || g.minX > v.x1 || g.maxY < v.y0 || g.minY > v.y1)) return;

    let count = opts.count;
    if (!count) {
      count = Math.round(g.len / (opts.spacing ?? 0.15));
      count = Math.max(opts.min ?? 1, Math.min(opts.max ?? 3, count));
    }
    count = Math.min(count, Math.max(1, Math.floor(g.len / 0.03)));

    const timeSec = opts.timeSec ?? this.animTime * 0.001;
    const dir = (opts.bidirectional && g.seed < 0.5) ? -1 : 1;
    const base = g.seed + dir * timeSec * (opts.speed ?? 0.05) / g.len;

    const sprite = this._getGlowSprite(color);
    const size = (opts.glow ?? 14) * (opts.scale ?? 1);
    const half = size / 2;
    const alpha = opts.alpha ?? 1;
    const FADE = 0.02;
    const ctx = this.ctx;
    const tmp = this._tmpPt;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < count; k++) {
      let ph = (base + k / count) % 1;
      if (ph < 0) ph += 1;
      const d = ph * g.len;
      const fade = Math.min(1, Math.min(d, g.len - d) / FADE);
      if (fade <= 0.01) continue;

      this._pointAtDistance(pts, d, g.cum, tmp);
      const s = this.worldToScreen(tmp.x, tmp.y);
      ctx.globalAlpha = alpha * fade;
      ctx.drawImage(sprite, s.x - half, s.y - half, size, size);
    }
    ctx.restore();
  }

  _drawRoadsTravellersPass(roads, kind) {
    const cfg = this.roadAnim;
    if (!cfg || !cfg.enabled) return;

    const preset = cfg[kind];
    if (!preset) return;

    const opts = Object.assign({}, preset, {
      view: this._getViewWorldRect(),
      scale: Math.min(1.6, Math.max(0.75, Math.sqrt(this.camera.zoom))),
      timeSec: this.animTime * 0.001,
      minLen: cfg.minLen
    });

    for (const road of roads) this.drawRoadTravellers(road, preset.color, opts);
  }

  drawRoads(roads, color, width, dash = null, kind = null) {
    const ctx = this.ctx;
    if (!roads || roads.length === 0) return;

    const roadKind = kind || (dash ? "rail" : "road");
    const bridgeStyle = roadKind === "rail" ? "rail" : "wood";
    const isRail = roadKind === "rail";

    const dashOffset = dash
      ? -((this.animTime * 0.001 * this.roadAnim.rail.dashSpeed) % (dash[0] + dash[1]))
      : 0;

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (const road of roads) {
      if (!road.points || road.points.length < 2) continue;

      // ===== СЛОЙ 1: ТЕНЬ / ОБВОДКА =====
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = width + 3;
      ctx.beginPath();
      for (let i = 0; i < road.points.length; i++) {
        const p = road.points[i];
        const s = this.worldToScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();

      // ===== СЛОЙ 2: ПОЛОТНО =====
      if (isRail) {
        // Жд — полотно тёмное, пунктир рисуется ниже.
        ctx.strokeStyle = "#3a3a3a";
        ctx.lineWidth = width + 1;
        if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = dashOffset; }
        ctx.beginPath();
        for (let i = 0; i < road.points.length; i++) {
          const p = road.points[i];
          const s = this.worldToScreen(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();

        // Пунктир «рельсов» поверх (как было: #ffcc00 + едущий offset).
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = dashOffset; }
        ctx.beginPath();
        for (let i = 0; i < road.points.length; i++) {
          const p = road.points[i];
          const s = this.worldToScreen(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      } else {
        // Обычная дорога — сплошное полотно.
        ctx.strokeStyle = color;                 // #666666
        ctx.lineWidth = width;
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let i = 0; i < road.points.length; i++) {
          const p = road.points[i];
          const s = this.worldToScreen(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();

        // ===== СЛОЙ 3: РАЗМЕТКА (жёлтая осевая) =====
        ctx.strokeStyle = "rgba(255, 220, 100, 0.45)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.lineDashOffset = 0;
        ctx.beginPath();
        for (let i = 0; i < road.points.length; i++) {
          const p = road.points[i];
          const s = this.worldToScreen(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }

      // ===== КРУЖКИ НА СТЫКАХ =====
      // Скрывают «излом» в промежуточных точках.
      ctx.setLineDash([]);
      ctx.fillStyle = isRail ? "#3a3a3a" : color;
      const jointR = isRail ? width * 0.7 : width * 0.6;
      for (let i = 1; i < road.points.length - 1; i++) {
        const p = road.points[i];
        const s = this.worldToScreen(p.x, p.y);
        ctx.beginPath();
        ctx.arc(s.x, s.y, jointR, 0, Math.PI * 2);
        ctx.fill();
      }

      // ===== ВЫДЕЛЕНИЕ =====
      if (this.game.selectedRoad && this.game.selectedRoad.id === road.id) {
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = width + 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let i = 0; i < road.points.length; i++) {
          const p = road.points[i];
          const s = this.worldToScreen(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }

      // ===== МОСТЫ =====
      const bridgeSegs = this._getBridgeSegments(road);
      if (bridgeSegs.size > 0) {
        ctx.setLineDash([]);
        for (const i of bridgeSegs) {
          const a = this.worldToScreen(road.points[i].x, road.points[i].y);
          const b = this.worldToScreen(road.points[i + 1].x, road.points[i + 1].y);
          this.drawBridgeSegment(a, b, width, bridgeStyle);
        }
      }
    }

    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.restore();

    // Точки — отдельным проходом после линий и мостов этого списка.
    this._drawRoadsTravellersPass(roads, roadKind);

    this._bridgeCacheDirty = false;
  }

  drawProvinces(provinces) {
    const ctx = this.ctx;

    if (!provinces || provinces.length === 0) return;

    ctx.save();

    for (const prov of provinces) {
      if (!prov.vertices || prov.vertices.length < 3) continue;

      ctx.beginPath();

      prov.vertices.forEach((p, i) => {
        const s = this.worldToScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });

      ctx.closePath();

      let fillColor;
      let strokeColor;

      const atWar = this.game.isAtWar(this.game.playerId, this.game.aiId);

      if (prov.owner === 1) {
        fillColor = "rgba(50, 150, 255, 0.15)";
        strokeColor = atWar ? "rgba(255, 80, 80, 0.7)" : "rgba(50, 255, 150, 0.5)";
      } else if (prov.owner === 2) {
        fillColor = "rgba(255, 80, 80, 0.15)";
        strokeColor = atWar ? "rgba(255, 80, 80, 0.7)" : "rgba(50, 255, 150, 0.5)";
      } else {
        const hue = (prov.id * 137.508) % 360;
        fillColor = `hsla(${hue}, 70%, 50%, 0.08)`;
        strokeColor = `hsla(${hue}, 70%, 70%, 0.2)`;
      }

      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;

      ctx.fill();
      ctx.stroke();

      if (this.game.selectedProvince && this.game.selectedProvince.id === prov.id) {
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawPoints(points) {
    const ctx = this.ctx;

    if (!points || points.length === 0) return;

    const zoom = this.camera.zoom;
    const baseSize = 5;
    const size = Math.max(2, Math.min(15, baseSize * Math.sqrt(zoom)));

    // ИЗМЕНЕНО: служебные точки (не isCity) — только при zoom > 1.5.
    const showHelpers = zoom > 1.5;

    for (const p of points) {
      if (!p.isCity && !showHelpers) continue;

      const s = this.worldToScreen(p.x, p.y);

      if (s.x < -50 || s.x > this.canvas.width + 50 || s.y < -50 || s.y > this.canvas.height + 50) {
        continue;
      }

      ctx.save();

      if (p.isCity) {
        const city = this.game.cities.find(c => c.id === p.id);
        const cityType = city ? city.type : (p.cityType || 'city');
        const level = city ? city.level : 1;

        this.drawCityIcon(ctx, s.x, s.y, cityType, level);

        // Имя города.
        ctx.fillStyle = "#ffffff";
        ctx.font = "10px Segoe UI";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        const cityName = p.name || `Город #${p.id}`;
        ctx.fillText(cityName, s.x, s.y - 14);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = "#666666";

        ctx.beginPath();
        ctx.arc(s.x, s.y, size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (this.game.selectedPoint && this.game.selectedPoint.id === p.id) {
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(s.x, s.y, size * 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // ============================================================
  // ФЛАГИ ГОРОДОВ
  // ============================================================
  drawCityFlags() {
    const cities = this.game.cities;
    if (!cities || !cities.length) return;

    const ctx = this.ctx;
    const now = this.animTime || performance.now();

    const size = Math.max(2, Math.min(15, 5 * Math.sqrt(this.camera.zoom)));

    const colors = {
      [this.game.playerId]: this.territoryColors.player,
      [this.game.aiId]: this.territoryColors.ai,
    };

    const smooth = (t) => t * t * (3 - 2 * t);

    for (const city of cities) {
      let st = this.cityFlags.get(city.id);

      if (!st) {
        st = { from: city.owner, to: city.owner, start: 0 };
        this.cityFlags.set(city.id, st);
      } else if (st.to !== city.owner) {
        st.from = st.to;
        st.to = city.owner;
        st.start = now;
      }

      const s = this.worldToScreen(city.x, city.y);
      if (s.x < -50 || s.x > this.canvas.width + 50 ||
          s.y < -50 || s.y > this.canvas.height + 50) continue;

      const p = st.start ? Math.min(1, (now - st.start) / this.flagAnimMs) : 1;
      const hasOld = st.from !== 0;
      const hasNew = st.to !== 0;

      let owner = 0;
      let rise = 0;

      if (p >= 1) {
        owner = st.to;
        rise = hasNew ? 1 : 0;
      } else if (hasOld && p < 0.5) {
        owner = st.from;
        rise = 1 - p * 2;
      } else if (hasNew) {
        owner = st.to;
        rise = hasOld ? (p - 0.5) * 2 : p;
      }
      rise = smooth(Math.max(0, Math.min(1, rise)));

      let r = size * 1.5;
      if (city.type === "city") r = size * 2;
      else if (city.type === "trade") r = size * 1.6;

      const poleH = r * 1.7;
      const clothW = poleH * 0.6;
      const clothH = poleH * 0.4;
      const bx = s.x + r * 0.95;
      const by = s.y + r * 0.35;

      ctx.save();

      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = Math.max(2, size * 0.45);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - poleH);
      ctx.stroke();

      ctx.strokeStyle = "#e6e6e6";
      ctx.lineWidth = Math.max(1, size * 0.25);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - poleH);
      ctx.stroke();

      ctx.fillStyle = "#ffd866";
      ctx.beginPath();
      ctx.arc(bx, by - poleH, Math.max(1, size * 0.3), 0, Math.PI * 2);
      ctx.fill();

      const c = colors[owner];
      if (c && rise > 0.02) {
        const yTop = (by - poleH) + (1 - rise) * (poleH - clothH);
        const segs = 6;
        const phase = now * 0.006 + city.id;

        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
          const k = i / segs;
          const x = bx + 1 + k * clothW;
          const y = yTop + Math.sin(phase + i * 0.8) * clothH * 0.14 * k;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        for (let i = segs; i >= 0; i--) {
          const k = i / segs;
          const x = bx + 1 + k * clothW;
          const y = yTop + clothH + Math.sin(phase + i * 0.8) * clothH * 0.14 * k;
          ctx.lineTo(x, y);
        }
        ctx.closePath();

        ctx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

    // ============================================================
  // ИКОНКИ ГОРОДОВ (рисование в коде, flat-стиль)
  // ============================================================
  drawCityIcon(ctx, x, y, type, level = 1) {
    const size = 14 + Math.min(level - 1, 4) * 1.5;   // 14–20px
    const half = size / 2;

    const sprite = this.citySprites[type];

    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      // PNG-спрайт.
      ctx.drawImage(sprite, x - half, y - half, size, size);
      return;
    }

    // ===== FALLBACK: прежняя плоская отрисовка =====
    const radius = half + 2;   // круг подложки

    // Цвета по типу (stroke + fill).
    const colors = {
      city:     { stroke: '#4a9eff', fill: 'rgba(74,158,255,0.30)' },
      port:     { stroke: '#33cc33', fill: 'rgba(51,204,51,0.30)' },
      airfield: { stroke: '#cc66ff', fill: 'rgba(204,102,255,0.30)' },
      farm:     { stroke: '#88cc44', fill: 'rgba(136,204,68,0.30)' },
      mine:     { stroke: '#aa8866', fill: 'rgba(170,136,102,0.30)' },
      factory:  { stroke: '#ff8844', fill: 'rgba(255,136,68,0.30)' },
      trade:    { stroke: '#ffd700', fill: 'rgba(255,215,0,0.30)' },
    };

    const c = colors[type] || { stroke: '#888888', fill: 'rgba(136,136,136,0.30)' };

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Подложка (круг).
    ctx.fillStyle = c.fill;
    ctx.strokeStyle = c.stroke;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Иконка.
    ctx.strokeStyle = c.stroke;
    ctx.fillStyle = c.stroke;

    if (type === 'city') {
      // Город: квадрат с башнями.
      ctx.fillRect(x - 3, y - 1, 6, 4);
      ctx.fillRect(x - 4, y - 3, 2, 2);
      ctx.fillRect(x + 2, y - 3, 2, 2);

    } else if (type === 'port') {
      // Порт: якорь.
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 2);
      ctx.moveTo(x - 3, y - 2);
      ctx.lineTo(x + 3, y - 2);
      ctx.moveTo(x - 3, y + 1);
      ctx.quadraticCurveTo(x, y + 4, x + 3, y + 1);
      ctx.stroke();

    } else if (type === 'airfield') {
      // Аэродром: самолёт сверху.
      ctx.beginPath();

      // Фюзеляж.
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 4);

      // Крылья.
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);

      // Хвост.
      ctx.moveTo(x - 2, y + 3);
      ctx.lineTo(x + 2, y + 3);

      ctx.stroke();

    } else if (type === 'farm') {
      // Ферма: силуэт амбара и линии поля.
      ctx.beginPath();

      // Крыша.
      ctx.moveTo(x - 4, y - 1);
      ctx.lineTo(x, y - 4);
      ctx.lineTo(x + 4, y - 1);

      // Стены.
      ctx.lineTo(x + 4, y + 2);
      ctx.lineTo(x - 4, y + 2);
      ctx.closePath();
      ctx.fill();

      // Поле.
      ctx.beginPath();
      ctx.moveTo(x - 3, y + 4);
      ctx.lineTo(x - 1, y + 4);
      ctx.moveTo(x + 1, y + 4);
      ctx.lineTo(x + 3, y + 4);
      ctx.stroke();

    } else if (type === 'mine') {
      // Шахта: кирка.
      ctx.beginPath();

      // Рукоять.
      ctx.moveTo(x - 3, y + 4);
      ctx.lineTo(x + 2, y - 3);

      // Верхняя часть кирки.
      ctx.moveTo(x - 4, y - 3);
      ctx.quadraticCurveTo(x, y - 5, x + 4, y - 2);

      ctx.stroke();

    } else if (type === 'factory') {
      // Завод: корпус и дымовая труба.
      ctx.fillRect(x - 4, y - 1, 8, 5);

      // Труба.
      ctx.fillRect(x + 1, y - 4, 2, 3);

      // Дым.
      ctx.beginPath();
      ctx.arc(x - 1, y - 4, 0.8, 0, Math.PI * 2);
      ctx.arc(x + 3, y - 6, 0.8, 0, Math.PI * 2);
      ctx.fill();

    } else if (type === 'trade') {
      // Торговля: монета.
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, y - 2);
      ctx.lineTo(x, y + 2);
      ctx.stroke();

    } else {
      // Fallback.
      ctx.strokeRect(x - 3, y - 3, 6, 6);
    }

    // Уровень города: 1–5 точек под иконкой.
    const levelDots = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
    const dotSpacing = 3;
    const dotRadius = 0.8;
    const dotsWidth = (levelDots - 1) * dotSpacing;
    const dotsY = y + radius + 2;

    ctx.fillStyle = c.stroke;

    for (let i = 0; i < levelDots; i++) {
      const dotX = x - dotsWidth / 2 + i * dotSpacing;

      ctx.beginPath();
      ctx.arc(dotX, dotsY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawCity(city) {
    const ctx = this.ctx;
    const s = this.worldToScreen(city.x, city.y);

    ctx.save();

    if (this.game.selectedCity && this.game.selectedCity.id === city.id) {
      ctx.strokeStyle = "#ffff00";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.arc(s.x, s.y, 18, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  // ============================================================
  // ТАКТИЧЕСКИЕ ИКОНКИ ЮНИТОВ
  // ============================================================

  drawUnit(unit) {
    const ctx = this.ctx;

    if (!unit || !unit.isAlive()) return;

    const s = this.worldToScreen(unit.x, unit.y);
    const isPlayer = unit.owner === this.game.playerId;
    const isSelected =
      this.game.selectedUnit &&
      this.game.selectedUnit.id === unit.id;

    const color = isPlayer ? "#00ff88" : "#ff5368";
    const fillColor = isPlayer
      ? "rgba(0, 255, 136, 0.22)"
      : "rgba(255, 83, 104, 0.22)";

    const radius = 9;
    const type = this.getUnitTypeKey(unit);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(s.x, s.y - radius);
    ctx.lineTo(s.x + radius, s.y);
    ctx.lineTo(s.x, s.y + radius);
    ctx.lineTo(s.x - radius, s.y);
    ctx.closePath();

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    ctx.shadowColor = color;
    ctx.shadowBlur = isSelected ? 8 : 0;
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    if (isPlayer) {
      ctx.moveTo(s.x, s.y - 5);
      ctx.lineTo(s.x, s.y - 1.4);

      ctx.moveTo(s.x - 2, s.y - 3.2);
      ctx.lineTo(s.x + 2, s.y - 3.2);
    } else {
      ctx.moveTo(s.x - 2, s.y - 5);
      ctx.lineTo(s.x + 2, s.y - 1.4);

      ctx.moveTo(s.x + 2, s.y - 5);
      ctx.lineTo(s.x - 2, s.y - 1.4);
    }

    ctx.stroke();

    this.drawUnitTypeMark(ctx, s.x, s.y + 3.1, type, color);

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);

      ctx.strokeStyle = "#ffff00";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#ffff00";
      ctx.shadowBlur = 8;

      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const barW = 20;
    const barH = 3;
    const barX = s.x - barW / 2;
    const barY = s.y - 16;

    const maxHp = Math.max(1, Number(unit.maxHp) || 1);
    const hp = Math.max(0, Math.min(maxHp, Number(unit.hp) || 0));
    const hpRatio = hp / maxHp;

    ctx.fillStyle = "#222222cc";
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = hpRatio > 0.5 ? "#00ff66" : "#ff4444";
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    if (isPlayer) {
      let stateIcon = "●";
      let stateColor = "#8899bb";

      if (unit.state === "moving") {
        stateIcon = "▶";
        stateColor = "#ffcc00";
      }

      if (unit.state === "fighting") {
        stateIcon = "⚔";
        stateColor = "#ff4444";
      }

      ctx.fillStyle = stateColor;
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(stateIcon, s.x, s.y - 20);
    }

    ctx.restore();
  }

 // ИЗМЕНЕНО: маппинг новых типов формирований.
getUnitTypeKey(unit) {
  const rawType = String(
    unit.type ??
    unit.unitType ??
    unit.category ??
    unit.kind ??
    ""
  ).toLowerCase();

  // Прямое совпадение с UNIT_TYPES.
  if (rawType === 'militia') return 'militia';
  if (rawType === 'infantry') return 'infantry';
  if (rawType === 'motorized') return 'motorized';
  if (rawType === 'armored') return 'tank';       // иконка танка
  if (rawType === 'artillery') return 'artillery';
  if (rawType === 'marines') return 'marines';

  // Fallback для старых строк.
  if (
    rawType.includes("artillery") ||
    rawType.includes("howitzer") ||
    rawType.includes("cannon") ||
    rawType.includes("артилл") ||
    rawType.includes("гаубиц")
  ) {
    return "artillery";
  }

  if (
    rawType.includes("tank") ||
    rawType.includes("armor") ||
    rawType.includes("armour") ||
    rawType.includes("танк") ||
    rawType.includes("бронетех")
  ) {
    return "tank";
  }

  if (
    rawType.includes("infantry") ||
    rawType.includes("soldier") ||
    rawType.includes("rifle") ||
    rawType.includes("пехот") ||
    rawType.includes("солдат")
  ) {
    return "infantry";
  }

  return "unknown";
}

  // ИЗМЕНЕНО: иконки для новых типов формирований.
drawUnitTypeMark(ctx, x, y, type, color) {
  ctx.save();

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.25;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (type === "militia") {
    // Ополчение: три точки (толпа).
    ctx.beginPath();
    ctx.arc(x - 1.6, y + 0.6, 0.9, 0, Math.PI * 2);
    ctx.arc(x, y + 0.6, 0.9, 0, Math.PI * 2);
    ctx.arc(x + 1.6, y + 0.6, 0.9, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "infantry") {
    // Пехота: точка.
    ctx.beginPath();
    ctx.arc(x, y, 1.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "motorized") {
    // Моторизованная: шеврон (стрелка) + маленькие колёса.
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 1);
    ctx.lineTo(x, y - 1);
    ctx.lineTo(x + 2, y + 1);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x - 1.8, y + 1.4, 0.55, 0, Math.PI * 2);
    ctx.arc(x + 1.8, y + 1.4, 0.55, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "tank") {
    // Танк: корпус, башня и короткий ствол.
    ctx.fillRect(x - 2.1, y - 0.6, 4.2, 1.7);
    ctx.fillRect(x - 0.7, y - 1.8, 1.4, 1.2);

    ctx.beginPath();
    ctx.moveTo(x + 0.2, y - 1.4);
    ctx.lineTo(x + 2.2, y - 2.1);
    ctx.stroke();
  } else if (type === "artillery") {
    // Артиллерия: опора и направленный ствол.
    ctx.beginPath();
    ctx.moveTo(x - 2.2, y + 1.1);
    ctx.lineTo(x + 2.2, y + 1.1);

    ctx.moveTo(x - 0.3, y + 0.7);
    ctx.lineTo(x + 2.1, y - 1.2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x - 0.3, y + 0.7, 0.65, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "marines") {
    // Морская пехота: якорь (упрощённый).
    ctx.beginPath();
    // Вертикальная линия.
    ctx.moveTo(x, y - 1.8);
    ctx.lineTo(x, y + 1.8);
    // Перекладина.
    ctx.moveTo(x - 1.4, y - 0.8);
    ctx.lineTo(x + 1.4, y - 0.8);
    // Крюк снизу.
    ctx.moveTo(x - 1.4, y + 1.2);
    ctx.quadraticCurveTo(x, y + 2.4, x + 1.4, y + 1.2);
    ctx.stroke();
  } else {
    // Резервный маркер для ещё не классифицированных типов.
    ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
  }

  ctx.restore();
}

  drawUnitTarget() {
    const ctx = this.ctx;
    const unit = this.game.selectedUnit;

    if (!unit || !unit.movementCommandActive || unit.state !== "moving" || !unit.isAlive()) {
      return;
    }

    const target = this.worldToScreen(unit.targetX, unit.targetY);
    const pos = this.worldToScreen(unit.x, unit.y);

    ctx.save();

    ctx.strokeStyle = "rgba(255, 255, 100, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.arc(target.x, target.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(255, 255, 100, 0.3)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(target.x - 4, target.y);
    ctx.lineTo(target.x + 4, target.y);
    ctx.moveTo(target.x, target.y - 4);
    ctx.lineTo(target.x, target.y + 4);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 100, 0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  drawCombatEffects() {
    const ctx = this.ctx;
    const effects = this.game.combat?.combatEffects || [];

    if (!effects.length) return;

    const now = performance.now();

    for (const effect of effects) {
      if (effect.type === "provinceCapture") {
        this.drawProvinceCaptureEffect(effect);
        continue;
      }

      const progress = 1 - effect.life / effect.maxLife;
      const alpha = Math.max(0, effect.life / effect.maxLife);

      const start = this.worldToScreen(effect.x1, effect.y1);
      const end = this.worldToScreen(effect.x2, effect.y2);

      ctx.save();

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = effect.type === "cityAttack" ? "#ffaa44" : "#ffffff";
      ctx.lineWidth = 2;
      ctx.shadowColor = effect.type === "cityAttack" ? "#ff6600" : "#ffffff";
      ctx.shadowBlur = 8;

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);

      const currentX = start.x + (end.x - start.x) * progress;
      const currentY = start.y + (end.y - start.y) * progress;

      ctx.lineTo(currentX, currentY);
      ctx.stroke();

      const hitRadius = 3 + progress * 8;

      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = effect.type === "cityAttack" ? "#ff9933" : "#ffffff";

      ctx.beginPath();
      ctx.arc(end.x, end.y, hitRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = Math.min(1, alpha * 1.5);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Segoe UI";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const textY = end.y - 8 - progress * 18;

      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 4;

      ctx.fillText(`-${Math.floor(effect.damage)}`, end.x, textY);

      ctx.restore();
    }

    void now;
  }

  drawProvinceCaptureEffect(effect) {
    const ctx = this.ctx;

    const progress = 1 - effect.life / effect.maxLife;
    const fadeAlpha = Math.max(0, 1 - progress);

    const center = this.worldToScreen(effect.x, effect.y);
    const edge = this.worldToScreen(effect.x + effect.maxRadius, effect.y);

    const maxPixelRadius = Math.abs(edge.x - center.x);

    if (maxPixelRadius < 1) return;

    const currentPixelRadius = maxPixelRadius * progress;

    const color =
      effect.ownerId === this.game.playerId
        ? "50, 150, 255"
        : effect.ownerId === this.game.aiId
        ? "255, 80, 80"
        : "255, 255, 255";

    ctx.save();

    ctx.globalAlpha = fadeAlpha * 0.85;
    ctx.strokeStyle = `rgba(${color}, 1)`;
    ctx.lineWidth = Math.max(1, 5 * fadeAlpha);
    ctx.shadowColor = `rgba(${color}, 1)`;
    ctx.shadowBlur = 14;

    ctx.beginPath();
    ctx.arc(center.x, center.y, currentPixelRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = fadeAlpha * 0.12;
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(${color}, 1)`;
    ctx.fill();

    ctx.restore();
  }

  drawFrontline() {
    const ctx = this.ctx;
    const provinces = this.game.map.provinces || [];

    for (let i = 0; i < provinces.length; i++) {
      const prov = provinces[i];

      if (!prov.vertices || prov.vertices.length < 3) continue;
      if (prov.owner === 0) continue;

      for (let j = i + 1; j < provinces.length; j++) {
        const neighbor = provinces[j];

        if (!neighbor.vertices || neighbor.vertices.length < 3) continue;
        if (neighbor.owner === 0) continue;
        if (neighbor.owner === prov.owner) continue;

        const edge = this.getSharedEdge(prov, neighbor);

        if (edge) {
          const p1 = this.worldToScreen(edge[0].x, edge[0].y);
          const p2 = this.worldToScreen(edge[1].x, edge[1].y);

          ctx.save();

          ctx.strokeStyle = "#ffdd44";
          ctx.lineWidth = 3;
          ctx.shadowColor = "#ffdd44";
          ctx.shadowBlur = 12;
          ctx.setLineDash([8, 6]);

          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();

          ctx.setLineDash([]);
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }
    }
  }

  getSharedEdge(prov1, prov2) {
    const v1 = prov1.vertices || [];
    const v2 = prov2.vertices || [];
    const eps = 0.0001;

    for (let i = 0; i < v1.length; i++) {
      const a = v1[i];
      const b = v1[(i + 1) % v1.length];

      for (let j = 0; j < v2.length; j++) {
        const c = v2[j];
        const d = v2[(j + 1) % v2.length];

        if (this.segmentsEqual(a, b, c, d, eps)) {
          return [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
          ];
        }
      }
    }

    return null;
  }

  segmentsEqual(a, b, c, d, eps = 0.0001) {
    const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

    return (
      (dist(a, c) < eps && dist(b, d) < eps) ||
      (dist(a, d) < eps && dist(b, c) < eps)
    );
  }

  drawHoverCandidate() {
    const input = this.inputHandler;
    if (!input || !input.hoverCandidate) return;

    const ctx = this.ctx;
    const hc = input.hoverCandidate;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 100, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);

    if (hc.type === 'city') {
      const s = this.worldToScreen(hc.data.x, hc.data.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hc.type === 'units' && hc.data.length > 0) {
      const u = hc.data[0];
      const s = this.worldToScreen(u.x, u.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  drawSelection() {}
}