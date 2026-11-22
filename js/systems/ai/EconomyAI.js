import AIConfig from './AIConfig.js';
import { UNIT_TYPES } from '../../entities/Unit.js';

export default class EconomyAI {
  constructor(game) {
    this.game = game;
  }

  update() {
    const cities = this.game.cities.filter(
      (c) => c.owner === this.game.aiId
    );

    if (cities.length === 0) return;

    this.tryRecruit(cities);
    this.tryUpgrade(cities);
  }

  getBudgetForCity(city) {
    // ИЗМЕНЕНО: единая казна — бюджет всегда золото фракции.
    const amount = city.owner === this.game.playerId
      ? this.game.playerGold
      : this.game.aiGold;

    return { source: 'center', amount };
  }

  // ============================================================
  // ИЗМЕНЕНО: выбор типа формирования для города.
  // Правила:
  //   - Есть factory → приоритет armored (если денег много) → artillery
  //     → motorized → infantry.
  //   - Есть port → иногда marines (если у ИИ есть вода рядом).
  //   - Иначе → infantry / militia.
  // ============================================================
  getPreferredUnitType(city) {
    const available = this.game.getAvailableUnitTypes
      ? this.game.getAvailableUnitTypes(city)
      : ['infantry'];

    const budget = this.getBudgetForCity(city).amount;

    // Завод: танк, если хватает на него и есть запас.
    if (available.includes('armored') && budget >= UNIT_TYPES.armored.cost * 1.5) {
      return 'armored';
    }

    // Завод: артиллерия, если есть деньги.
    if (available.includes('artillery') && budget >= UNIT_TYPES.artillery.cost * 1.2) {
      return 'artillery';
    }

    // Моторизованная — быстрая, средняя цена.
    if (available.includes('motorized') && budget >= UNIT_TYPES.motorized.cost * 1.3) {
      return 'motorized';
    }

    // Порт: морпехи, если есть вода рядом (хотя бы одна водная провинция).
    if (available.includes('marines') && budget >= UNIT_TYPES.marines.cost * 1.2) {
      const hasWaterNearby = this.hasWaterNearby(city);
      if (hasWaterNearby && Math.random() < 0.5) {
        return 'marines';
      }
    }

    // Дефолт — пехота.
    return 'infantry';
  }

  // Есть ли вода в радиусе от города (для морпехов).
  hasWaterNearby(city, radius = 0.15) {
    const provinces = this.game.map.provinces || [];
    for (const prov of provinces) {
      if (prov.type !== 'water') continue;
      if (!prov.vertices || prov.vertices.length < 3) continue;

      // Проверяем центр провинции — если близко к городу.
      let cx = 0, cy = 0;
      for (const v of prov.vertices) { cx += v.x; cy += v.y; }
      cx /= prov.vertices.length;
      cy /= prov.vertices.length;

      const d = Math.hypot(cx - city.x, cy - city.y);
      if (d < radius) return true;
    }
    return false;
  }

    tryRecruit(cities) {
    const city = this.getBestCityForRecruit(cities);
    if (!city) return;

    const budget = this.getBudgetForCity(city);
    if (budget.amount < AIConfig.RECRUIT_THRESHOLD) return;

    // ИЗМЕНЕНО: каскад кандидатов. Если на предпочтительный тип не хватает
    // ресурсов — пробуем более дешёвые, иначе ИИ (напр. с заводом, но без
    // шахты) не может нанимать вовсе.
    const preferred = this.getPreferredUnitType(city);
    const candidates = [preferred, 'artillery', 'motorized', 'infantry', 'militia']
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .filter(t => this.game.getAvailableUnitTypes
        ? this.game.getAvailableUnitTypes(city).includes(t)
        : t === 'infantry');

    for (const type of candidates) {
      const stats = UNIT_TYPES[type];
      if (!stats) continue;

      // 1. Проверка ресурсов.
      const resCheck = this.game.canAffordResources(this.game.aiId, {
        ore: stats.oreCost || 0,
        goods: stats.goodsCost || 0,
        food: stats.foodCost || 0,
      });
      if (!resCheck.ok) continue; // пробуем более дешёвый тип

      // 2. Проверка людей. В системе 'reserve' набор идёт из пула —
      // городской план призыва не применяется.
      const manpowerNeed = this.game.getRecruitManpower(type);
      if (!(this.game.isReserveSystem && this.game.isReserveSystem())) {
        const draftPlan = this.game.planDraft(city, manpowerNeed);
        if (!draftPlan) {
          // Не хватает людей — ИИ ждёт.
          return;
        }
      }

      // 3. Найм.
      const result = this.game.tryRecruitUnit(city, type);

      if (result.ok) {
        console.log(
          `🤖 ИИ нанял ${result.unit.typeName} #${result.unit.id} в "${city.name}" ` +
          `(${result.cost}💰 + ${result.manpowerSpent}👥)`
        );
        return;
      }

      if (result.reason === 'manpower' || result.reason === 'not_enough_manpower') {
        // Людей нет — ждём пополнения пула.
        return;
      }
      if (result.reason === 'type_not_allowed') continue;

      return;
    }
  }

  tryUpgrade(cities) {
    const city = this.getBestCityForUpgrade(cities);
    if (!city) return;

    if (!this.game.canUpgradeCity(city)) return;

    const budget = this.getBudgetForCity(city);
    if (budget.amount < AIConfig.UPGRADE_THRESHOLD) return;

    const result = this.game.tryUpgradeCity(city);

    if (result.ok) {
      console.log(
        `⬆️ ИИ улучшил "${city.name}" до ${result.newLevel} уровня ` +
        `(${result.cost}💰 из ${result.source === 'city' ? 'города' : 'казны'})`
      );
    }
  }

  getBestCityForRecruit(cities) {
    if (!cities.length) return null;

    const playerCities = this.game.cities.filter(
      (c) => c.owner === this.game.playerId
    );

    if (playerCities.length === 0) return cities[0];

    return this.findClosest(cities, playerCities[0]);
  }

  getBestCityForUpgrade(cities) {
    if (!cities.length) return null;
    return cities.reduce((a, b) => (a.level > b.level ? a : b));
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