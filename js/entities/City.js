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
    const effectiveIncome = this.income * this.level * (this.population / 1000);
    this.resources += effectiveIncome * dt;
  }

  // ===== МЕТОДЫ (ВНЕ КОНСТРУКТОРА) =====
  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp < 0) this.hp = 0;
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