// ⚠️ LEGACY / ЧЕРНОВИК. НЕ ПОДКЛЮЧЁН.
// - update() нигде не вызывается.
// - Содержит баг: `Au.owner` вместо `u.owner` в фильтре aiUnits.
// - Дублирует логику GameState.updateEconomy (доход, upkeep).
// - НЕ ИСПОЛЬЗОВАТЬ для активной экономики.
// - Идеи (инфляция, долги, графики, ВВП) — в IDEAS.md.
export default class EconomySystem {
  constructor(game) {
    this.game = game;

    // общий ресурс игрока и ИИ
    this.playerResources = 0;
    this.aiResources = 0;

    // содержание юнитов
    this.unitUpkeep = 1; // 1 ресурс в секунду за юнит
  }

  update(dt) {
    // ===== 1. Доходы городов =====
    for (const city of this.game.cities) {
      city.updateEconomy(dt); // рост населения + доход

      const income = city.income * city.level * (city.population / 1000);

      if (city.owner === this.game.playerId) {
        this.playerResources += income * dt;
      } else if (city.owner === this.game.aiId) {
        this.aiResources += income * dt;
      }
    }

    // ===== 2. Доходы провинций =====
    for (const prov of this.game.map.provinces) {
      const provIncome = prov.level * 5; // базовый доход провинции

      if (prov.owner === this.game.playerId) {
        this.playerResources += provIncome * dt;
      } else if (prov.owner === this.game.aiId) {
        this.aiResources += provIncome * dt;
      }
    }

    // ===== 3. Содержание юнитов =====
    const playerUnits = this.game.units.filter(u => u.owner === this.game.playerId);
    const aiUnits = this.game.units.filter(u => Au.owner === this.game.aiId);

    this.playerResources -= playerUnits.length * this.unitUpkeep * dt;
    this.aiResources -= aiUnits.length * this.unitUpkeep * dt;

    // ===== 4. Минимальный порог ресурсов =====
    if (this.playerResources < 0) this.playerResources = 0;
    if (this.aiResources < 0) this.aiResources = 0;
  }
}
