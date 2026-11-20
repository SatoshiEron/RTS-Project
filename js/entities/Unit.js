// ============================================================
// ИЗМЕНЕНО: таблица типов формирований.
// Один юнит = одно формирование (бригада/дивизия).
// HOI4-лайт, не Total War: только статы, без флангов
// и камень-ножницы-бумага.
// ============================================================
export const UNIT_TYPES = {
  militia: {
    name: 'Ополчение',
    hp: 80,
    attack: 6,
    defense: 3,
    speed: 0.04,
    vision: 0.05,
    attackRadius: 0.03,
    regenRate: 1.0,
    cost: 15,
    oreCost: 0,
    goodsCost: 0,
    foodCost: 5,
    canSwim: false,
    allowedCityTypes: ['city', 'port', 'farm', 'mine', 'factory', 'trade'],
  },
  infantry: {
    name: 'Пехота',
    hp: 100,
    attack: 10,
    defense: 5,
    speed: 0.05,
    vision: 0.05,
    attackRadius: 0.03,
    regenRate: 1.0,
    cost: 25,
    oreCost: 0,
    goodsCost: 0,
    foodCost: 8,
    canSwim: false,
    allowedCityTypes: ['city', 'port', 'farm', 'mine', 'factory', 'trade'],
  },
  motorized: {
    name: 'Моторизованная',
    hp: 110,
    attack: 12,
    defense: 6,
    speed: 0.08,
    vision: 0.06,
    attackRadius: 0.03,
    regenRate: 1.0,
    cost: 40,
    oreCost: 0,
    goodsCost: 5,
    foodCost: 3,
    canSwim: false,
    allowedCityTypes: ['city', 'factory'],
  },
  armored: {
    name: 'Бронетанковая',
    hp: 180,
    attack: 22,
    defense: 15,
    speed: 0.06,
    vision: 0.05,
    attackRadius: 0.03,
    regenRate: 0.8,
    cost: 70,
    oreCost: 10,
    goodsCost: 15,
    foodCost: 0,
    canSwim: false,
    allowedCityTypes: ['factory'],
  },
  artillery: {
    name: 'Артиллерия',
    hp: 70,
    attack: 28,
    defense: 2,
    speed: 0.03,
    vision: 0.05,
    attackRadius: 0.048,
    regenRate: 0.8,
    cost: 50,
    oreCost: 0,
    goodsCost: 10,
    foodCost: 0,
    canSwim: false,
    allowedCityTypes: ['factory'],
  },
  marines: {
    name: 'Морская пехота',
    hp: 90,
    attack: 12,
    defense: 4,
    speed: 0.05,
    waterSpeed: 0.02,
    vision: 0.06,
    attackRadius: 0.03,
    regenRate: 1.0,
    cost: 45,
    oreCost: 0,
    goodsCost: 0,
    foodCost: 10,
    canSwim: true,
    allowedCityTypes: ['port'],
  },
};

export default class Unit {
  constructor({
    id,
    owner = 1,
    x,
    y,
    // ИЗМЕНЕНО: тип формирования. Если не передан — пехота.
    type = 'infantry',
    // Опциональные переопределения (если нужно).
    speed,
    hp,
    attack,
    defense,
    vision,
    provinceId = null,
    role = "infantry",
  }) {
    const stats = UNIT_TYPES[type] || UNIT_TYPES.infantry;

    this.id = id;
    this.owner = owner;

    this.x = x;
    this.y = y;

    // ИЗМЕНЕНО: тип и статы из таблицы.
    this.type = type;
    this.typeName = stats.name;
    this.canSwim = !!stats.canSwim;
    this.attackRadius = stats.attackRadius;
    this.regenRate = stats.regenRate;
    this.waterSpeed = stats.waterSpeed || stats.speed;

    this.speed = speed ?? stats.speed;
    this.hp = hp ?? stats.hp;
    this.maxHp = this.hp;

    this.attack = attack ?? stats.attack;
    this.defense = defense ?? stats.defense;
    this.vision = vision ?? stats.vision;

    this.provinceId = provinceId;

    this.targetX = x;
    this.targetY = y;
    this.path = [];

    // ИЗМЕНЕНО: role оставлен для совместимости.
    // ИЗМЕНЕНО: role синхронизирован с типом (для отображения).
    this.role = type;
    this.aiState = "idle";
    this.aiTask = null;
    this.aiPriority = 0;

    this.state = "idle";

    // ИЗМЕНЕНО: поля отступления.
    this.savedTask = null;
    this.retreatTarget = null;
    this.retreatCityId = null;

    this.movementCommandActive = false;
    this.combatTargetId = null;
    this.attackTimer = 0;
    this.cityAttackTimer = 0;

    this.lastCityId = null;
    this.gameRef = null;
  }

  // ============================================================
  // ПРИКАЗ НА ДВИЖЕНИЕ
  // ============================================================

  setTarget(tx, ty) {
    this.targetX = tx;
    this.targetY = ty;

    this.movementCommandActive = true;
    this.state = "moving";

    this.combatTargetId = null;
    this.lastCityId = null;

    this.path = this.findRoadPath(tx, ty);

    if (this.aiState === "idle") {
      this.aiState = "moving";
    }
  }

  findRoadPath(tx, ty) {
    if (!this.gameRef || typeof this.gameRef.getRouteTo !== "function") {
      return [];
    }
    const route = this.gameRef.getRouteTo(this.x, this.y, tx, ty);
    return route || [];
  }

  assignTask(task) {
    this.aiTask = task;
    this.aiState = task.type;
    this.aiPriority = task.priority || 5;

    this.setTarget(
      task.target.x,
      task.target.y
    );
  }

  clearTask() {
    this.aiTask = null;
    this.aiState = "idle";
    this.aiPriority = 0;
    this.movementCommandActive = false;

    if (this.state !== "dead") {
      this.state = "idle";
    }
    this.combatTargetId = null;
  }

  // ============================================================
  // ОСНОВНОЙ UPDATE
  // ============================================================

  update(dt, game) {
    if (!this.isAlive()) return;

    // ИЗМЕНЕНО: отступление — раньше всей остальной логики.
    if (this.aiState === 'retreating') {
      this.updateRetreat(dt, game);
      return;
    }

    // ИЗМЕНЕНО: проверка HP — не пора ли отступать.
    // Только для юнитов ИИ и только если есть задача.
    if (
      game &&
      this.owner === game.aiId &&
      this.aiState !== 'idle' &&
      this.state !== 'dead' &&
      this.hp > 0 &&
      this.hp / this.maxHp < 0.3
    ) {
      if (this.startRetreat(game)) {
        return;
      }
    }

    if (
      game &&
      this.lastCityId !== null
    ) {
      const cityAtUnit =
        game.getCityAt(
          this.x,
          this.y,
          0.02
        );

      if (!cityAtUnit) {
        this.lastCityId = null;
      }
    }

    if (this.movementCommandActive) {
      this.updateMovement(dt, game);

      if (this.state === "idle") {
        this.movementCommandActive = false;
      }
    } else {
      const enemiesNearby =
        game.units.filter(
          (u) =>
            u !== this &&
            u.owner !== this.owner &&
            u.isAlive() &&
            Math.hypot(
              u.x - this.x,
              u.y - this.y
            ) < 0.03
        );

      if (
        enemiesNearby.length > 0
      ) {
        this.state = "fighting";

        if (!this.combatTargetId) {
          let nearest = null;
          let nearestDistance = Infinity;

          for (const enemy of enemiesNearby) {
            const distance = Math.hypot(enemy.x - this.x, enemy.y - this.y);
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearest = enemy;
            }
          }

          if (nearest) {
            this.combatTargetId = nearest.id;
          }
        }
      } else {
        if (this.state === "fighting") {
          this.state = "idle";
          this.combatTargetId = null;
        }

        this.updateMovement(dt, game);
      }
    }

    if (this.state === "idle" && game) {
      game.tryCaptureCity(this);
    }

    if (!this.aiTask && this.aiState !== "idle" && this.aiState !== "retreating") {
      this.aiState = "idle";
    }

    // ИЗМЕНЕНО: регенерация HP с учётом regenRate.
    if (game && this.isAlive()) {
      const cityHere = game.getCityAt(this.x, this.y, 0.02);

      if (cityHere && cityHere.owner === this.owner) {
        const baseRate = 2;
        const rate = baseRate * (this.regenRate || 1.0);
        this.hp = Math.min(this.maxHp, this.hp + rate * dt);
      }
    }
  }

  // ============================================================
  // ОБЫЧНОЕ ДВИЖЕНИЕ
  // ============================================================

  updateMovement(dt, game) {
    if (!this.isAlive()) return;

    if (this.path.length > 0) {
      this.followPath(dt, game);
      return;
    }

    // ИЗМЕНЕНО: проверка проходимости с учётом юнита (морпехи).
    if (
      game &&
      !game.isWalkable(
        this.targetX,
        this.targetY,
        this
      )
    ) {
      this.state = "idle";
      this.movementCommandActive = false;
      return;
    }

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.0001) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.state = "idle";
      this.movementCommandActive = false;
      return;
    }

    const speedMultiplier = game ? game.getMovementSpeedMultiplier(this.x, this.y) : 1;

    // ИЗМЕНЕНО: на воде — waterSpeed (для морпехов).
    let baseSpeed = this.speed;
    if (game && this.canSwim && game.getProvinceAt) {
      const prov = game.getProvinceAt(this.x, this.y);
      if (prov && prov.type === 'water') {
        baseSpeed = this.waterSpeed;
      }
    }

    const maxStep = baseSpeed * speedMultiplier * dt;
    const step = Math.min(maxStep, dist);

    const newX = this.x + (dx / dist) * step;
    const newY = this.y + (dy / dist) * step;

    if (game && !game.isWalkable(newX, newY, this)) {
      const tryX = this.x + (dx / dist) * step;
      const tryY = this.y + (dy / dist) * step;

      if (game.isWalkable(tryX, this.y, this)) {
        this.x = tryX;
        return;
      }
      if (game.isWalkable(this.x, tryY, this)) {
        this.y = tryY;
        return;
      }

      this.state = "idle";
      this.movementCommandActive = false;
      return;
    }

    this.x = newX;
    this.y = newY;
  }

  // ============================================================
  // ДВИЖЕНИЕ ПО PATH
  // ============================================================

  followPath(dt, game) {
    if (this.path.length === 0) {
      this.state = "idle";
      this.movementCommandActive = false;
      return;
    }

    const next = this.path[0];
    const dx = next.x - this.x;
    const dy = next.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.001) {
      this.x = next.x;
      this.y = next.y;
      this.path.shift();

      if (this.path.length === 0) {
        this.state = "idle";
        this.movementCommandActive = false;
      }
      return;
    }

    const speedMultiplier = game ? game.getMovementSpeedMultiplier(this.x, this.y) : 1;

    // ИЗМЕНЕНО: на воде — waterSpeed (для морпехов).
    let baseSpeed = this.speed;
    if (game && this.canSwim && game.getProvinceAt) {
      const prov = game.getProvinceAt(this.x, this.y);
      if (prov && prov.type === 'water') {
        baseSpeed = this.waterSpeed;
      }
    }

    const maxStep = baseSpeed * speedMultiplier * dt;
    const step = Math.min(maxStep, dist);

    const newX = this.x + (dx / dist) * step;
    const newY = this.y + (dy / dist) * step;

    if (game && !game.isWalkable(newX, newY, this)) {
      this.path = [];
      this.state = "moving";
      return;
    }

    this.x = newX;
    this.y = newY;
  }

  // ============================================================
  // ОТСТУПЛЕНИЕ
  // ============================================================

  startRetreat(game) {
    if (!game || this.state === 'dead') return false;
    if (this.aiState === 'retreating') return false;

    const city = this.findRetreatCity(game);
    if (!city) return false;

    this.savedTask = this.aiTask;
    this.retreatTarget = { x: city.x, y: city.y };
    this.retreatCityId = city.id;

    this.aiState = 'retreating';
    this.setTarget(city.x, city.y);

    console.log(`🏃 Юнит #${this.id} (${this.typeName}) отступает к "${city.name}" (HP ${Math.floor(this.hp)}/${this.maxHp})`);

    return true;
  }

  findRetreatCity(game) {
    const cities = game.cities.filter(c => c.owner === this.owner);
    if (!cities.length) return null;

    const maxR = 0.5;
    const maxR2 = maxR * maxR;

    let best = null;
    let bestDist2 = Infinity;

    for (const c of cities) {
      const dx = c.x - this.x;
      const dy = c.y - this.y;
      const d2 = dx * dx + dy * dy;

      if (d2 < bestDist2 && d2 <= maxR2) {
        bestDist2 = d2;
        best = c;
      }
    }

    return best;
  }

  updateRetreat(dt, game) {
    if (!game || this.state === 'dead') return;

    if (this.retreatCityId !== null) {
      const city = game.cities.find(c => c.id === this.retreatCityId);

      if (!city || city.owner !== this.owner) {
        const newCity = this.findRetreatCity(game);

        if (newCity) {
          this.retreatTarget = { x: newCity.x, y: newCity.y };
          this.retreatCityId = newCity.id;
          this.setTarget(newCity.x, newCity.y);
        } else {
          this.endRetreat();
        }
        return;
      }

      const dx = city.x - this.x;
      const dy = city.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 0.02) {
        this.x = city.x;
        this.y = city.y;
        this.state = 'idle';
        this.movementCommandActive = false;

        const healRate = 8 * (this.regenRate || 1.0);
        this.hp = Math.min(this.maxHp, this.hp + healRate * dt);

        if (this.hp >= this.maxHp * 0.7) {
          this.endRetreat();
        }
        return;
      }
    }

    this.updateMovement(dt, game);
  }

  endRetreat() {
    if (this.state === 'dead') return;

    this.aiState = 'idle';

    const task = this.savedTask;
    this.savedTask = null;
    this.retreatTarget = null;
    this.retreatCityId = null;

    if (task && !task.completed) {
      if (Array.isArray(task.units) && task.units.includes(this)) {
        this.aiTask = task;
        this.aiState = task.type;
        this.setTarget(task.target.x, task.target.y);
        console.log(`↩️ Юнит #${this.id} вернулся к задаче "${task.type}"`);
        return;
      }
    }

    this.aiTask = null;
    this.aiPriority = 0;
    console.log(`✅ Юнит #${this.id} закончил отступление`);
  }

  // ============================================================
  // УРОН
  // ============================================================

  takeDamage(amount) {
    this.hp -= amount;

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = "dead";
      this.aiState = "dead";
      this.movementCommandActive = false;
      this.combatTargetId = null;
      this.path = [];
      this.lastCityId = null;
    }
  }

  isAlive() {
    return this.hp > 0 && this.state !== "dead";
  }

  getDistanceTo(target) {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  getDistanceToXY(tx, ty) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}