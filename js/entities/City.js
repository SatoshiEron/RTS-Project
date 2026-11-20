export default class City {
  constructor({
    id,
    name,
    x,
    y,
    type = "city",
    provinceId = null,
    owner = 0,
    population = 1000,
    income = 10,
    level = 1,
    garrison = 0
  }) {
    this.id = id;
    this.name = name;
    this.x = x;
    this.y = y;

    this.type = type;
    this.provinceId = provinceId;
    this.owner = owner;

    this.population = population;
    this.income = income;
    this.level = level;

    // ИЗМЕНЕНО: рабочая сила города.
    this.manpowerMax = Math.max(1, Math.floor(this.population / 100));
    this.manpower = this.manpowerMax;

    // ИЗМЕНЕНО: локальный запас ресурсов (для будущей логистики).
    // oil/coal — заложены, в MVP не используются.
    this.resourceStock = {
      ore: 0,
      goods: 0,
      food: 0,
      oil: 0,
      coal: 0,
    };

    this.resources = 0;
    this.garrison = garrison;

    // ===== HP И ЗАЩИТА =====
    this.maxHp = 500;
    this.hp = this.maxHp;
    this.defense = 20;

    // ===== РОСТ =====
    this.growthRate = 0.01;
  }

  updateEconomy(dt) {
    this.population += this.population * this.growthRate * dt;

    const effectiveIncome =
      this.income * this.level * (this.population / 1000);

    this.resources += effectiveIncome * dt;
  }

  // ===== ГАРНИЗОН =====

  // ИЗМЕНЕНО: пересчёт юнитов гарнизона города.
  // В гарнизон попадают только живые юниты владельца города,
  // находящиеся в радиусе 0.02 от его координат.
  updateGarrison(units) {
    const GARRISON_RADIUS = 0.02;
    const radiusSquared = GARRISON_RADIUS * GARRISON_RADIUS;

    if (!Array.isArray(units)) {
      this.garrison = 0;
      return this.garrison;
    }

    this.garrison = units.filter((unit) => {
      if (!unit) return false;

      // ИЗМЕНЕНО: мёртвые юниты не учитываются.
      if (typeof unit.isAlive === "function" && !unit.isAlive()) {
        return false;
      }

      // ИЗМЕНЕНО: учитываются только юниты владельца города.
      if (unit.owner !== this.owner) {
        return false;
      }

      const dx = unit.x - this.x;
      const dy = unit.y - this.y;
      const distanceSquared = dx * dx + dy * dy;

      return distanceSquared <= radiusSquared;
    }).length;

    return this.garrison;
  }

  // ИЗМЕНЕНО: пополнение рабочей силы.
  // Максимум зависит от населения; +0.5% от максимума за цикл.
  updateManpower() {
    this.manpowerMax = Math.max(1, Math.floor(this.population / 100));

    const regen = this.manpowerMax * 0.005;
    this.manpower = Math.min(this.manpowerMax, this.manpower + regen);
  }
  
    // Сколько людей можно забрать из города (с резервом и осадой).
  getAvailableManpower() {
    const max = this.manpowerMax || 0;
    const reserve = max * 0.2;   // DRAFT_RESERVE_RATIO
    const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1;

    // Осада: HP < 50% — не даёт людей.
    if (hpRatio < 0.5) return 0;

    return Math.max(0, (this.manpower || 0) - reserve);
  }

  getManpowerLabel() {
    return `${Math.floor(this.manpower || 0)}/${Math.floor(this.manpowerMax || 0)}`;
  }

  // ===== МЕТОДЫ (ВНЕ КОНСТРУКТОРА) =====

  takeDamage(amount) {
    this.hp -= amount;

    if (this.hp < 0) {
      this.hp = 0;
    }
  }

  isDestroyed() {
    return this.hp <= 0;
  }

  recruitUnit(cost) {
    if (this.resources >= cost) {
      this.resources -= cost;
      return true;
    }

    return false;
  }
}