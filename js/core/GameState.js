import Unit from "../entities/Unit.js";
import City from "../entities/City.js";
import EconomySystem from "../systems/EconomySystem.js";
import CombatSystem from "../systems/CombatSystem.js";
import AISystem from "../systems/ai/AISystem.js";

export default class GameState {
  constructor(world) {
    this.map = world;

    // ===== GRID =====
    this.grid = null;
    this.gridWidth = 0;
    this.gridHeight = 0;

    if (world.grid) {
      this.loadGrid(world.grid);
    }

    this.pointsById = new Map();
    this.roadsById = new Map();
    this.provincesById = new Map();

    this.buildIndexes();
    this.normalizeGeometry();

    this.cities = [];
    this.units = [];

    // ===== ЭКОНОМИКА =====
    this.playerGold = 100;
    this.aiGold = 100;
    this.goldPerTurn = 0;

    this.economyTimer = 0;
    this.economyInterval = 1.0;

    this.economy = new EconomySystem(this);
    this.combat = new CombatSystem(this);
    this.ai = new AISystem(this);

    // ===== ЗАДАЧИ ИИ =====
    this.aiTasks = [];

    this.running = true;
    this.paused = false;
    this.speedMultiplier = 1.0;

    this.playerId = 1;
    this.aiId = 2;

    this.selectedUnit = null;
    this.selectedUnits = [];
    this.selectedCity = null;
    this.selectedProvince = null;
    this.selectedPoint = null;

    this.initFromWorld();
  }

  // ===== GRID =====
  loadGrid(gridData) {
    if (!gridData) return;
    this.grid = gridData.data;
    this.gridWidth = gridData.width;
    this.gridHeight = gridData.height;
    console.log(`✅ Grid загружен: ${this.gridWidth}x${this.gridHeight}`);
  }

  isWalkable(wx, wy) {
    if (!this.grid || this.grid.length === 0) return true;
    if (wx < 0 || wx > 1 || wy < 0 || wy > 1) return false;

    const gx = Math.floor(wx * this.gridWidth);
    const gy = Math.floor(wy * this.gridHeight);

    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
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

  // ===== ИНИЦИАЛИЗАЦИЯ ИЗ WORLD =====
  initFromWorld() {
    const provinces = this.map.provinces || [];

    for (const prov of provinces) {
      if (!prov.vertices || prov.vertices.length < 3) {
        prov.owner = 0;
        continue;
      }
      prov.owner = 0;
    }

    this.cities = [];
    for (const p of this.map.points || []) {
      if (p.isCity) {
        let provinceId = null;
        let owner = 0;

        for (const prov of provinces) {
          if (!prov.vertices || prov.vertices.length < 3) continue;
          if (pointInPolygon({ x: p.x, y: p.y }, prov.vertices)) {
            provinceId = prov.id;
            owner = prov.owner || 0;
            break;
          }
        }

        const city = new City({
          id: p.id,
          name: p.name || `Город #${p.id}`,
          x: p.x,
          y: p.y,
          type: p.cityType || "city",
          provinceId: provinceId,
          owner: owner,
          population: 1000,
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
    }

    console.log(`🏙️ Загружено городов: ${this.cities.length}`);

    if (this.cities.length > 0) {
      this.cities[0].owner = this.playerId;
      console.log(`👤 Город "${this.cities[0].name}" передан игроку`);
    }
    if (this.cities.length > 1) {
      this.cities[1].owner = this.aiId;
      console.log(`🤖 Город "${this.cities[1].name}" передан ИИ`);
    }

    // ===== НАЗНАЧАЕМ ВЛАДЕЛЬЦА ПРОВИНЦИИ ПО ГОРОДУ =====
    for (const city of this.cities) {
      if (city.provinceId && city.owner !== 0) {
        const prov = this.provincesById.get(city.provinceId);
        if (prov && prov.owner === 0) {
          prov.owner = city.owner;
          console.log(
            `🗺️ Провинция #${prov.id} теперь принадлежит ${
              city.owner === this.playerId ? "игроку" : "ИИ"
            }`
          );
        }
      }
    }

    const playerCity = this.cities.find((c) => c.owner === this.playerId);
    const aiCity = this.cities.find((c) => c.owner === this.aiId);

    if (playerCity) {
      this.spawnUnit({
        owner: this.playerId,
        x: playerCity.x,
        y: playerCity.y,
        speed: 0.05,
        hp: 100,
        role: "infantry",
      });
      console.log(`👤 Юнит игрока создан в "${playerCity.name}"`);
    } else {
      console.warn("⚠️ Не найден город игрока!");
    }

    if (aiCity) {
      this.spawnUnit({
        owner: this.aiId,
        x: aiCity.x,
        y: aiCity.y,
        speed: 0.04,
        hp: 100,
        role: "infantry",
      });
      console.log(`🤖 Юнит ИИ создан в "${aiCity.name}"`);
    } else {
      console.warn("⚠️ Не найден город ИИ!");
    }
  }

  // ===== СПАВН ЮНИТА =====
  spawnUnit({
    owner,
    x,
    y,
    speed = 0.05,
    hp = 100,
    attack = 10,
    defense = 5,
    vision = 0.05,
    provinceId = null,
    role = "infantry",
  }) {
    const id = this.units.length + 1;
    const unit = new Unit({
      id,
      owner,
      x,
      y,
      speed,
      hp,
      attack,
      defense,
      vision,
      provinceId,
      role,
    });
    this.units.push(unit);
    return unit;
  }

  // ===== ЗАХВАТ ГОРОДА =====
  // ИЗМЕНЕНО: защита от повторного захвата + проверка врагов в городе
  tryCaptureCity(unit) {
    if (!unit || !unit.isAlive()) return false;

    const city = this.getCityAt(unit.x, unit.y, 0.02);

    // Не в городе — сбросить lastCityId
    if (!city) {
      unit.lastCityId = null;
      return false;
    }

    // Уже мой город
    if (city.owner === unit.owner) {
      unit.lastCityId = city.id;
      return false;
    }

    // Уже захватывал этот город — не повторять
    if (unit.lastCityId === city.id) return false;

    // Сначала уничтожить врагов в городе
    const enemies = this.units.filter(
      (u) =>
        u.owner !== unit.owner &&
        u.isAlive() &&
        Math.hypot(u.x - city.x, u.y - city.y) < 0.02
    );

    if (enemies.length > 0) return false;

    // Захват
    city.owner = unit.owner;
    if (city.maxHp) city.hp = city.maxHp;
    unit.lastCityId = city.id;

    // Синхронизация владельца провинции (если есть)
    if (city.provinceId) {
      const prov = this.provincesById.get(city.provinceId);
      if (prov) prov.owner = unit.owner;
    }

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
    const base = city.level * 2;
    const popBonus = Math.floor(city.population / 1000);
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

    return income;
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
      if (
        prov.owner === ownerId &&
        prov.vertices &&
        prov.vertices.length >= 3
      ) {
        income += 5;
      }
    }

    for (const unit of this.units) {
      if (unit.owner === ownerId && unit.isAlive()) {
        upkeep += 1;
      }
    }

    return {
      income,
      upkeep,
      net: income - upkeep,
    };
  }

  updateEconomy() {
    this.goldPerTurn = 0;

    for (const city of this.cities) {
      const income = this.getCityIncome(city);
      if (city.owner === this.playerId) {
        this.playerGold += income;
        this.goldPerTurn += income;
      } else if (city.owner === this.aiId) {
        this.aiGold += income;
      }
    }

    for (const prov of this.map.provinces || []) {
      if (!prov.vertices || prov.vertices.length < 3) continue;

      const provIncome = prov.owner !== 0 ? 5 : 0;

      if (prov.owner === this.playerId) {
        this.playerGold += provIncome;
        this.goldPerTurn += provIncome;
      } else if (prov.owner === this.aiId) {
        this.aiGold += provIncome;
      }
    }

    const playerUnits = this.units.filter(
      (u) => u.owner === this.playerId && u.isAlive()
    );
    const aiUnits = this.units.filter(
      (u) => u.owner === this.aiId && u.isAlive()
    );

    this.playerGold -= playerUnits.length;
    this.aiGold -= aiUnits.length;
    this.goldPerTurn -= playerUnits.length;

    if (this.playerGold < 0) this.playerGold = 0;
    if (this.aiGold < 0) this.aiGold = 0;
  }

  // ===== ПАНЕЛЬ ГОРОДА =====
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
      this.units.filter((u) => u.x === city.x && u.y === city.y && u.isAlive())
        .length
    } юнитов
    `);
  }

  // ===== ВЫДЕЛЕНИЕ РАМКОЙ =====
  selectUnitsInRect(x1, y1, x2, y2) {
    this.selectedUnits = [];
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    for (const unit of this.units) {
      if (!unit.isAlive()) continue;
      if (unit.owner !== this.playerId) continue;
      if (unit.x >= minX && unit.x <= maxX && unit.y >= minY && unit.y <= maxY) {
        this.selectedUnits.push(unit);
      }
    }

    this.selectedUnit =
      this.selectedUnits.length === 1 ? this.selectedUnits[0] : null;
    console.log(`🎯 Выделено юнитов: ${this.selectedUnits.length}`);
  }

  // ===== ОЧИСТКА МЁРТВЫХ ЮНИТОВ =====
  // ИЗМЕНЕНО: новый метод
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

  // ===== ОБНОВЛЕНИЕ =====
  update(dt) {
    if (!this.running || this.paused) return;

    dt = dt * this.speedMultiplier;

    this.economyTimer += dt;
    if (this.economyTimer >= this.economyInterval) {
      this.economyTimer = 0;
      this.updateEconomy();
    }

    this.ai.update(dt);

    for (const unit of this.units) {
      unit.update(dt, this);
    }

    this.combat.update(dt);
    this.clearCompletedTasks();

    // ИЗМЕНЕНО: удаляем мёртвых после боя
    this.cleanupDeadUnits();

    if (this.selectedUnit && !this.selectedUnit.isAlive()) {
      this.selectedUnit = null;
      console.log("💀 Выбранный юнит погиб, выделение сброшено");
    }
  }

  // ===== СТАТИСТИКА =====
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

  getUnitAt(x, y, radius = 0.01) {
    return this.units.find((u) => {
      const dx = u.x - x;
      const dy = u.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= radius && u.isAlive();
    });
  }

  getCityAt(x, y, radius = 0.015) {
    return this.cities.find((c) => {
      const dx = c.x - x;
      const dy = c.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= radius;
    });
  }

  getProvinceAt(x, y) {
    return (this.map.provinces || []).find((prov) => {
      if (!prov.vertices || prov.vertices.length < 3) return false;
      return pointInPolygon({ x, y }, prov.vertices);
    });
  }
}

function pointInPolygon(point, vertices) {
  if (!vertices || vertices.length < 3) return false;

  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x,
      yi = vertices[i].y;
    const xj = vertices[j].x,
      yj = vertices[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}