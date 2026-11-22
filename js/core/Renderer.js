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

    // ===== РЕЖИМ КАРТЫ (СЛОИ) =====
    // ИЗМЕНЕНО: переключатель политический/физический слой.
    // 'political' — территория, владельцы провинций, фронт, флаги.
    // 'physical'  — только физическая основа: PNG-подложка (или
    //               процедурная раскраска суша/вода), дороги, города, юниты.
    this.mapMode = 'political';

    // ===== МАРКЕРЫ ЮНИТОВ =====
    // ИЗМЕНЕНО: режим маркеров юнитов.
    // 'type'    — плашка с силуэтом типа формирования (прежний вид).
    // 'faction' — круглая фишка в цвете фракции с эмблемой
    //             (стиль анимированных исторических карт).
    this.unitMarkerMode = 'type';

    // Эмблемы фракций для режима 'faction' (рисуются в коде).
    // Новые фракции добавляются сюда: { [factionId]: <id из availableEmblems> }
    this.factionEmblems = {
      [this.game.playerId]: 'cross',
      [this.game.aiId]: 'star',
    };

    // Галерея доступных эмблем (для выбора в панели фракции).
    // id используется в factionEmblems, name — в UI-выборе.
    this.availableEmblems = [
      { id: 'cross',     name: 'Крест' },
      { id: 'star',      name: 'Звезда' },
      { id: 'crescent',  name: 'Полумесяц' },
      { id: 'lightning', name: 'Молния' },
      { id: 'arrow',     name: 'Стрела' },
      { id: 'shield',    name: 'Щит' },
      { id: 'sword',     name: 'Меч' },
      { id: 'sun',       name: 'Солнце' },
      { id: 'triangle',  name: 'Треугольник' },
      { id: 'diamond',   name: 'Ромб' },
      { id: 'claw',      name: 'Коготь' },
      { id: 'ring',      name: 'Кольцо' },
    ];

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

  // ИЗМЕНЕНО: переключение слоёв карты (клавиша M / команда /map).
  toggleMapMode() {
    this.mapMode = this.mapMode === 'political' ? 'physical' : 'political';
    return this.mapMode;
  }

  // ИЗМЕНЕНО: переключение маркеров юнитов (клавиша N / команда /markers).
  toggleUnitMarkerMode() {
    this.unitMarkerMode = this.unitMarkerMode === 'type' ? 'faction' : 'type';
    return this.unitMarkerMode;
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

    // ===== ТЕРРИТОРИЯ (только политический слой) =====
    if (this.mapMode === 'political') {
      this.drawTerritory();
    }

    this.drawProvinces(map.provinces || []);

    const roads = (map.roads || []).filter(
      (r) => r.type === "road" || r.type === undefined
    );

    const rails = (map.roads || []).filter(
      (r) => r.type === "rail"
    );

    this.drawRoads(roads, "#666666", 2, null, "road");
    this.drawRoads(rails, "#ffcc00", 3, [6, 4], "rail");

    // Фронт — только в политическом слое.
    if (this.mapMode === 'political') {
      this.drawFrontline();
    }

    this.drawPoints(map.points || []);

    // ===== ФЛАГИ ГОРОДОВ (только политический слой) =====
    if (this.mapMode === 'political') {
      this.drawCityFlags();
    }

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

      // ИЗМЕНЕНО: физический слой — без политической раскраски.
      if (this.mapMode === 'physical') {
        const hasBg = this.bgLoaded && this.bgImage;

        if (hasBg) {
          // Поверх физической PNG-карты — только тонкие нейтральные границы.
          fillColor = null;
          strokeColor = "rgba(200, 205, 215, 0.22)";
        } else if (prov.type === 'water') {
          // Нет подложки: процедурная физическая раскраска по типу.
          fillColor = "rgba(52, 94, 148, 0.45)";
          strokeColor = "rgba(90, 140, 200, 0.5)";
        } else {
          fillColor = "rgba(118, 128, 92, 0.35)";
          strokeColor = "rgba(170, 175, 150, 0.35)";
        }
      } else if (prov.owner === 1) {
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

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;

      // ИЗМЕНЕНО: в физическом режиме с подложкой заливки нет.
      if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
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

        // ИЗМЕНЕНО: стратегический зум — ромб-маркер в стиле аним. карт;
        // иконка типа города — только на близком зуме (там, где нанимают).
        if (zoom > 1.5) {
          this.drawCityIcon(ctx, s.x, s.y, cityType, level);
        } else {
          this.drawCityDiamond(ctx, s.x, s.y, level, zoom);
        }

        // Имя города: тёмная обводка + заливка, кегль растёт с уровнем.
        const cityName = p.name || `Город #${p.id}`;
        const fontSize = 10 + Math.min(Math.max(level - 1, 0), 4);
        ctx.font = `600 ${fontSize}px "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
        ctx.strokeText(cityName, s.x, s.y - 14);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(cityName, s.x, s.y - 14);
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
  // ИЗМЕНЕНО: ромб-маркер города (стратегический зум, стиль аним. карт).
  // Размер растёт с уровнем; максимальный уровень — внутренняя рамка.
  // ============================================================
  drawCityDiamond(ctx, x, y, level = 1, zoom = 1) {
    // ИЗМЕНЕНО: компенсация отдаления камеры — чем дальше камера,
    // тем крупнее маркер; потолок ×1.8, чтобы не было каши на минимальном зуме.
    const zoomBoost = Math.min(1.8, Math.max(1, Math.pow(1 / zoom, 0.6)));
    const size = (4.5 + Math.min(Math.max(level - 1, 0), 4) * 1.2) * zoomBoost;
    const h = size / 2;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);

    ctx.beginPath();
    ctx.rect(-h, -h, size, size);
    ctx.fillStyle = "#f2f2f2";
    ctx.strokeStyle = "rgba(10, 12, 18, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    if (level >= 5) {
      const ih = h * 0.55;
      ctx.beginPath();
      ctx.rect(-ih, -ih, ih * 2, ih * 2);
      ctx.stroke();
    }

    ctx.restore();
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

  // Вспомогательный: скруглённый прямоугольник (плашка юнита).
  roundRectPath(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  // ИЗМЕНЕНО: юнит — плашка-«фишка» со скруглёнными углами.
  // Цвета фракций совпадают с цветами территорий на карте.
  drawUnit(unit) {
    const ctx = this.ctx;

    if (!unit || !unit.isAlive()) return;

    const s = this.worldToScreen(unit.x, unit.y);
    const isPlayer = unit.owner === this.game.playerId;
    const isSelected =
      this.game.selectedUnit &&
      this.game.selectedUnit.id === unit.id;

    const color = isPlayer ? "#4a9eff" : "#ff5050";
    const fillColor = isPlayer
      ? "rgba(74, 158, 255, 0.16)"
      : "rgba(255, 80, 80, 0.16)";

    const type = this.getUnitTypeKey(unit);

    // Размер плашки отражает «вес» класса.
    let radius = 9.5;
    if (type === "tank") radius = 10.5;
    else if (type === "militia") radius = 8.5;

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (this.unitMarkerMode === 'faction') {
      // Круглая фишка в цвете фракции + белая эмблема (стиль аним. карт).
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(8, 12, 22, 0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();

      this.drawFactionEmblem(ctx, s.x, s.y, radius, unit.owner);
    } else {
      // Плашка: тёмная подложка + полупрозрачный тинт фракции + обводка.
      this.roundRectPath(ctx, s.x - radius, s.y - radius, radius * 2, radius * 2, 4);
      ctx.fillStyle = "rgba(8, 12, 22, 0.85)";
      ctx.fill();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Символ типа по центру плашки.
      this.drawUnitTypeMark(ctx, s.x, s.y, type, color);
    }

    // Выделение: аккуратное жёлтое кольцо без свечения.
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius + 4.5, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffe14a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();

    // HP-бар над плашкой.
    const barW = 22;
    const barH = 3;
    const barX = s.x - barW / 2;
    const barY = s.y - radius - 9;

    const maxHp = Math.max(1, Number(unit.maxHp) || 1);
    const hp = Math.max(0, Math.min(maxHp, Number(unit.hp) || 0));
    const hpRatio = hp / maxHp;

    ctx.save();

    ctx.fillStyle = "rgba(10, 10, 14, 0.8)";
    ctx.fillRect(barX, barY, barW, barH);

    // Три порога: зелёный / жёлтый / красный.
    ctx.fillStyle =
      hpRatio > 0.5 ? "#00dd66" :
      hpRatio > 0.25 ? "#ffcc33" :
      "#ff4444";
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // Состояние (только свои) — над HP-баром, без наложения.
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
      ctx.fillText(stateIcon, s.x, barY - 1.5);
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

  // ============================================================
  // ИЗМЕНЕНО: эмблемы фракций для режима маркеров 'faction'.
  // Галерея из 12 пресетов (this.availableEmblems) — простые
  // геометрические символы, читаются на ~10 px.
  // ============================================================
  drawFactionEmblem(ctx, x, y, r, owner) {
    const emblem = this.factionEmblems[owner] || 'ring';
    this.drawEmblemShape(ctx, emblem, x, y, r);
  }

  // Рисует эмблему по id. Вся геометрия — здесь, чтобы выбор
  // эмблемы в UI рисовал превью тем же кодом.
  drawEmblemShape(ctx, emblem, x, y, r) {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    switch (emblem) {
      case 'cross': {
        // Прямой крест: два толстых прямоугольника.
        const arm = r * 0.62;
        const w = r * 0.3;
        ctx.fillRect(x - w / 2, y - arm, w, arm * 2);
        ctx.fillRect(x - arm, y - w / 2, arm * 2, w);
        break;
      }

      case 'star': {
        // Пятиконечная звезда.
        const R = r * 0.62;
        const ir = R * 0.42;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 5;
          const rad = i % 2 === 0 ? R : ir;
          const px = x + Math.cos(ang) * rad;
          const py = y + Math.sin(ang) * rad;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'crescent': {
        // Полумесяц: толстая дуга, рожками вверх.
        ctx.beginPath();
        ctx.arc(x, y - r * 0.05, r * 0.42, Math.PI * 0.3, Math.PI * 1.7);
        ctx.lineWidth = r * 0.3;
        ctx.stroke();
        break;
      }

      case 'lightning': {
        // Молния: ломаная зигзаг с заливкой.
        ctx.beginPath();
        ctx.moveTo(x + r * 0.18, y - r * 0.62);
        ctx.lineTo(x - r * 0.24, y + r * 0.06);
        ctx.lineTo(x - r * 0.02, y + r * 0.06);
        ctx.lineTo(x - r * 0.18, y + r * 0.62);
        ctx.lineTo(x + r * 0.24, y - r * 0.06);
        ctx.lineTo(x + r * 0.02, y - r * 0.06);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'arrow': {
        // Стрела вверх: древко + наконечник.
        const w = r * 0.22;
        ctx.fillRect(x - w / 2, y - r * 0.1, w, r * 0.72);
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.62);
        ctx.lineTo(x + r * 0.42, y - r * 0.05);
        ctx.lineTo(x - r * 0.42, y - r * 0.05);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'shield': {
        // Щит: закруглённый верх, остриё вниз.
        ctx.beginPath();
        ctx.moveTo(x - r * 0.45, y - r * 0.42);
        ctx.lineTo(x + r * 0.45, y - r * 0.42);
        ctx.quadraticCurveTo(x + r * 0.5, y + r * 0.2, x, y + r * 0.6);
        ctx.quadraticCurveTo(x - r * 0.5, y + r * 0.2, x - r * 0.45, y - r * 0.42);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'sword': {
        // Меч по диагонали: клинок + гарда.
        ctx.lineWidth = r * 0.22;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.38, y + r * 0.45);
        ctx.lineTo(x + r * 0.38, y - r * 0.5);
        ctx.stroke();
        ctx.lineWidth = r * 0.18;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.42, y + r * 0.08);
        ctx.lineTo(x - r * 0.05, y + r * 0.45);
        ctx.stroke();
        break;
      }

      case 'sun': {
        // Солнце: диск + 8 лучей.
        ctx.beginPath();
        ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = r * 0.16;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r * 0.38, y + Math.sin(a) * r * 0.38);
          ctx.lineTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
          ctx.stroke();
        }
        break;
      }

      case 'triangle': {
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.55);
        ctx.lineTo(x + r * 0.5, y + r * 0.4);
        ctx.lineTo(x - r * 0.5, y + r * 0.4);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'diamond': {
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.58);
        ctx.lineTo(x + r * 0.42, y);
        ctx.lineTo(x, y + r * 0.58);
        ctx.lineTo(x - r * 0.42, y);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'claw': {
        // Коготь: три дуговых штриха.
        ctx.lineWidth = r * 0.18;
        for (const dx of [-0.28, 0, 0.28]) {
          ctx.beginPath();
          ctx.moveTo(x + r * (dx - 0.1), y - r * 0.45);
          ctx.quadraticCurveTo(
            x + r * (dx + 0.12), y,
            x + r * dx, y + r * 0.5
          );
          ctx.stroke();
        }
        break;
      }

      case 'ring':
      default: {
        // Кольцо — запасной вариант для фракций без эмблемы.
        ctx.beginPath();
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        ctx.lineWidth = r * 0.22;
        ctx.stroke();
        break;
      }
    }

    ctx.restore();
  }

  // ИЗМЕНЕНО: крупные силуэты типов формирований (~9px, центр плашки).
  // Единый штрих 1.5, округлые концы; танк/грузовик — с заливкой.
  drawUnitTypeMark(ctx, x, y, type, color) {
    ctx.save();

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (type === "militia") {
      // Ополчение: три штриха «колонна людей».
      for (const dx of [-2.6, 0, 2.6]) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y - 2.3);
        ctx.lineTo(x + dx, y + 2.3);
        ctx.stroke();
      }
    } else if (type === "infantry") {
      // Пехота: направленный клин (треугольник).
      ctx.beginPath();
      ctx.moveTo(x, y - 2.6);
      ctx.lineTo(x + 2.5, y + 1.9);
      ctx.lineTo(x - 2.5, y + 1.9);
      ctx.closePath();
      ctx.fill();
    } else if (type === "motorized") {
      // Моторизованная: грузовик (кузов + кабина + колёса).
      ctx.fillRect(x - 3.1, y - 1.8, 3.9, 2.4);
      ctx.fillRect(x + 0.8, y - 1, 2.3, 1.6);
      ctx.beginPath();
      ctx.arc(x - 1.9, y + 1.4, 0.7, 0, Math.PI * 2);
      ctx.arc(x + 1.9, y + 1.4, 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === "tank") {
      // Бронетанковая: гусеница, башня, ствол.
      this.roundRectPath(ctx, x - 3.6, y - 0.7, 7.2, 2.2, 1);
      ctx.fill();
      ctx.fillRect(x - 1.3, y - 2.7, 2.6, 2);
      ctx.beginPath();
      ctx.moveTo(x + 0.9, y - 1.8);
      ctx.lineTo(x + 3.7, y - 2.6);
      ctx.stroke();
    } else if (type === "artillery") {
      // Артиллерия: колесо + длинный ствол + станок.
      ctx.beginPath();
      ctx.arc(x - 1.5, y + 0.5, 1.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 0.7, y + 0.1);
      ctx.lineTo(x + 3.5, y - 2.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 1.8, y + 1.4);
      ctx.lineTo(x - 3.2, y + 2.7);
      ctx.stroke();
    } else if (type === "marines") {
      // Морская пехота: якорь.
      ctx.beginPath();
      ctx.arc(x, y - 3.1, 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - 2.5);
      ctx.lineTo(x, y + 1.9);
      ctx.moveTo(x - 1.6, y - 1.1);
      ctx.lineTo(x + 1.6, y - 1.1);
      ctx.moveTo(x - 2.1, y + 0.5);
      ctx.quadraticCurveTo(x, y + 2.9, x + 2.1, y + 0.5);
      ctx.stroke();
    } else {
      // Резервный маркер для ещё не классифицированных типов.
      ctx.beginPath();
      ctx.moveTo(x, y - 2.4);
      ctx.lineTo(x + 2.4, y);
      ctx.lineTo(x, y + 2.4);
      ctx.lineTo(x - 2.4, y);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
  }

  // ============================================================
  // ИЗМЕНЕНО: стрелки приказов (стиль HoI4 / аним. исторические карты).
  // Рисуются для ВСЕХ движущихся юнитов игрока, не только выделенного.
  // Приказы ИИ не показываются — это была бы бесплатная разведка.
  // Атака (есть targetUnit) — красноватая стрелка, движение — белая.
  // ============================================================
  drawUnitTarget() {
    const ctx = this.ctx;
    const game = this.game;

    if (!game || !game.units) return;

    const now = this.animTime || performance.now();

    for (const unit of game.units) {
      if (unit.owner !== game.playerId) continue;
      if (!unit.isAlive()) continue;
      if (!unit.movementCommandActive || unit.state !== "moving") continue;

      const pos = this.worldToScreen(unit.x, unit.y);
      const target = this.worldToScreen(unit.targetX, unit.targetY);

      // Оба конца далеко за экраном — не рисуем.
      const m = 120;
      if (
        (pos.x < -m && target.x < -m) ||
        (pos.x > this.canvas.width + m && target.x > this.canvas.width + m) ||
        (pos.y < -m && target.y < -m) ||
        (pos.y > this.canvas.height + m && target.y > this.canvas.height + m)
      ) {
        continue;
      }

      this.drawOrderArrow(ctx, pos, target, now, unit.id, !!unit.targetUnit);
    }
  }

  // Изогнутая стрелка приказа: тело по квадратичной кривой,
  // треугольный наконечник, «бегущие» штрихи по телу.
  // Все размеры — в экранных пикселях (не зависят от зума).
  drawOrderArrow(ctx, pos, target, now, seed, isAttack) {
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const len = Math.hypot(dx, dy);

    const MIN_LEN = 26; // слишком короткий приказ — стрелка не нужна
    if (len < MIN_LEN) return;

    // Толщина тела растёт с длиной стрелки (кламп 3–10 px).
    const w = Math.max(3, Math.min(10, len * 0.045));

    // Изгиб пропорционален «диагональности» направления:
    // приказы строго по осям (0°/90°/180°/270°) — прямые стрелки,
    // максимальный изгиб — у диагоналей (45°). Знак sin(2θ) чередует
    // сторону горба по квадрантам — карта не «косит» в одну сторону.
    const angle = Math.atan2(dy, dx);
    const bend = Math.min(len * 0.18, 42) * Math.sin(2 * angle);
    const nx = -dy / len;
    const ny = dx / len;
    const cx = (pos.x + target.x) / 2 + nx * bend;
    const cy = (pos.y + target.y) / 2 + ny * bend;

    // Начало стрелки — чуть впереди маркера юнита, чтобы не перекрывать его.
    let sx = cx - pos.x;
    let sy = cy - pos.y;
    const sLen = Math.hypot(sx, sy) || 1;
    const START_OFF = 12;
    const x1 = pos.x + (sx / sLen) * START_OFF;
    const y1 = pos.y + (sy / sLen) * START_OFF;

    // Касательная в конце кривой — направление наконечника.
    const ex = target.x - cx;
    const ey = target.y - cy;
    const eLen = Math.hypot(ex, ey) || 1;
    const ux = ex / eLen;
    const uy = ey / eLen;
    const px = -uy;
    const py = ux;

    const headLen = w * 3.2;
    const headHalf = w * 1.35;
    const baseX = target.x - ux * headLen;
    const baseY = target.y - uy * headLen;

    // Цвета: приказ движения — белая стрелка, атаки — красноватая.
    const bodyColor = isAttack
      ? "rgba(255, 96, 96, 0.92)"
      : "rgba(245, 248, 255, 0.92)";
    const dashColor = isAttack
      ? "rgba(255, 190, 190, 0.55)"
      : "rgba(255, 255, 255, 0.55)";
    const outlineColor = isAttack
      ? "rgba(24, 8, 8, 0.85)"
      : "rgba(10, 12, 18, 0.85)";

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. Тёмная окантовка тела.
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, target.x, target.y);
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = w + 3;
    ctx.stroke();

    // 2. Светлое тело.
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, target.x, target.y);
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = w;
    ctx.stroke();

    // 3. «Бегущие» штрихи по телу (фаза разведена по id юнита,
    //    чтобы стрелки группы не пульсировали синхронно).
    const dashPeriod = w * 2.8;
    const flow = (now * 0.06 + (seed % 97) * 13) % dashPeriod;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, target.x, target.y);
    ctx.strokeStyle = dashColor;
    ctx.lineWidth = Math.max(1.5, w * 0.45);
    ctx.setLineDash([w * 1.1, w * 1.7]);
    ctx.lineDashOffset = -flow;
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Наконечник: тёмная подложка + светлый треугольник.
    ctx.beginPath();
    ctx.moveTo(target.x + ux * 1.5, target.y + uy * 1.5);
    ctx.lineTo(
      baseX + px * (headHalf + 1.8),
      baseY + py * (headHalf + 1.8)
    );
    ctx.lineTo(
      baseX - px * (headHalf + 1.8),
      baseY - py * (headHalf + 1.8)
    );
    ctx.closePath();
    ctx.fillStyle = outlineColor;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(baseX + px * headHalf, baseY + py * headHalf);
    ctx.lineTo(baseX - px * headHalf, baseY - py * headHalf);
    ctx.closePath();
    ctx.fillStyle = bodyColor;
    ctx.fill();

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