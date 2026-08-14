export default class City {
  constructor({
    id,
    name,
    x,
    y,
    type = "city",
    provinceId = null,
    owner = 0,            // 0 — нейтрал, 1 — игрок, 2 — ИИ
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

    // базовые параметры для будущих механик
    this.maxHp = 500;
    this.hp = this.maxHp;
    this.defense = 20;     // защита города
    this.growthRate = 0.01; // рост населения
  }

  updateEconomy(dt) {
    // рост населения
    this.population += this.population * this.growthRate * dt;

    // доход зависит от уровня и населения
    const effectiveIncome = this.income * this.level * (this.population / 1000);

    this.resources += effectiveIncome * dt;
  }

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
