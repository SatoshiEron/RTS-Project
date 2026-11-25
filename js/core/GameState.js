import Unit, { UNIT_TYPES } from "../entities/Unit.js";
import City from "../entities/City.js";
import CombatSystem from "../systems/CombatSystem.js";
import AISystem from "../systems/ai/AISystem.js";
import DiplomacySystem from "../systems/DiplomacySystem.js";
import {
  BUILDINGS,
  getBuildingEffectsSum,
  getCitySlots,
  provinceHasResource,
} from "../data/buildings.js";

// ============================================================
// ИЗМЕНЕНО: баланс «Время + Население + Manpower v2».
// Все числа новых механик — только здесь.
// ============================================================
export const BALANCE = {
  SECONDS_PER_DAY: 1.0,
  DAYS_PER_YEAR: 360,
  DAYS_PER_MONTH: 30,
  ECONOMY_TICK_DAYS: 7,
  START_YEAR: 1936,
  DEV_SPEED_CONTROL: true,
  POP_SCALE: 12,
  POP_GROWTH_YEARLY: 0.012,
  POP_BONUS_DIVISOR: 12000,
  MOBILIZATION_MAX: 0.30,
  MOBILIZATION_RATE: 0.02,
  MOBILIZATION_INCOME_PENALTY: 0.005,
  WOUNDED_RETURN: 0.15,
  WOUNDED_DELAY_WEEKS: 2,
  MANPOWER_SYSTEM: 'reserve',
};

const ROAD_SPEED_MULTIPLIERS = {
  road: 2,
  rail: 3,
};

// ============================================================
// ИЗМЕНЕНО: единые формулы стоимости действий.
// Используются и игроком (CityPanel), и ИИ (EconomyAI).
// ============================================================
const ACTION_COSTS = {
  recruit: (level) => 20 + level * 5,
  upgrade: (level) => 30 + level * 15,
};

const MAX_CITY_LEVEL = 5;

export default class GameState {
  constructor(world) {
    this.map = world;

    // ИЗМЕНЕНО: доступ к балансу для систем (без циклических импортов).
    this.BALANCE = BALANCE;

    // ===== GRID =====
    this.grid = null;
    this.gridWidth = 0;
    this.gridHeight = 0;

    if (world.grid) {
      this.loadGrid(world.grid);
    }

    // ===== ИНДЕКСЫ =====
    this.pointsById = new Map();
    this.roadsById = new Map();
    this.provincesById = new Map();

    this.buildIndexes();
    this.normalizeGeometry();

    // ===== ОБЪЕКТЫ =====
    this.cities = [];
    this.units = [];
    this.nextUnitId = 1;

    this.playerGold = 100;
    this.aiGold = 100;

    // ИЗМЕНЕНО: ресурсы фракций (общий пул).
    // Пока только накопление и отображение, без трат.
    this.playerOre = 0;
    this.playerGoods = 0;
    this.playerFood = 0;
    this.aiOre = 0;
    this.aiGoods = 0;
    this.aiFood = 0;
    this.economyTimer = 0;
    this.economyInterval = 1.0;

    // ИЗМЕНЕНО: игровой календарь (дни от старта) и расписание тиков
    // (mobilization v2). economyTimer выше — устаревшие поля, не используются.
    this.gameDay = 0;
    this.nextEconomyDay = BALANCE.ECONOMY_TICK_DAYS;
    // День последнего боевого контакта (для мобилизации ИИ).
    this.lastCombatDay = null;

    // ===== ФРАКЦИИ =====
    this.playerId = 1;
    this.aiId = 2;

    // ===== ГИБРИДНАЯ ЭКОНОМИКА =====
    // ИЗМЕНЕНО: единая казна фракции. Локальные бюджеты городов и политики
    // fundingPolicy/treasuryShare упразднены — весь доход идёт в казну,
    // все траты списываются из казны. Осталась только политика призыва.
    // ИЗМЕНЕНО: пул резервистов (mobilization v2).
    this.factionEconomy = {
      [this.playerId]: {
        draftPolicy: 'city',
        // Игрок стартует с базовой мобилизацией 8% (как ИИ), иначе
        // в начале игры призыв невозможен до ручного поднятия ползунка.
        mobilizationTarget: 0.08,
        mobilized: 0.08,
        reservePool: 0,
        pendingWounded: [],
      },
      [this.aiId]: {
        draftPolicy: 'center',
        // ИИ стартует с базовой мобилизацией 8%.
        mobilizationTarget: 0.08,
        mobilized: 0.08,
        reservePool: 0,
        pendingWounded: [],
      },
    };

    // ИЗМЕНЕНО: столицы фракций (id города). Заполняется при старте игры;
    // используется панелью фракции и пригодится для механики захвата столицы.
    this.capitalCityIds = {};

    this.diplomacy = new DiplomacySystem(this);

    // ===== СИСТЕМЫ =====
    this.combat = new CombatSystem(this);
    this.ai = new AISystem(this);

    // ===== ЗАДАЧИ ИИ =====
    this.aiTasks = [];

    this.renderer = null;

    // ===== СОСТОЯНИЕ ИГРЫ =====
    this.running = true;
    this.paused = true;
    this.gameStarted = false;
    this.speedMultiplier = 1.0;

    this.victoryPanel = null;
    this.victoryResolved = false;
    this._victoryCheckTimer = 0;
    this._victoryCheckInterval = 1.0;

    // ===== ВЫДЕЛЕНИЕ =====
    this.selectedUnit = null;
    this.selectedUnits = [];
    this.selectedCity = null;
    this.selectedProvince = null;
    this.selectedPoint = null;

    // ===== ДРАФТ ПРОВИНЦИЙ =====
    this.draft = {
      active: false,
      playerPoints: 0,
      aiPoints: 0,
      currentTurn: 'player',
      pickedProvinceIds: [],
      playerProvinceIds: [],
      aiProvinceIds: [],
    };

    // ИЗМЕНЕНО (Шаг 1): граф дорог для логистики и призыва.
    this.roadGraph = null;
    this._roadGraphDirty = true;

    this.initFromWorld();
  }

  // ============================================================
  // ДИПЛОМАТИЯ
  // ============================================================

  isAtWar(factionA, factionB) {
    return this.diplomacy.isAtWar(factionA, factionB);
  }

  declareWar(factionA, factionB) {
    return this.diplomacy.declareWar(factionA, factionB);
  }

  proposePeace(factionA, factionB) {
    return this.diplomacy.proposePeace(factionA, factionB);
  }

  getDiplomaticRelation(factionA, factionB) {
    return this.diplomacy.getRelation(factionA, factionB);
  }

  // ===== GRID =====

  loadGrid(gridData) {
    if (!gridData) return;

    this.grid = gridData.data;
    this.gridWidth = gridData.width;
    this.gridHeight = gridData.height;

    console.log(`✅ Grid загружен: ${this.gridWidth}x${this.gridHeight}`);
  }

  isWalkable(wx, wy, unit = null) {
    const province = this.getProvinceAt(wx, wy);

    if (province && province.type === "water") {
      if (unit && unit.canSwim) {
        return true;
      }
      // МОСТ: по воде можно, если точка лежит на дороге/жд.
      if (this.isPointOnRoad(wx, wy)) {
        return true;
      }
      return false;
    }

    if (province && unit) {
      const targetOwner = province.owner || 0;

      if (
        targetOwner !== 0 &&
        targetOwner !== unit.owner &&
        !this.isAtWar(unit.owner, targetOwner)
      ) {
        const currentProv = this.getProvinceAt(unit.x, unit.y);
        const currentOwner = currentProv ? (currentProv.owner || 0) : 0;
        const isCurrentlyInForeign =
          currentOwner !== 0 && currentOwner !== unit.owner;

        if (!isCurrentlyInForeign) {
          return false;
        }
      }
    }

    if (!this.grid || this.grid.length === 0) {
      return true;
    }

    if (wx < 0 || wx > 1 || wy < 0 || wy > 1) {
      return false;
    }

    const gx = Math.floor(wx * this.gridWidth);
    const gy = Math.floor(wy * this.gridHeight);

    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return false;
    }

    const idx = gy * this.gridWidth + gx;

    return this.grid[idx] === 1;
  }

  // ===== ПАУЗА =====

  togglePause() {
    this.paused = !this.paused;
    console.log(this.paused ? "⏸ Игра на паузе" : "▶ Игра продолжена");
    return this.paused;
  }

  // ===== РЕГУЛИРОВКА СКОРОСТИ =====

  setSpeed(speed) {
    this.speedMultiplier = Math.max(0.1, Math.min(5.0, speed));
    console.log(`⚡ Скорость игры: ${this.speedMultiplier.toFixed(1)}x`);
  }

  // ===== ИНДЕКСЫ =====

  buildIndexes() {
    for (const p of this.map.points || []) {
      this.pointsById.set(p.id, p);
    }

    for (const r of this.map.roads || []) {
      this.roadsById.set(r.id, r);
    }

    for (const prov of this.map.provinces || []) {
      this.provincesById.set(prov.id, prov);
    }
  }

  // ============================================================
  // ИЗМЕНЕНО (Шаг 1): ГРАФ ДОРОГ
  // ============================================================
  buildRoadGraph() {
    const graph = new Map();

    for (const city of this.cities) {
      graph.set(city.id, new Map());
    }

    const SPEED = { road: 2, rail: 3 };

    for (const road of this.map.roads || []) {
      if (road.type !== 'road' && road.type !== 'rail') continue;
      if (!road.points || road.points.length < 2) continue;

      const start = road.points[0];
      const end = road.points[road.points.length - 1];

      const fromCity = this.getNearestCity(start.x, start.y);
      const toCity = this.getNearestCity(end.x, end.y);

      if (!fromCity || !toCity || fromCity.id === toCity.id) continue;

      let length = 0;
      for (let i = 1; i < road.points.length; i++) {
        length += Math.hypot(
          road.points[i].x - road.points[i - 1].x,
          road.points[i].y - road.points[i - 1].y
        );
      }
      const speed = SPEED[road.type] || 1;
      const weight = length / speed;

      if (!graph.get(fromCity.id).has(toCity.id) ||
          graph.get(fromCity.id).get(toCity.id) > weight) {
        graph.get(fromCity.id).set(toCity.id, weight);
        graph.get(toCity.id).set(fromCity.id, weight);
      }
    }

    this.roadGraph = graph;
    this._roadGraphDirty = false;
    console.log(`🛣️ Граф дорог: ${graph.size} узлов`);
    return graph;
  }

  getNearestCity(x, y, maxDist = 0.05) {
    let best = null, bestDist = maxDist;
    for (const city of this.cities) {
      const d = Math.hypot(city.x - x, city.y - y);
      if (d < bestDist) { bestDist = d; best = city; }
    }
    return best;
  }

  getManpowerDistance(fromCity, toCity) {
    if (!this.roadGraph || this._roadGraphDirty) {
      this.buildRoadGraph();
    }

    if (fromCity.id === toCity.id) return 0;

    const dist = new Map();
    for (const id of this.roadGraph.keys()) dist.set(id, Infinity);
    dist.set(fromCity.id, 0);

    const queue = [fromCity.id];
    const visited = new Set();

    while (queue.length > 0) {
      let minIdx = 0;
      for (let i = 1; i < queue.length; i++) {
        if (dist.get(queue[i]) < dist.get(queue[minIdx])) minIdx = i;
      }
      const current = queue.splice(minIdx, 1)[0];

      if (visited.has(current)) continue;
      visited.add(current);

      if (current === toCity.id) return dist.get(current);

      const neighbors = this.roadGraph.get(current) || new Map();
      for (const [neighbor, weight] of neighbors) {
        const newDist = dist.get(current) + weight;
        if (newDist < dist.get(neighbor)) {
          dist.set(neighbor, newDist);
          queue.push(neighbor);
        }
      }
    }

    return Infinity;
  }

  getPointById(id) {
    return this.pointsById.get(id) || null;
  }

  normalizeGeometry() {
    const getPoint = (id) => this.pointsById.get(id);

    const convertLines = (arr) => {
      if (!arr) return;

      for (const obj of arr) {
        obj.points = (obj.pointIds || [])
          .map(getPoint)
          .filter(Boolean)
          .map((p) => ({ x: p.x, y: p.y }));
      }
    };

    convertLines(this.map.roads);

    if (this.map.rivers) convertLines(this.map.rivers);
    if (this.map.rails) convertLines(this.map.rails);

    if (this.map.provinces) {
      for (const prov of this.map.provinces) {
        if (prov.vertexIds && !prov.vertices) {
          prov.vertices = prov.vertexIds
            .map(getPoint)
            .filter(Boolean)
            .map((p) => ({ x: p.x, y: p.y }));
        }
      }
    }
  }

  getRoadsByType(type) {
    return (this.map.roads || []).filter((r) => r.type === type);
  }

  // ============================================================
  // ПРОВЕРКА БЛИЗОСТИ ТОЧКИ К ЛИНИИ
  // ============================================================

  isPointNearLine(x, y, points, threshold = 0.008) {
    if (!points || points.length < 2) return false;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;

      let t = 0;

      if (lengthSq > 0) {
        t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));
      }

      const closestX = a.x + dx * t;
      const closestY = a.y + dy * t;

      const distanceX = x - closestX;
      const distanceY = y - closestY;
      const distanceSq = distanceX * distanceX + distanceY * distanceY;

      if (distanceSq <= threshold * threshold) {
        return true;
      }
    }

    return false;
  }

  isPointOnRoad(x, y, threshold = 0.010) {
    for (const road of this.map.roads || []) {
      if (road.type !== 'road' && road.type !== 'rail') continue;
      if (!road.points || road.points.length < 2) continue;
      if (this.isPointNearLine(x, y, road.points, threshold)) return true;
    }
    return false;
  }

  _lineCrossesWater(x1, y1, x2, y2, steps = 20) {
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const prov = this.getProvinceAt(
        x1 + (x2 - x1) * t,
        y1 + (y2 - y1) * t
      );
      if (prov && prov.type === 'water') return true;
    }
    return false;
  }

  getMovementSpeedMultiplier(x, y) {
    const roads = this.map.roads || [];
    let best = 1;

    for (const road of roads) {
      const multiplier = ROAD_SPEED_MULTIPLIERS[road.type];

      if (!multiplier || multiplier <= best) continue;

      if (this.isPointNearLine(x, y, road.points, 0.008)) {
        best = multiplier;
      }
    }

    return best;
  }

  // ============================================================
  // МАРШРУТИЗАЦИЯ ПО ДОРОГАМ
  // ============================================================

  getRouteTo(fromX, fromY, toX, toY) {
    const roads = (this.map.roads || []).filter(
      (r) =>
        (r.type === "road" || r.type === "rail") &&
        r.points &&
        r.points.length >= 2
    );

    if (roads.length === 0) return null;

    const directDist = Math.hypot(toX - fromX, toY - fromY);

    if (directDist < 0.03) return null;

    const crossesWater = this._lineCrossesWater(fromX, fromY, toX, toY);
    const threshold = crossesWater ? Infinity : directDist;

    const REACH = 0.12;
    let best = null;

    for (const road of roads) {
      const entry = this.closestPointOnPolyline(fromX, fromY, road.points);
      const exit = this.closestPointOnPolyline(toX, toY, road.points);

      if (!entry || !exit) continue;
      if (entry.dist > REACH || exit.dist > REACH) continue;

      const multiplier = ROAD_SPEED_MULTIPLIERS[road.type] || 1;

      const onRoadDist = this.polylineDistanceBetween(
        road.points,
        entry.segIndex,
        entry.t,
        exit.segIndex,
        exit.t
      );

      const weightedCost = entry.dist + onRoadDist / multiplier + exit.dist;

      if (
        weightedCost < threshold &&
        (!best || weightedCost < best.weightedCost)
      ) {
        best = { road, entry, exit, weightedCost };
      }
    }

    if (!best) return null;

    const waypoints = this.buildRoadWaypoints(
      best.road.points,
      best.entry,
      best.exit
    );

    waypoints.push({ x: toX, y: toY });

    return waypoints;
  }

  closestPointOnPolyline(x, y, points) {
    if (!points || points.length < 2) return null;

    let best = null;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;

      let t = 0;

      if (lengthSq > 0) {
        t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));
      }

      const cx = a.x + dx * t;
      const cy = a.y + dy * t;

      const distSq = (x - cx) * (x - cx) + (y - cy) * (y - cy);

      if (!best || distSq < best.distSq) {
        best = { x: cx, y: cy, segIndex: i, t, distSq };
      }
    }

    if (!best) return null;

    best.dist = Math.sqrt(best.distSq);

    return best;
  }

  polylineDistanceBetween(points, segA, tA, segB, tB) {
    const a = { segIndex: segA, t: tA };
    const b = { segIndex: segB, t: tB };

    const forward = segA < segB || (segA === segB && tA <= tB);

    const start = forward ? a : b;
    const end = forward ? b : a;

    if (start.segIndex === end.segIndex) {
      const p = points[start.segIndex];
      const q = points[start.segIndex + 1];
      const segLen = Math.hypot(q.x - p.x, q.y - p.y);

      return segLen * Math.abs(end.t - start.t);
    }

    let dist = 0;

    {
      const p = points[start.segIndex];
      const q = points[start.segIndex + 1];
      const segLen = Math.hypot(q.x - p.x, q.y - p.y);

      dist += segLen * (1 - start.t);
    }

    for (let i = start.segIndex + 1; i < end.segIndex; i++) {
      const p = points[i];
      const q = points[i + 1];

      dist += Math.hypot(q.x - p.x, q.y - p.y);
    }

    {
      const p = points[end.segIndex];
      const q = points[end.segIndex + 1];
      const segLen = Math.hypot(q.x - p.x, q.y - p.y);

      dist += segLen * end.t;
    }

    return dist;
  }

  buildRoadWaypoints(points, entry, exit) {
    const forward =
      entry.segIndex < exit.segIndex ||
      (entry.segIndex === exit.segIndex && entry.t <= exit.t);

    const waypoints = [{ x: entry.x, y: entry.y }];

    if (entry.segIndex === exit.segIndex) {
      waypoints.push({ x: exit.x, y: exit.y });
      return waypoints;
    }

    if (forward) {
      for (let i = entry.segIndex + 1; i <= exit.segIndex; i++) {
        waypoints.push({ x: points[i].x, y: points[i].y });
      }
    } else {
      for (let i = entry.segIndex; i > exit.segIndex; i--) {
        waypoints.push({ x: points[i].x, y: points[i].y });
      }
    }

    waypoints.push({ x: exit.x, y: exit.y });

    return waypoints;
  }

  // ============================================================
  // ИНИЦИАЛИЗАЦИЯ WORLD
  // ============================================================

  initFromWorld() {
    this.map.provinces = (this.map.provinces || []).sort((a, b) =>
      (b.type === "water" ? 1 : 0) - (a.type === "water" ? 1 : 0)
    );

    for (const prov of this.map.provinces) {
      prov.owner = 0;
      // ИЗМЕНЕНО: нормализация — у провинций всегда есть массив построек.
      if (!Array.isArray(prov.buildings)) prov.buildings = [];
    }

    this.cities = [];

    for (const p of this.map.points || []) {
      if (!p.isCity) continue;

      const prov = this.getProvinceAt(p.x, p.y);
      const provinceId = prov ? prov.id : null;
      const owner = prov ? (prov.owner || 0) : 0;

      const city = new City({
        id: p.id,
        name: p.name || `Город #${p.id}`,
        x: p.x,
        y: p.y,
        type: p.cityType || "city",
        provinceId: provinceId,
        owner: owner,
        // ИЗМЕНЕНО: реалистичное стартовое население (×12).
        population: 12000,
        income: 10,
        level: 1,
      });

      this.cities.push(city);

      if (provinceId) {
        console.log(`🏙️ Город "${city.name}" привязан к провинции #${provinceId}`);
      } else {
        console.log(`⚠️ Город "${city.name}" не принадлежит ни одной провинции`);
      }
    }

    this._roadGraphDirty = true;

    console.log(`🏙️ Загружено городов: ${this.cities.length}`);
    console.log("🎲 Ожидание запуска драфта провинций...");
  }

  // ============================================================
  // ДРАФТ ПРОВИНЦИЙ
  // ============================================================

  startDraft(options = {}) {
    if (this.gameStarted) {
      console.warn("⚠️ Игра уже запущена");
      return { success: false, reason: "Игра уже запущена" };
    }

    if (this.draft.active) {
      console.warn("⚠️ Драфт уже идёт");
      return { success: false, reason: "Драфт уже идёт" };
    }

    const cityProvinces = [];
    const seen = new Set();

    for (const city of this.cities) {
      if (!city.provinceId) continue;
      if (seen.has(city.provinceId)) continue;
      seen.add(city.provinceId);
      cityProvinces.push(city.provinceId);
    }

    if (cityProvinces.length < 2) {
      console.warn("⚠️ Слишком мало провинций с городами для драфта");
      return { success: false, reason: "Мало провинций" };
    }

    for (const city of this.cities) {
      city.owner = 0;
    }
    for (const prov of this.map.provinces || []) {
      prov.owner = 0;
      prov.captureProgress = 0;
    }

    this.units = [];
    this.selectedUnit = null;
    this.selectedUnits = [];
    this.selectedCity = null;
    this.selectedProvince = null;
    this.selectedPoint = null;

    const total = cityProvinces.length;

    const maxPlayer = Math.max(1, Math.ceil(total * 0.5));
    let playerPts;

    if (Number.isFinite(options.playerPts)) {
      playerPts = Math.max(1, Math.min(maxPlayer, Math.floor(options.playerPts)));
    } else {
      playerPts = maxPlayer;
    }

    const aiPts = total - playerPts;

    this.draft = {
      active: true,
      playerPoints: playerPts,
      aiPoints: aiPts,
      currentTurn: 'player',
      pickedProvinceIds: [],
      playerProvinceIds: [],
      aiProvinceIds: [],
      cityProvinces: cityProvinces.slice(),
      maxPlayerPoints: maxPlayer,
    };

    console.log(
      `🎲 Драфт начат. Провинций: ${total}, у игрока: ${playerPts} (макс: ${maxPlayer}), у ИИ: ${aiPts}`
    );

    return {
      success: true,
      total,
      playerPoints: playerPts,
      aiPoints: aiPts,
      maxPlayerPoints: maxPlayer,
    };
  }

  pickProvince(provinceId, factionId) {
    if (!this.draft.active) {
      return { success: false, reason: "Драфт не идёт" };
    }

    if (this.draft.currentTurn !== (factionId === this.playerId ? 'player' : 'ai')) {
      return { success: false, reason: "Не ваш ход" };
    }

    const points = factionId === this.playerId
      ? this.draft.playerPoints
      : this.draft.aiPoints;

    if (points <= 0) {
      return { success: false, reason: "У фракции не осталось очков" };
    }

    const prov = this.provincesById.get(provinceId);
    if (!prov) {
      return { success: false, reason: "Провинция не найдена" };
    }

    if (this.draft.pickedProvinceIds.includes(provinceId)) {
      return { success: false, reason: "Уже выбрана" };
    }

    if (!this.draft.cityProvinces.includes(provinceId)) {
      return { success: false, reason: "Недоступна для выбора" };
    }

    prov.owner = factionId;

    for (const city of this.cities) {
      if (city.provinceId === provinceId) {
        city.owner = factionId;
      }
    }

    this.draft.pickedProvinceIds.push(provinceId);

    if (factionId === this.playerId) {
      this.draft.playerProvinceIds.push(provinceId);
      this.draft.playerPoints--;
    } else {
      this.draft.aiProvinceIds.push(provinceId);
      this.draft.aiPoints--;
    }

    this.draft.currentTurn = factionId === this.playerId ? 'ai' : 'player';

    if (this.draft.playerPoints === 0 && this.draft.aiPoints === 0) {
      this.finishDraft();
    }

    console.log(
      `🎲 ${factionId === this.playerId ? 'Игрок' : 'ИИ'} выбрал провинцию #${provinceId}. ` +
      `Осталось: игрок ${this.draft.playerPoints}, ИИ ${this.draft.aiPoints}`
    );

    return {
      success: true,
      province: prov,
      nextTurn: this.draft.currentTurn,
      playerPoints: this.draft.playerPoints,
      aiPoints: this.draft.aiPoints,
    };
  }

  aiDraftTurn() {
    if (!this.draft.active) return null;
    if (this.draft.currentTurn !== 'ai') return null;
    if (this.draft.aiPoints <= 0) return null;

    const available = this.draft.cityProvinces.filter(
      (id) => !this.draft.pickedProvinceIds.includes(id)
    );

    if (available.length === 0) return null;

    const getCenter = (provId) => {
      const prov = this.provincesById.get(provId);
      if (!prov) return null;
      if (prov.center) return prov.center;
      if (!prov.vertices || prov.vertices.length === 0) return null;
      let sx = 0, sy = 0;
      for (const v of prov.vertices) { sx += v.x; sy += v.y; }
      return { x: sx / prov.vertices.length, y: sy / prov.vertices.length };
    };

    let chosen = null;

    if (this.draft.aiProvinceIds.length === 0) {
      const playerCities = this.cities.filter((c) => c.owner === this.playerId);
      if (playerCities.length === 0) {
        chosen = available[0];
      } else {
        let best = null, bestD = -1;
        for (const id of available) {
          const c = getCenter(id);
          if (!c) continue;
          const d = Math.min(...playerCities.map((pc) => Math.hypot(pc.x - c.x, pc.y - c.y)));
          if (d > bestD) { bestD = d; best = id; }
        }
        chosen = best || available[0];
      }
    } else {
      let best = null, bestD = Infinity;
      const aiCenters = this.draft.aiProvinceIds.map(getCenter).filter(Boolean);
      for (const id of available) {
        const c = getCenter(id);
        if (!c) continue;
        const d = Math.min(...aiCenters.map((ac) => Math.hypot(ac.x - c.x, ac.y - c.y)));
        if (d < bestD) { bestD = d; best = id; }
      }
      chosen = best || available[0];
    }

    if (!chosen) return null;

    return this.pickProvince(chosen, this.aiId);
  }

  giveUpDraft() {
    if (!this.draft.active) return { success: false, reason: 'Драфт не идёт' };
    if (this.draft.currentTurn !== 'player') {
      return { success: false, reason: 'Сейчас не ваш ход' };
    }
    if (this.draft.playerPoints <= 0) {
      return { success: false, reason: 'У вас не осталось провинций' };
    }

    this.draft.currentTurn = 'ai';
    console.log('⏭ Игрок пропустил ход — ходит ИИ');
    return { success: true };
  }

  reclaimDraft() {
    if (!this.draft.active) return { success: false, reason: 'Драфт не идёт' };
    if (this.draft.currentTurn !== 'ai') {
      return { success: false, reason: 'Сейчас не ход ИИ' };
    }
    if (this.draft.aiPoints <= 0) {
      return { success: false, reason: 'ИИ уже доиграл' };
    }

    this.draft.currentTurn = 'player';
    console.log('↩️ Игрок вернул ход');
    return { success: true };
  }

  finishDraft() {
    if (!this.draft.active) return { success: false };

    for (const prov of this.map.provinces || []) {
      if (prov.owner !== 0) continue;
      if (!prov.vertices || prov.vertices.length < 3) continue;

      let cx = 0, cy = 0;
      for (const v of prov.vertices) { cx += v.x; cy += v.y; }
      cx /= prov.vertices.length;
      cy /= prov.vertices.length;

      let bestCity = null, bestD = Infinity;
      for (const city of this.cities) {
        if (city.owner === 0) continue;
        const d = Math.hypot(city.x - cx, city.y - cy);
        if (d < bestD) { bestD = d; bestCity = city; }
      }

      if (bestCity) {
        prov.owner = bestCity.owner;
      }
    }

    const playerCities = this.cities.filter((c) => c.owner === this.playerId);
    const aiCities = this.cities.filter((c) => c.owner === this.aiId);

    if (playerCities.length > 0) {
      const capital = playerCities[0];
      this.capitalCityIds[this.playerId] = capital.id;
      this.spawnUnit({
        owner: this.playerId,
        x: capital.x,
        y: capital.y,
        speed: 0.05,
        hp: 100,
        role: "infantry",
      });
      console.log(`👤 Столица игрока: "${capital.name}"`);
    }

    if (aiCities.length > 0) {
      const capital = aiCities[0];
      this.capitalCityIds[this.aiId] = capital.id;
      this.spawnUnit({
        owner: this.aiId,
        x: capital.x,
        y: capital.y,
        speed: 0.04,
        hp: 100,
        role: "infantry",
      });
      console.log(`🤖 Столица ИИ: "${capital.name}"`);
    }

    this.draft.active = false;
    this.gameStarted = true;
    this.paused = false;

    if (this.renderer && this.renderer.markTerritoryDirty) {
      this.renderer.markTerritoryDirty();
    }

    this._roadGraphDirty = true;

    console.log("▶ Драфт завершён. Игра началась!");

    return { success: true, playerCities, aiCities };
  }

  // ===== СПАВН ЮНИТА =====

  spawnUnit({
    owner,
    x,
    y,
    type = 'infantry',
    speed,
    hp,
    attack,
    defense,
    vision,
    provinceId = null,
    role = "infantry",
  }) {
    const id = this.nextUnitId++;

    const unit = new Unit({
      id,
      owner,
      x,
      y,
      type,
      speed,
      hp,
      attack,
      defense,
      vision,
      provinceId,
      role,
    });

    unit.gameRef = this;

    // ИЗМЕНЕНО: численность формирования (mobilization v2):
    // 100 человек на «очко» призыва типа.
    unit.maxMen = this.getRecruitManpower(type) * 100;
    unit.men = unit.maxMen;

    this.units.push(unit);

    return unit;
  }

  // ===== ЗАХВАТ ГОРОДА =====

  tryCaptureCity(unit) {
    if (!unit || !unit.isAlive()) return false;

    const city = this.getCityAt(unit.x, unit.y, 0.02);

    if (!city) {
      unit.lastCityId = null;
      return false;
    }

    if (city.owner === unit.owner) {
      unit.lastCityId = city.id;
      return false;
    }

    if (unit.lastCityId === city.id) {
      return false;
    }

    const enemies = this.units.filter(
      (u) =>
        u.owner !== unit.owner &&
        u.isAlive() &&
        Math.hypot(u.x - city.x, u.y - city.y) < 0.02
    );

    if (enemies.length > 0) {
      return false;
    }

    city.owner = unit.owner;

    // ИЗМЕНЕНО: manpower обнуляется, resources остаются.
    city.manpower = 0;

    if (city.hp <= 0) {
      city.hp = city.maxHp * 0.5;
    }

    unit.lastCityId = city.id;

    if (city.provinceId) {
      const prov = this.provincesById.get(city.provinceId);
      if (prov) prov.owner = unit.owner;
    }

    if (this.renderer && this.renderer.markTerritoryDirty) {
      this.renderer.markTerritoryDirty();
    }

    this._roadGraphDirty = true;

    console.log(`🏙️ Город "${city.name}" захвачен юнитом #${unit.id}`);

    return true;
  }

  // ===== ЗАДАЧИ ДЛЯ ИИ =====

  addAITask(task) {
    task.id = this.aiTasks.length + 1;
    task.assignedUnits = task.assignedUnits || 0;
    task.maxUnits = task.maxUnits || 3;
    task.completed = false;
    this.aiTasks.push(task);
  }

  clearCompletedTasks() {
    this.aiTasks = this.aiTasks.filter((t) => !t.completed);
  }

  // ===== ЭКОНОМИКА =====

  getCityIncome(city) {
    const base = (city.level || 1) * 2;
    // ИЗМЕНЕНО: бонус населения считается от реалистичной численности.
    const popBonus = Math.floor((city.population || 0) / BALANCE.POP_BONUS_DIVISOR);
    let income = base + popBonus;

    if (city.provinceId) {
      const prov = this.provincesById.get(city.provinceId);

      if (prov) {
        if (prov.owner === city.owner) {
          income = Math.floor(income * 1.2);
        } else if (prov.owner !== 0 && prov.owner !== city.owner) {
          income = Math.floor(income * 0.8);
        }
      }
    }

    // ИЗМЕНЕНО: мобилизация снижает доход города
    // (множитель 1 − mobilized% × MOBILIZATION_INCOME_PENALTY).
    const eco = this.getFactionEconomy(city.owner);
    if (eco && eco.mobilized > 0) {
      income = Math.floor(
        income * (1 - eco.mobilized * 100 * BALANCE.MOBILIZATION_INCOME_PENALTY)
      );
    }

    // ИЗМЕНЕНО: постройки города (рынок/завод) — ×(1 + Σ incomeMult).
    const buildingsMult = 1 + getBuildingEffectsSum(city, 'incomeMult');
    if (buildingsMult !== 1) {
      income = Math.floor(income * buildingsMult);
    }

    return income;
  }

  getCityResourceProduction(city) {
    const t = city.type || 'city';

    const result = {
      ore: 0,
      goods: 0,
      food: 0,
      gold: 0,
    };

    switch (t) {
      case 'farm':
        result.food = 2;
        result.gold = 1;
        break;

      case 'mine':
        result.ore = 2;
        result.gold = 1;
        break;

      case 'factory':
        result.goods = 2;
        result.gold = 1;
        break;

      case 'trade':
        result.gold = 3;
        break;

      case 'port':
        result.gold = 2;
        if (this.isCityNearWater(city)) {
          result.gold += 1;
        }
        break;

      case 'airfield':
        result.gold = 1;
        break;

      case 'city':
      default:
        result.gold = 1;
        break;
    }

    return result;
  }

  isCityNearWater(city, radius = 0.05) {
    const waterProvinces = (this.map.provinces || []).filter(p => p.type === 'water');

    for (const wp of waterProvinces) {
      if (!wp.vertices || wp.vertices.length < 3) continue;

      for (const v of wp.vertices) {
        if (Math.hypot(v.x - city.x, v.y - city.y) < radius) return true;
      }

      if (pointInPolygon({ x: city.x, y: city.y }, wp.vertices)) return true;
    }

    return false;
  }

  getFactionEconomy(factionId) {
    return this.factionEconomy?.[factionId] || null;
  }

  // ============================================================
  // ИЗМЕНЕНО (Шаг 1): политика призыва.
  // ============================================================
  getDraftPolicy(factionId) {
    const eco = this.getFactionEconomy(factionId);
    return eco ? (eco.draftPolicy || 'city') : 'city';
  }

  setDraftPolicy(factionId, policy) {
    if (policy !== 'city' && policy !== 'center') return;
    const eco = this.getFactionEconomy(factionId);
    if (!eco) return;
    eco.draftPolicy = policy;
  }

  // ИЗМЕНЕНО (Шаг 1): суммарный резерв manpower фракции.
  getFactionManpower(factionId) {
    let total = 0;
    let max = 0;
    for (const city of this.cities) {
      if (city.owner !== factionId) continue;
      total += city.manpower || 0;
      max += city.manpowerMax || 0;
    }
    return { total: Math.floor(total), max: Math.floor(max) };
  }

  // ИЗМЕНЕНО: столица фракции. Возвращает объект города или null,
  // если столица ещё не назначена. Флаг «потеряна» проверяется по owner.
  getCapital(factionId) {
    const id = this.capitalCityIds ? this.capitalCityIds[factionId] : null;
    if (id == null) return null;
    return this.cities.find((c) => c.id === id) || null;
  }

  // ============================================================
  // ИЗМЕНЕНО (Шаг 2): стоимость найма в «людях».
  // ============================================================
  getRecruitManpower(type) {
    const costs = {
      militia: 4,
      infantry: 6,
      motorized: 5,
      armored: 4,
      artillery: 4,
      marines: 5,
    };
    return costs[type] || 6;
  }

  // ============================================================
  // ИЗМЕНЕНО (Шаг 2): план списания «людей» для найма.
  // Атомарно: либо план, либо null.
  // ============================================================
  planDraft(city, need) {
    if (!city || need <= 0) return [];
    if (!this.gameStarted) return null;

    const policy = this.getDraftPolicy(city.owner);
    const radius = 0.3;   // DRAFT_RADIUS

    let candidates = [city];

    if (policy === 'center') {
      const own = this.cities.filter(c => c.owner === city.owner && c !== city);
      const withDist = own.map(c => ({
        city: c,
        dist: this.getManpowerDistance(city, c),
      })).filter(x => x.dist <= radius);

      withDist.sort((a, b) => a.dist - b.dist);
      candidates = [city, ...withDist.map(x => x.city)];
    }

    const plan = [];
    let left = need;

    for (const c of candidates) {
      if (left <= 1e-9) break;

      const avail = (typeof c.getAvailableManpower === 'function')
        ? c.getAvailableManpower()
        : Math.max(0, (c.manpower || 0) - (c.manpowerMax || 0) * 0.2);

      const take = Math.min(avail, left);
      if (take > 0) {
        plan.push({ city: c, amount: take });
        left -= take;
      }
    }

    if (left > 1e-9) return null;
    return plan;
  }

  applyDraftPlan(plan) {
    if (!Array.isArray(plan)) return;
    for (const { city, amount } of plan) {
      city.manpower = Math.max(0, (city.manpower || 0) - amount);
    }
  }

  // ИЗМЕНЕНО: прозрачная разбивка дохода города (для UI).
  getCityIncomeBreakdown(city) {
    const base = (city.level || 1) * 2;
    // ИЗМЕНЕНО: тот же делитель, что и в getCityIncome.
    const popBonus = Math.floor((city.population || 0) / BALANCE.POP_BONUS_DIVISOR);

    let mult = 1;
    let provinceMod = '×1.0';

    if (city.provinceId) {
      const prov = this.provincesById.get(city.provinceId);
      if (prov) {
        if (prov.owner === city.owner) {
          mult = 1.2;
          provinceMod = '×1.2 (своя провинция)';
        } else if (prov.owner !== 0 && prov.owner !== city.owner) {
          mult = 0.8;
          provinceMod = '×0.8 (чужая провинция)';
        }
      }
    }

    // ИЗМЕНЕНО: множитель построек города (рынок/завод) — для разбивки в UI.
    const buildingsMult = 1 + getBuildingEffectsSum(city, 'incomeMult');

    return {
      base,
      popBonus,
      mult,
      provinceMod,
      buildingsMult,
      buildingsMod: buildingsMult !== 1 ? `×${buildingsMult.toFixed(2)} (постройки)` : '—',
      income: this.getCityIncome(city),
    };
  }

  getRecruitCostForType(city, type) {
    const stats = UNIT_TYPES[type];
    if (!stats) return this.getRecruitCost(city);
    // ИЗМЕНЕНО: казармы дают скидку −15% к призыву в этом городе.
    const discount = city ? getBuildingEffectsSum(city, 'recruitDiscount') : 0;
    return Math.round(stats.cost * (1 - discount));
  }

  // ============================================================
  // ИЗМЕНЕНО: строительство, фаза 1 (каталог — js/data/buildings.js).
  // Постройка мгновенная; время строительства — фаза 2.
  // ============================================================

  getCitySlots(city) {
    return getCitySlots(city.level || 1);
  }

  // Сумма reserveGrowthMult по городам фракции (эффект казарм).
  reserveGrowthMultTotal(factionId) {
    let sum = 0;
    for (const city of this.cities) {
      if (city.owner === factionId) {
        sum += getBuildingEffectsSum(city, 'reserveGrowthMult');
      }
    }
    return sum;
  }

  // +N к гарнизону города от построек (укрепления).
  getGarrisonBonus(city) {
    return city ? getBuildingEffectsSum(city, 'garrisonBonus') : 0;
  }

  canAffordBuilding(buildingId, target) {
    const b = BUILDINGS[buildingId];
    if (!b) return { ok: false, reason: 'no_such_building' };

    const isCity = !!(target && typeof target.level === 'number' && target.maxHp);

    if (b.scope === 'city') {
      if (!isCity) return { ok: false, reason: 'not_city' };
      if (!target.buildings) target.buildings = [];
      if (target.buildings.includes(buildingId)) return { ok: false, reason: 'already_built' };
      if (target.buildings.length >= this.getCitySlots(target)) {
        return { ok: false, reason: 'no_slots' };
      }
      const gold = target.owner === this.playerId ? this.playerGold : this.aiGold;
      if (gold < b.cost) return { ok: false, reason: 'not_enough_gold', cost: b.cost, gold };
      return { ok: true, cost: b.cost };
    }

    // scope === 'province'
    if (isCity) return { ok: false, reason: 'not_province' };
    if (!target || target.owner === 0 || target.owner === undefined) {
      return { ok: false, reason: 'no_owner' };
    }
    if (!target.buildings) target.buildings = [];
    if (target.buildings.includes(buildingId)) return { ok: false, reason: 'already_built' };
    if (b.requires && !provinceHasResource(target, b.requires)) {
      return { ok: false, reason: 'no_resource', requires: b.requires };
    }
    const gold = target.owner === this.playerId ? this.playerGold : this.aiGold;
    if (gold < b.cost) return { ok: false, reason: 'not_enough_gold', cost: b.cost, gold };
    return { ok: true, cost: b.cost };
  }

  tryBuild(buildingId, target) {
    const check = this.canAffordBuilding(buildingId, target);
    if (!check.ok) return { ok: false, ...check };

    const b = BUILDINGS[buildingId];

    // Списание из единой казны владельца.
    if (target.owner === this.playerId) {
      this.playerGold -= b.cost;
    } else {
      this.aiGold -= b.cost;
    }

    target.buildings.push(buildingId);

    // Укрепления: растёт только макс. прочность; текущее hp не трогаем.
    if (b.effects.hpMult) {
      target.maxHp = Math.round(target.maxHp * (1 + b.effects.hpMult));
    }

    console.log(
      `🏗️ Построено: ${b.icon} ${b.name} ` +
      `(владелец ${target.owner === this.playerId ? '👤' : '🤖'}, −${b.cost}💰)`
    );

    return { ok: true, cost: b.cost };
  }

  canCityRecruitType(city, type) {
    const stats = UNIT_TYPES[type];
    if (!stats) return false;
    if (!Array.isArray(stats.allowedCityTypes)) return false;
    return stats.allowedCityTypes.includes(city.type);
  }

  getAvailableUnitTypes(city) {
    return Object.keys(UNIT_TYPES).filter(t =>
      this.canCityRecruitType(city, t)
    );
  }

  getRecruitCost(city) {
    return ACTION_COSTS.recruit(city.level || 1);
  }

  getUpgradeCost(city) {
    return ACTION_COSTS.upgrade(city.level || 1);
  }

  getMaxCityLevel() {
    return MAX_CITY_LEVEL;
  }

  canUpgradeCity(city) {
    return (city.level || 1) < MAX_CITY_LEVEL;
  }

  // ИЗМЕНЕНО: единая казна — бюджет действий всегда золото фракции.
  getActionBudgetSource(city) {
    return 'center';
  }

  // ============================================================
  // ИЗМЕНЕНО (Шаг 2): getActionCost возвращает объект с manpower.
  // ============================================================
  getActionCost(city, action, type = 'infantry') {
    if (action === 'recruit') {
      return {
        gold: this.getRecruitCostForType(city, type),
        manpower: this.getRecruitManpower(type),
        ore: (UNIT_TYPES[type]?.oreCost) || 0,
        goods: (UNIT_TYPES[type]?.goodsCost) || 0,
        food: (UNIT_TYPES[type]?.foodCost) || 0,
      };
    }
    if (action === 'upgrade') {
      return {
        gold: this.getUpgradeCost(city),
        manpower: 0,
        ore: 0, goods: 0, food: 0,
      };
    }
    return { gold: 0, manpower: 0, ore: 0, goods: 0, food: 0 };
  }

  // ============================================================
  // ИЗМЕНЕНО (Шаг 2): canAffordAction с учётом manpower.
  // ============================================================
  canAffordAction(city, action, type = 'infantry') {
    const cost = this.getActionCost(city, action, type);

    // Единая казна: всегда золото фракции.
    const goldBudget =
      city.owner === this.playerId ? this.playerGold : this.aiGold;

    const goldOk = goldBudget >= (cost.gold || 0);

    let manpowerOk = true;
    let manpowerPlan = null;

    if (action === 'recruit' && cost.manpower > 0) {
      if (BALANCE.MANPOWER_SYSTEM === 'reserve') {
        // ИЗМЕНЕНО: призыв из пула резервистов (v2).
        const eco = this.getFactionEconomy(city.owner);
        const need = cost.manpower * 100;
        manpowerOk = !!eco && eco.reservePool >= need;
      } else {
        // Ветка 'local' — прежний план списания по городам.
        manpowerPlan = this.planDraft(city, cost.manpower);
        manpowerOk = manpowerPlan !== null;
      }
    }

    return {
      ok: goldOk && manpowerOk,
      cost: cost.gold,
      budget: goldBudget,
      source: 'center',
      goldOk, manpowerOk,
      manpowerNeed: cost.manpower,
      manpowerPlan,
    };
  }

  payForAction(city, action, type = 'infantry') {
    const check = this.canAffordAction(city, action, type);
    if (!check.ok) return { ok: false, ...check };

    const { cost } = check;

    // Единая казна: списание только с золота фракции.
    if (city.owner === this.playerId) {
      this.playerGold -= cost;
    } else if (city.owner === this.aiId) {
      this.aiGold -= cost;
    }

    return { ok: true, cost, source: 'center', budget: check.budget - cost };
  }

  canAffordResources(factionId, costs) {
    const ore = costs.ore || 0;
    const goods = costs.goods || 0;
    const food = costs.food || 0;

    const haveOre = factionId === this.playerId ? this.playerOre : this.aiOre;
    const haveGoods = factionId === this.playerId ? this.playerGoods : this.aiGoods;
    const haveFood = factionId === this.playerId ? this.playerFood : this.aiFood;

    const missing = {
      ore: Math.max(0, ore - haveOre),
      goods: Math.max(0, goods - haveGoods),
      food: Math.max(0, food - haveFood),
    };

    const ok = missing.ore === 0 && missing.goods === 0 && missing.food === 0;

    return { ok, missing, have: { ore: haveOre, goods: haveGoods, food: haveFood } };
  }

  spendResources(factionId, costs) {
    const ore = costs.ore || 0;
    const goods = costs.goods || 0;
    const food = costs.food || 0;

    if (factionId === this.playerId) {
      this.playerOre = Math.max(0, this.playerOre - ore);
      this.playerGoods = Math.max(0, this.playerGoods - goods);
      this.playerFood = Math.max(0, this.playerFood - food);
    } else if (factionId === this.aiId) {
      this.aiOre = Math.max(0, this.aiOre - ore);
      this.aiGoods = Math.max(0, this.aiGoods - goods);
      this.aiFood = Math.max(0, this.aiFood - food);
    }
  }

  // ============================================================
  // ИЗМЕНЕНО (Шаг 2): tryRecruitUnit — атомарно с manpower.
  // ============================================================
  tryRecruitUnit(city, type = 'infantry') {
    if (!city || city.owner === 0) {
      return { ok: false, reason: 'city_not_owned' };
    }
    if (!this.canCityRecruitType(city, type)) {
      return { ok: false, reason: 'type_not_allowed' };
    }

    const stats = UNIT_TYPES[type];
    if (!stats) return { ok: false, reason: 'unknown_type' };

    const oreCost = stats.oreCost || 0;
    const goodsCost = stats.goodsCost || 0;
    const foodCost = stats.foodCost || 0;
    const manpowerNeed = this.getRecruitManpower(type);

    // 1. Проверка ресурсов (ore/goods/food).
    const resCheck = this.canAffordResources(city.owner, {
      ore: oreCost, goods: goodsCost, food: foodCost,
    });
    if (!resCheck.ok) {
      return {
        ok: false, reason: 'not_enough_resources',
        missing: resCheck.missing, cost: stats.cost,
      };
    }

    // 2. Проверка людей.
    const isReserve = BALANCE.MANPOWER_SYSTEM === 'reserve';
    let draftPlan = null;

    if (isReserve) {
      // ИЗМЕНЕНО: призыв из пула резервистов (v2).
      const eco = this.getFactionEconomy(city.owner);
      const need = manpowerNeed * 100;
      if (!eco || eco.reservePool < need) {
        return {
          ok: false, reason: 'manpower',
          needed: need,
          pool: eco ? Math.floor(eco.reservePool) : 0,
          cost: stats.cost,
        };
      }
    } else {
      // Ветка 'local' — прежний план списания по городам.
      draftPlan = this.planDraft(city, manpowerNeed);
      if (!draftPlan) {
        return {
          ok: false, reason: 'not_enough_manpower',
          needed: manpowerNeed,
          cost: stats.cost,
          policy: this.getDraftPolicy(city.owner),
        };
      }
    }

    // 3. Проверка и списание золота.
    const pay = this.payForAction(city, 'recruit', type);
    if (!pay.ok) {
      return { ok: false, reason: 'not_enough_funds', ...pay };
    }

    // 4. Списание ресурсов.
    this.spendResources(city.owner, {
      ore: oreCost, goods: goodsCost, food: foodCost,
    });

    // 5. Списание людей.
    if (isReserve) {
      // ИЗМЕНЕНО: призыв из пула резервистов (v2).
      const eco = this.getFactionEconomy(city.owner);
      eco.reservePool -= manpowerNeed * 100;
    } else {
      // Ветка 'local' — списание по плану по городам.
      this.applyDraftPlan(draftPlan);
    }

    // 6. Создание юнита.
    const unit = this.spawnUnit({
      owner: city.owner,
      x: city.x + (Math.random() - 0.5) * 0.005,
      y: city.y + (Math.random() - 0.5) * 0.005,
      type,
    });

    // 7. Лог.
    const resStr = [
      oreCost > 0 ? `🪨 ${oreCost}` : '',
      goodsCost > 0 ? `📦 ${goodsCost}` : '',
      foodCost > 0 ? `🌾 ${foodCost}` : '',
    ].filter(Boolean).join(' ');

    const draftStr = isReserve
      ? `пул −${manpowerNeed * 100}`
      : draftPlan
          .map(p => `${p.city.name} −${p.amount}`)
          .join(', ');

    console.log(
      `⚔️ Нанят ${unit.typeName} #${unit.id} в "${city.name}" ` +
      `(${pay.cost}💰 + ${manpowerNeed}👥 [${draftStr}]` +
      `${resStr ? ' + ' + resStr : ''} из казны)`
    );

    return {
      ok: true, unit, cost: pay.cost, source: pay.source,
      draftPlan, manpowerSpent: manpowerNeed,
      reserveSpent: isReserve ? manpowerNeed * 100 : 0,
    };
  }

  tryUpgradeCity(city) {
    if (!city || city.owner === 0) {
      return { ok: false, reason: 'city_not_owned' };
    }

    if (!this.canUpgradeCity(city)) {
      return { ok: false, reason: 'max_level' };
    }

    const pay = this.payForAction(city, 'upgrade');
    if (!pay.ok) {
      return { ok: false, reason: 'not_enough_funds', ...pay };
    }

    city.level += 1;
    city.population *= 1.1;
    city.defense = (city.defense || 20) + 5;

    console.log(
      `⬆️ "${city.name}" улучшен до ${city.level} уровня ` +
      `(${pay.cost}💰 из ${pay.source === 'city' ? 'города' : 'казны'})`
    );

    return {
      ok: true,
      cost: pay.cost,
      source: pay.source,
      newLevel: city.level,
    };
  }

  getNetIncome(ownerId) {
    let income = 0;
    let upkeep = 0;

    for (const city of this.cities) {
      if (city.owner === ownerId) {
        income += this.getCityIncome(city);
      }
    }

    for (const prov of this.map.provinces || []) {
      if (prov.owner === ownerId && prov.vertices && prov.vertices.length >= 3) {
        income += 5;
      }
    }

    for (const unit of this.units) {
      if (unit.owner === ownerId && unit.isAlive()) {
        upkeep += 1;
      }
    }

    // ИЗМЕНЕНО: экономический цикл = неделя (ECONOMY_TICK_DAYS),
    // значения приведены к недельному темпу, как в updateEconomy().
    const TICK = BALANCE.ECONOMY_TICK_DAYS;
    return { income: income * TICK, upkeep: upkeep * TICK, net: (income - upkeep) * TICK };
  }

  // ИЗМЕНЕНО: экономический тик — раз в неделю (ECONOMY_TICK_DAYS дней).
  // Все суммы ×7, чтобы недельный темп соответствовал прежнему
  // посекундному (1 игровой секунда = 1 дню).
  updateEconomy() {
    const TICK = BALANCE.ECONOMY_TICK_DAYS;

    // Рост населения — годовой темп, раз в неделю.
    for (const city of this.cities) {
      if (city.owner === 0) continue;

      city.population *=
        (1 + BALANCE.POP_GROWTH_YEARLY * BALANCE.ECONOMY_TICK_DAYS / BALANCE.DAYS_PER_YEAR);

      if (typeof city.updateManpower === 'function') {
        city.updateManpower();
      }
    }

    // ===== 1. ГОРОДСКОЙ ДОХОД → КАЗНА ФРАКЦИИ =====
    // ИЗМЕНЕНО: единая казна — весь доход города целиком.
    for (const city of this.cities) {
      if (city.owner === 0) continue;

      const income = this.getCityIncome(city) * TICK;

      if (city.owner === this.playerId) {
        this.playerGold += income;
      } else if (city.owner === this.aiId) {
        this.aiGold += income;
      }

      const res = this.getCityResourceProduction(city);

      if (city.owner === this.playerId) {
        this.playerOre += res.ore * TICK;
        this.playerGoods += res.goods * TICK;
        this.playerFood += res.food * TICK;
        if (res.gold > 0) {
          this.playerGold += res.gold * TICK;
        }
      } else if (city.owner === this.aiId) {
        this.aiOre += res.ore * TICK;
        this.aiGoods += res.goods * TICK;
        this.aiFood += res.food * TICK;
        if (res.gold > 0) {
          this.aiGold += res.gold * TICK;
        }
      }
    }

    for (const prov of this.map.provinces || []) {
      if (!prov.vertices || prov.vertices.length < 3) continue;

      // ИЗМЕНЕНО: водные провинции дохода не дают (фикс: порт, нанесённый
      // на воду в редакторе карт, больше не приносит +5 в казну).
      const provIncome = (prov.owner !== 0 && prov.type !== 'water') ? 5 * TICK : 0;

      if (prov.owner === this.playerId) {
        this.playerGold += provIncome;
      } else if (prov.owner === this.aiId) {
        this.aiGold += provIncome;
      }
    }

    // ===== 2. ПОСТРОЙКИ (фаза 1) =====
    // Фермы/шахты провинций и заводы городов. Значения эффектов — уже
    // недельные, НЕ умножаем на TICK.
    for (const prov of this.map.provinces || []) {
      if (prov.owner !== this.playerId && prov.owner !== this.aiId) continue;

      const food = getBuildingEffectsSum(prov, 'foodPerWeek');
      const ore = getBuildingEffectsSum(prov, 'orePerWeek');
      if (!food && !ore) continue;

      if (prov.owner === this.playerId) {
        this.playerFood += food;
        this.playerOre += ore;
      } else {
        this.aiFood += food;
        this.aiOre += ore;
      }
    }

    for (const city of this.cities) {
      if (city.owner !== this.playerId && city.owner !== this.aiId) continue;
      const goods = getBuildingEffectsSum(city, 'goodsPerWeek');
      if (!goods) continue;
      if (city.owner === this.playerId) this.playerGoods += goods;
      else this.aiGoods += goods;
    }

    const playerUnits = this.units.filter(
      (u) => u.owner === this.playerId && u.isAlive()
    );
    const aiUnits = this.units.filter(
      (u) => u.owner === this.aiId && u.isAlive()
    );

    this.playerGold -= playerUnits.length * TICK;
    this.aiGold -= aiUnits.length * TICK;

    if (this.playerGold < 0) this.playerGold = 0;
    if (this.aiGold < 0) this.aiGold = 0;
  }

  // ============================================================
  // ИЗМЕНЕНО: мобилизация и пул резервистов (v2).
  // ============================================================

  isReserveSystem() {
    return BALANCE.MANPOWER_SYSTEM === 'reserve';
  }

  totalPopulation(factionId) {
    let total = 0;
    for (const city of this.cities) {
      if (city.owner === factionId) total += city.population || 0;
    }
    return total;
  }

  servingMen(factionId) {
    let total = 0;
    for (const unit of this.units) {
      if (unit.owner === factionId && unit.isAlive()) {
        total += unit.men || 0;
      }
    }
    return total;
  }

  // Недельный тик мобилизации: доля догоняет цель, пул — целевой размер.
  updateMobilization(factionId) {
    const eco = this.getFactionEconomy(factionId);
    if (!eco) return;

    eco.mobilized +=
      (eco.mobilizationTarget - eco.mobilized) * BALANCE.MOBILIZATION_RATE;
    if (Math.abs(eco.mobilizationTarget - eco.mobilized) < 0.0005) {
      eco.mobilized = eco.mobilizationTarget;
    }

    const totalPop = this.totalPopulation(factionId);
    const serving = this.servingMen(factionId);
    const targetPool = Math.max(0, eco.mobilized * totalPop - serving);

    // ИЗМЕНЕНО: казармы ускоряют прирост резервного пула ×(1 + Σ эффектов).
    const growthMult = 1 + this.reserveGrowthMultTotal(factionId);
    eco.reservePool += (targetPool - eco.reservePool) * BALANCE.MOBILIZATION_RATE * growthMult;
    if (eco.reservePool < 0) eco.reservePool = 0;

    // Созревшие раненые возвращаются в пул.
    for (let i = eco.pendingWounded.length - 1; i >= 0; i--) {
      const w = eco.pendingWounded[i];
      if (w.dueDay <= this.gameDay) {
        eco.reservePool += w.amount;
        eco.pendingWounded.splice(i, 1);
      }
    }
  }

  setMobilization(factionId, value) {
    const eco = this.getFactionEconomy(factionId);
    if (!eco) return;
    const v = Math.max(0, Math.min(BALANCE.MOBILIZATION_MAX, Number(value) || 0));
    eco.mobilizationTarget = v;
  }

  getReserveInfo(factionId) {
    const eco = this.getFactionEconomy(factionId);
    if (!eco) {
      return { target: 0, mobilized: 0, pool: 0, serving: 0, totalPopulation: 0, incomePenalty: 0 };
    }
    return {
      target: eco.mobilizationTarget,
      mobilized: eco.mobilized,
      pool: Math.floor(eco.reservePool),
      serving: Math.floor(this.servingMen(factionId)),
      totalPopulation: Math.floor(this.totalPopulation(factionId)),
      incomePenalty: eco.mobilized * 100 * BALANCE.MOBILIZATION_INCOME_PENALTY,
    };
  }

  // Тратит людей из пула (лечение/пополнение). Возвращает фактически
  // потраченное (может быть меньше запроса при пустом пуле).
  spendReserve(factionId, menNeeded) {
    const eco = this.getFactionEconomy(factionId);
    if (!eco || menNeeded <= 0) return 0;
    const spent = Math.min(eco.reservePool, menNeeded);
    eco.reservePool -= spent;
    return spent;
  }

  // Погибшие вычитаются из населения случайного своего города.
  removePopulation(factionId, amount) {
    const ownCities = this.cities.filter(c => c.owner === factionId);
    if (!ownCities.length || amount <= 0) return;
    const city = ownCities[Math.floor(Math.random() * ownCities.length)];
    city.population = Math.max(0, (city.population || 0) - amount);
  }

  // Пересчёт численности после урона: потери, погибшие, раненые в очередь.
  onCasualties(unit, prevMen) {
    if (!this.isReserveSystem() || !unit.maxMen) return;

    unit.men = Math.round(unit.maxMen * unit.hp / unit.maxHp);
    const dead = Math.max(0, prevMen - unit.men);
    if (dead <= 0) return;

    this.removePopulation(unit.owner, dead);

    const wounded = Math.round(dead * BALANCE.WOUNDED_RETURN);
    if (wounded > 0) {
      const eco = this.getFactionEconomy(unit.owner);
      if (eco) {
        eco.pendingWounded.push({
          amount: wounded,
          dueDay: this.gameDay + BALANCE.WOUNDED_DELAY_WEEKS * 7,
        });
      }
    }
  }

  // ИЗМЕНЕНО: игровая дата из накопленных дней (месяц 30 дней, год 360).
  getGameDate() {
    const day = Math.max(0, Math.floor(this.gameDay));
    return {
      day: (day % BALANCE.DAYS_PER_MONTH) + 1,
      month: (Math.floor(day / BALANCE.DAYS_PER_MONTH) % 12) + 1,
      year: BALANCE.START_YEAR + Math.floor(day / BALANCE.DAYS_PER_YEAR),
    };
  }

  openCityPanel(city) {
    const income = this.getCityIncome(city);

    const ownerName =
      city.owner === this.playerId
        ? "Игрок"
        : city.owner === this.aiId
        ? "ИИ"
        : "Нейтрал";

    console.log(`
🏙️ ${city.name}
Владелец: ${ownerName}
Уровень: ${city.level}
Доход: ${income} золота/ход
Население: ${Math.floor(city.population)}
Гарнизон: ${
      this.units.filter(
        (u) => u.x === city.x && u.y === city.y && u.isAlive()
      ).length
    } юнитов
    `);
  }

  selectUnitsInRect(x1, y1, x2, y2) {
    this.selectedUnits = [];

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    for (const unit of this.units) {
      if (!unit.isAlive()) continue;
      if (unit.owner !== this.playerId) continue;

      if (
        unit.x >= minX &&
        unit.x <= maxX &&
        unit.y >= minY &&
        unit.y <= maxY
      ) {
        this.selectedUnits.push(unit);
      }
    }

    this.selectedUnit =
      this.selectedUnits.length === 1 ? this.selectedUnits[0] : null;

    console.log(`🎯 Выделено юнитов: ${this.selectedUnits.length}`);
  }

  cleanupDeadUnits() {
    const before = this.units.length;

    this.units = this.units.filter((u) => u.isAlive());

    if (this.selectedUnits) {
      this.selectedUnits = this.selectedUnits.filter((u) => u.isAlive());
    }

    if (this.selectedUnit && !this.selectedUnit.isAlive()) {
      this.selectedUnit = null;
    }

    const removed = before - this.units.length;

    if (removed > 0) {
      console.log(`💀 Удалено мёртвых юнитов: ${removed}`);
    }
  }

  update(dt) {
    if (!this.running || this.paused) return;

    dt = dt * this.speedMultiplier;

    if (this.gameStarted && !this.victoryResolved) {
      this._victoryCheckTimer += dt;

      if (this._victoryCheckTimer >= this._victoryCheckInterval) {
        this._victoryCheckTimer = 0;
        this.checkVictoryConditions();
      }
    }

    for (const city of this.cities) {
      city.updateGarrison(this.units);
    }

    // ИЗМЕНЕНО: игровой календарь. dt уже умножен на speedMultiplier.
    this.gameDay += dt / BALANCE.SECONDS_PER_DAY;

    // ИЗМЕНЕНО: экономический тик — раз в ECONOMY_TICK_DAYS игровых дней
    // (неделя), вместо посекундного.
    if (this.gameDay >= this.nextEconomyDay) {
      this.nextEconomyDay += BALANCE.ECONOMY_TICK_DAYS;
      this.updateEconomy();
      this.updateMobilization(this.playerId);
      this.updateMobilization(this.aiId);
    }

    this.ai.update(dt);

    for (const unit of this.units) {
      unit.update(dt, this);
    }

    this.combat.update(dt);
    this.clearCompletedTasks();
    this.cleanupDeadUnits();

    if (this.selectedUnit && !this.selectedUnit.isAlive()) {
      this.selectedUnit = null;
      console.log("💀 Выбранный юнит погиб, выделение сброшено");
    }
  }

  checkVictoryConditions() {
    if (!this.gameStarted) return;
    if (this.victoryResolved) return;

    const playerCities = this.cities.filter(
      (c) => c.owner === this.playerId
    ).length;

    const aiCities = this.cities.filter(
      (c) => c.owner === this.aiId
    ).length;

    const playerUnits = this.units.filter(
      (u) => u.owner === this.playerId && u.isAlive()
    ).length;

    const aiUnits = this.units.filter(
      (u) => u.owner === this.aiId && u.isAlive()
    ).length;

    const playerDefeated = playerCities === 0 && playerUnits === 0;
    const aiDefeated = aiCities === 0 && aiUnits === 0;

    if (playerDefeated && aiDefeated) {
      return;
    }

    let winner = null;

    if (aiDefeated) winner = "player";
    else if (playerDefeated) winner = "ai";

    if (!winner) return;

    this.victoryResolved = true;
    this.paused = true;

    console.log(`🏆 Победа: ${winner}`);

    if (this.victoryPanel) {
      this.victoryPanel.show(winner);
    }
  }

  getStats() {
    return {
      points: (this.map.points || []).length,
      roads: (this.map.roads || []).length,
      provinces: (this.map.provinces || []).length,
    };
  }

  getUnitsAt(x, y, radius = 0.02) {
    return this.units.filter((u) => {
      if (!u.isAlive()) return false;

      const dx = u.x - x;
      const dy = u.y - y;

      return Math.sqrt(dx * dx + dy * dy) <= radius;
    });
  }

  getClickTargets(wx, wy) {
    const CITY_HIT_RADIUS = 0.018;
    const UNIT_HIT_RADIUS = 0.012;
    const STACK_CLUSTER_RADIUS = 0.006;

    const candidates = [];

    const city = this.getCityAt(wx, wy, CITY_HIT_RADIUS);

    if (city) {
      candidates.push({
        type: "city",
        dist: Math.hypot(city.x - wx, city.y - wy),
        data: city,
      });
    }

    const nearbyUnits = this.getUnitsAt(wx, wy, UNIT_HIT_RADIUS).filter(
      (u) => u.owner === this.playerId
    );

    if (nearbyUnits.length > 0) {
      let nearest = nearbyUnits[0];
      let nearestDist = Math.hypot(nearest.x - wx, nearest.y - wy);

      for (const u of nearbyUnits) {
        const d = Math.hypot(u.x - wx, u.y - wy);

        if (d < nearestDist) {
          nearest = u;
          nearestDist = d;
        }
      }

      const stack = nearbyUnits.filter(
        (u) =>
          Math.hypot(u.x - nearest.x, u.y - nearest.y) <=
          STACK_CLUSTER_RADIUS
      );

      candidates.push({
        type: "units",
        dist: nearestDist,
        data: stack,
      });
    }

    candidates.sort((a, b) => a.dist - b.dist);

    return candidates;
  }

  getUnitAt(x, y, radius = 0.01) {
    return this.units.find((u) => {
      const dx = u.x - x;
      const dy = u.y - y;

      return Math.sqrt(dx * dx + dy * dy) <= radius && u.isAlive();
    });
  }

  getCityAt(x, y, radius = 0.015) {
    let best = null;
    let bestDist = Infinity;
    const r2 = radius * radius;

    for (const c of this.cities) {
      const dx = c.x - x;
      const dy = c.y - y;
      const d2 = dx * dx + dy * dy;

      if (d2 <= r2 && d2 < bestDist) {
        bestDist = d2;
        best = c;
      }
    }

    return best;
  }

  getProvinceAt(x, y) {
    const provinces = this.map.provinces || [];

    for (let i = provinces.length - 1; i >= 0; i--) {
      const prov = provinces[i];

      if (!prov.vertices || prov.vertices.length < 3) continue;

      if (pointInPolygon({ x, y }, prov.vertices)) return prov;
    }

    return undefined;
  }
}

function pointInPolygon(point, vertices) {
  if (!vertices || vertices.length < 3) return false;

  let inside = false;

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}