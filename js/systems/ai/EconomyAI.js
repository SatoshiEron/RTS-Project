import AIConfig from './AIConfig.js';

export default class EconomyAI {
  constructor(game) {
    this.game = game;
  }

  update() {
    const gold = this.game.aiGold;
    const cities = this.game.cities.filter(c => c.owner === this.game.aiId);

    if (gold >= AIConfig.RECRUIT_THRESHOLD) {
      this.tryRecruit(cities);
    }

    if (gold >= AIConfig.UPGRADE_THRESHOLD) {
      this.tryUpgrade(cities);
    }
  }

  tryRecruit(cities) {
    const city = this.getBestCityForRecruit(cities);
    if (!city) return;

    const hasUnit = this.game.units.some(u =>
      u.owner === this.game.aiId &&
      Math.abs(u.x - city.x) < 0.01 &&
      Math.abs(u.y - city.y) < 0.01
    );

    if (!hasUnit) {
      this.game.aiGold -= AIConfig.UNIT_COST;
      this.game.spawnUnit({
        owner: this.game.aiId,
        x: city.x + (Math.random() - 0.5) * AIConfig.SPAWN_JITTER,
        y: city.y + (Math.random() - 0.5) * AIConfig.SPAWN_JITTER,
        hp: 100,
        attack: 10,
        defense: 5,
        role: 'infantry'
      });
      console.log(`🤖 ИИ нанял юнита в "${city.name}"`);
    }
  }

  tryUpgrade(cities) {
    const city = this.getBestCityForUpgrade(cities);
    if (!city || city.level >= 5) return;

    this.game.aiGold -= AIConfig.UPGRADE_COST;
    city.level += 1;
    city.population *= 1.1;
    city.defense += 3;
    console.log(`⬆️ ИИ улучшил "${city.name}" до ${city.level} уровня`);
  }

  getBestCityForRecruit(cities) {
    if (!cities.length) return null;
    // Приоритет: города на передовой (ближе к врагу)
    const playerCities = this.game.cities.filter(c => c.owner === this.game.playerId);
    if (playerCities.length === 0) return cities[0];

    return this.findClosest(cities, playerCities[0]);
  }

  getBestCityForUpgrade(cities) {
    if (!cities.length) return null;
    // Приоритет: столица или самый развитый город
    return cities.reduce((a, b) => a.level > b.level ? a : b);
  }

  findClosest(list, ref) {
    let best = null;
    let bestDist = Infinity;
    for (const obj of list) {
      const dx = obj.x - ref.x;
      const dy = obj.y - ref.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = obj;
      }
    }
    return best;
  }
}