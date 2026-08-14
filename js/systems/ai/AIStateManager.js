export default class AIStateManager {
  constructor(game) {
    this.game = game;
  }

  // Назначить задачу юниту
  assignTask(unit, task) {
    unit.aiTask = task;
    unit.aiState = task.type;
    unit.aiPriority = task.priority || 5;
    unit.setTarget(task.target.x, task.target.y);
    task.assignedUnits = (task.assignedUnits || 0) + 1;
  }

  // Отменить задачу у юнита
  clearTask(unit) {
    unit.aiTask = null;
    unit.aiState = 'idle';
    unit.aiPriority = 0;
  }

  // Получить свободные юниты
  getFreeUnits() {
    return this.game.units.filter(u =>
      u.owner === this.game.aiId &&
      u.isAlive() &&
      u.aiState === 'idle'
    );
  }

  // Получить все юниты с задачей
  getUnitsByTaskType(type) {
    return this.game.units.filter(u =>
      u.owner === this.game.aiId &&
      u.isAlive() &&
      u.aiState === type
    );
  }

  // Проверить, все ли юниты на месте
  isTaskComplete(task) {
    const assigned = this.getUnitsByTaskType(task.type).filter(u => u.aiTask?.id === task.id);
    if (assigned.length === 0 && task.assignedUnits > 0) return true;
    return assigned.every(u => u.state === 'idle');
  }
}