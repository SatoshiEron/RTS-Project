// ============================================================
// ИЗМЕНЕНО: каталог построек «Строительство, фаза 1».
// Все числа построек — только здесь (и CITY_LEVEL_SLOTS ниже).
// Поле weeks — задел на фазу 2 (время строительства), в фазе 1 не используется.
// ============================================================

export const BUILDINGS = {
  farm: {
    name: 'Ферма', icon: '🌾', scope: 'province', requires: 'fertile',
    cost: 400, weeks: 3, effects: { foodPerWeek: 40 },
  },
  mine: {
    name: 'Шахта', icon: '⛏️', scope: 'province', requires: 'ore',
    cost: 700, weeks: 4, effects: { orePerWeek: 30 },
  },
  market: {
    name: 'Рынок', icon: '🏪', scope: 'city',
    cost: 500, weeks: 3, effects: { incomeMult: 0.25 },
  },
  barracks: {
    name: 'Казармы', icon: '🎖️', scope: 'city',
    cost: 800, weeks: 4, effects: { reserveGrowthMult: 0.15, recruitDiscount: 0.15 },
  },
  factory: {
    name: 'Завод', icon: '🏭', scope: 'city',
    cost: 1500, weeks: 7, effects: { goodsPerWeek: 20, incomeMult: 0.15 },
  },
  fort: {
    name: 'Укрепления', icon: '🏰', scope: 'city',
    cost: 1000, weeks: 5, effects: { hpMult: 0.5, garrisonBonus: 1 },
  },
};

// Слоты городских построек по уровню города.
export const CITY_LEVEL_SLOTS = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 };

// Названия уровней городов (отображаются в UI).
export const CITY_LEVEL_NAMES = {
  1: 'Поселение',
  2: 'Городок',
  3: 'Город',
  4: 'Региональный центр',
  5: 'Мегаполис',
};

// Сумма эффекта effectKey по постройкам target (город или провинция).
export function getBuildingEffectsSum(target, effectKey) {
  let sum = 0;
  for (const id of (target && target.buildings) || []) {
    const b = BUILDINGS[id];
    if (b && b.effects && typeof b.effects[effectKey] === 'number') {
      sum += b.effects[effectKey];
    }
  }
  return sum;
}

export function getCitySlots(level) {
  return CITY_LEVEL_SLOTS[level] || CITY_LEVEL_SLOTS[1];
}

// Провинциальный ресурс — массив id: (prov.resources || []).includes('ore').
export function provinceHasResource(prov, key) {
  return Array.isArray(prov && prov.resources) && prov.resources.includes(key);
}
