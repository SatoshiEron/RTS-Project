import AIConfig from './AIConfig.js';

export default class ExpansionAI {
  constructor(game) {
    this.game = game;
  }

  // ===== ЗАДАЧИ НА ЗАХВАТ НЕЙТРАЛЬНЫХ ГОРОДОВ =====
  getCaptureCityTasks() {
    const neutralCities = this.game.cities.filter(c => c.owner === 0);
    const tasks = [];

    for (const city of neutralCities) {
      // Проверяем, есть ли уже задача на этот город
      const existing = this.game.aiTasks.find(t => t.city && t.city.id === city.id);
      if (existing) continue;

      tasks.push({
        id: 0,
        type: 'capture_city',
        target: { x: city.x, y: city.y },
        priority: AIConfig.PRIORITY_CAPTURE_CITY,
        maxUnits: 2,
        assignedUnits: 0,
        completed: false,
        city: city
      });
    }

    return tasks;
  }

  // ===== ЗАДАЧИ НА ЗАХВАТ ПРОВИНЦИЙ =====
  getCaptureProvinceTasks() {
    const neutralProvinces = this.game.map.provinces.filter(p => p.owner === 0 && p.center);
    const tasks = [];

    for (const prov of neutralProvinces) {
      tasks.push({
        id: 0,
        type: 'capture_province',
        target: { x: prov.center.x, y: prov.center.y },
        priority: AIConfig.PRIORITY_CAPTURE_PROVINCE,
        maxUnits: 2,
        assignedUnits: 0,
        completed: false,
        province: prov
      });
    }

    return tasks;
  }

  // ===== ВСЕ ЗАДАЧИ НА РАСШИРЕНИЕ =====
  getTasks() {
    const tasks = [];
    tasks.push(...this.getCaptureCityTasks());
    tasks.push(...this.getCaptureProvinceTasks());
    return tasks;
  }
}