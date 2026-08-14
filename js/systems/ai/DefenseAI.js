import AIConfig from './AIConfig.js';

export default class DefenseAI {
  constructor(game) {
    this.game = game;
  }

  assessThreats() {
    const aiCities = this.game.cities.filter(c => c.owner === this.game.aiId);
    const playerUnits = this.game.units.filter(u => u.owner === this.game.playerId && u.isAlive());

    const threats = [];

    for (const city of aiCities) {
      for (const enemy of playerUnits) {
        const dx = enemy.x - city.x;
        const dy = enemy.y - city.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < AIConfig.DEFEND_RADIUS) {
          threats.push({
            city: city,
            enemy: enemy,
            distance: dist,
            priority: AIConfig.PRIORITY_DEFEND
          });
        }
      }
    }

    threats.sort((a, b) => a.distance - b.distance);
    return threats;
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
}