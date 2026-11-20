export default {
  THINK_INTERVAL: 1.0,

  // Экономика
  // ИЗМЕНЕНО: UNIT_COST и UPGRADE_COST удалены.
  // Цены теперь в GameState.getRecruitCost() / getUpgradeCost() —
  // единый источник для игрока и ИИ.
  //
  // RECRUIT_THRESHOLD / UPGRADE_THRESHOLD — это НЕ цена, а порог
  // «когда ИИ вообще пытается действовать». Точную проверку
  // достаточности средств делает payForAction() внутри
  // tryRecruitUnit() / tryUpgradeCity().
  RECRUIT_THRESHOLD: 25,
  UPGRADE_THRESHOLD: 60,

  // Военные
  ATTACK_RADIUS: 0.12,
  DEFEND_RADIUS: 0.15,
  ATTACK_THRESHOLD: 0.8,
  
    // Призыв
  DRAFT_RADIUS: 0.3,            // радиус по графу, мировые единицы
  DRAFT_RESERVE_RATIO: 0.2,     // неприкосновенный резерв: 20% от manpowerMax
  DRAFT_SIEGE_HP_RATIO: 0.5,    // HP < 50% — город не даёт людей

  // ИЗМЕНЕНО: параметры отступления.
  RETREAT_HP_RATIO: 0.3,          // HP < 30% — начать отступление
  RETREAT_END_HP_RATIO: 0.7,      // HP > 70% — вернуться к задаче
  RETREAT_HEAL_RATE: 8,           // HP/сек при лечении в своём городе
  RETREAT_SEARCH_RADIUS: 0.5,     // максимальный радиус поиска своего города

  // Расширение
  CAPTURE_RADIUS: 0.10,

  // Юниты
  MAX_UNITS_PER_TASK: 5,
  PATROL_RADIUS: 0.08,
  SPAWN_JITTER: 0.005,

  // Приоритеты задач
  PRIORITY_DEFEND: 10,
  PRIORITY_CAPTURE_CITY: 9,
  PRIORITY_CAPTURE_PROVINCE: 8,
  PRIORITY_ATTACK: 8,
  PRIORITY_PATROL: 2
};