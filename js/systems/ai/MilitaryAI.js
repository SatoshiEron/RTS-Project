import AIConfig from './AIConfig.js';

export default class MilitaryAI {
  constructor(game) {
    this.game = game;
  }

  update(threats) {
    if (threats.length > 0) {
      return this.getDefendTasks(threats);
    }
    return this.getAttackTasks();
  }

  getAttackTasks() {
    const aiUnits = this.game.units.filter(u => u.owner === this.game.aiId && u.isAlive());
    const playerUnits = this.game.units.filter(u => u.owner === this.game.playerId && u.isAlive());
    const playerCities = this.game.cities.filter(c => c.owner === this.game.playerId);

    // Атакуем только если юнитов в 1.5 раза больше
    if (aiUnits.length < playerUnits.length * AIConfig.ATTACK_THRESHOLD) return [];
    if (playerCities.length === 0) return [];

    const target = this.findClosest(playerCities, aiUnits[0]);
    if (!target) return [];

    return [{
      id: 0,
      type: 'attack',
      target: { x: target.x, y: target.y },
      priority: AIConfig.PRIORITY_ATTACK,
      maxUnits: AIConfig.MAX_UNITS_PER_TASK,
      assignedUnits: 0,
      completed: false
    }];
  }

  getDefendTasks(threats) {
    const tasks = [];
    for (const threat of threats) {
      tasks.push({
        id: 0,
        type: 'defend',
        target: { x: threat.enemy.x, y: threat.enemy.y },
        priority: AIConfig.PRIORITY_DEFEND,
        maxUnits: AIConfig.MAX_UNITS_PER_TASK,
        assignedUnits: 0,
        completed: false,
        threat: threat
      });
    }
    return tasks;
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