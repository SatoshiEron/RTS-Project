import AIConfig from './AIConfig.js';
import AIStateManager from './AIStateManager.js';
import EconomyAI from './EconomyAI.js';
import DefenseAI from './DefenseAI.js';
import MilitaryAI from './MilitaryAI.js';
import ExpansionAI from './ExpansionAI.js';

export default class AISystem {
  constructor(game) {
    this.game = game;
    this.thinkTimer = 0;

    this.stateManager = new AIStateManager(game);
    this.economy = new EconomyAI(game);
    this.defense = new DefenseAI(game);
    this.military = new MilitaryAI(game);
    this.expansion = new ExpansionAI(game);
  }

    update(dt) {
    // ИЗМЕНЕНО: ИИ не думает до старта игры (драфт не завершён).
    if (!this.game.gameStarted) return;

    this.thinkTimer += dt;
    if (this.thinkTimer < AIConfig.THINK_INTERVAL) return;
    this.thinkTimer = 0;

    // ИЗМЕНЕНО: мобилизация ИИ — проверка раз в игровую неделю
    // (mobilization v2).
    if (this.mobCheckDay === undefined) this.mobCheckDay = 0;
    if (this.game.gameDay >= this.mobCheckDay) {
      this.mobCheckDay = this.game.gameDay + 7;
      this.updateMobilizationAI();
    }

    this.economy.update();

    // 2. Оценка угроз
    const threats = this.defense.assessThreats();

    // 3. Сбор задач
    let tasks = [];

    // Военные задачи (защита или атака)
    const militaryTasks = this.military.update(threats);
    tasks = tasks.concat(militaryTasks);

    // Задачи на расширение (города + провинции)
    const expansionTasks = this.expansion.getTasks(); // ← ИСПРАВЛЕНО
    tasks = tasks.concat(expansionTasks);

    // 4. Назначение задач юнитам
    const freeUnits = this.stateManager.getFreeUnits();

    for (const unit of freeUnits) {
      const bestTask = this.findBestTask(tasks);
      if (bestTask) {
        this.stateManager.assignTask(unit, bestTask);
      } else {
        this.assignPatrol(unit);
      }
    }

    // 5. Очистка выполненных задач
    this.cleanupTasks(tasks);
  }

  // ИЗМЕНЕНО: мобилизация ИИ (mobilization v2).
  // Базовая — 8% в мире; при войне с боевыми контактами за последние
  // 30 дней — рост до 20% шагом 2% в неделю; месяц тишины — обратно к 8%.
  updateMobilizationAI() {
    const game = this.game;
    if (!game.setMobilization) return;

    const atWar = game.isAtWar(game.aiId, game.playerId);
    const recentCombat =
      game.lastCombatDay !== null &&
      (game.gameDay - game.lastCombatDay) <= 30;

    let target = 0.08;

    if (atWar && recentCombat) {
      const eco = game.getFactionEconomy(game.aiId);
      const current = eco ? eco.mobilizationTarget : 0.08;
      target = Math.min(0.20, current + 0.02);
    }

    game.setMobilization(game.aiId, target);
  }

  findBestTask(tasks) {
    const available = tasks.filter(t => !t.completed && t.assignedUnits < t.maxUnits);
    if (available.length === 0) return null;
    available.sort((a, b) => b.priority - a.priority);
    return available[0];
  }

  assignPatrol(unit) {
    const home = this.game.cities.find(c => c.owner === this.game.aiId);
    if (!home) return;

    const px = home.x + (Math.random() - 0.5) * AIConfig.PATROL_RADIUS;
    const py = home.y + (Math.random() - 0.5) * AIConfig.PATROL_RADIUS;

    if (this.game.isWalkable(px, py)) {
      unit.setTarget(px, py);
    } else {
      unit.setTarget(home.x, home.y);
    }
    unit.aiState = 'patrol';
  }

  cleanupTasks(tasks) {
    for (const task of tasks) {
      if (task.completed) continue;

      const assigned = this.game.units.filter(u =>
        u.owner === this.game.aiId &&
        u.isAlive() &&
        u.aiTask?.id === task.id
      );

      if (assigned.length === 0 && task.assignedUnits > 0) {
        task.completed = true;
      }

      const allIdle = assigned.every(u => u.state === 'idle');
      if (allIdle && assigned.length > 0) {
        task.completed = true;
      }
    }
  }
}