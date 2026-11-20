export default class VictoryPanel {
  constructor(game) {
    this.game = game;

    // ИЗМЕНЕНО: DOM-панель победы/поражения (по аналогии с CityPanel/UnitPanel).
    this.overlay = document.createElement("div");
    this.overlay.className = "victory-panel-overlay";

    this.panel = document.createElement("div");
    this.panel.className = "victory-panel";

    this.content = document.createElement("div");
    this.content.id = "victoryPanelContent";

    this.panel.appendChild(this.content);

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.panel);

    console.log("🏆 VictoryPanel создан");

    // ИЗМЕНЕНО: кнопки обрабатываются через делегирование.
    this.content.addEventListener("click", (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      this.handleAction(action);
    });

    // ИЗМЕНЕНО: закрытие по Escape не даём — победа важнее.
    // Но overlay НЕ закрывает панель (нельзя случайно промахнуться).

    this.isVisible = false;
    this.hide();
  }

  // ============================================================
  // SHOW / HIDE
  // ============================================================

  // winner: "player" | "ai"
  show(winner) {
    if (this.isVisible) return;

    console.log(`🏆 VictoryPanel.show(), winner: ${winner}`);

    this.winner = winner;
    this.render(winner);

    this.overlay.classList.add("visible");
    this.panel.classList.add("visible");
    this.isVisible = true;
  }

  hide() {
    this.overlay.classList.remove("visible");
    this.panel.classList.remove("visible");
    this.isVisible = false;
  }

  // ============================================================
  // RENDER
  // ============================================================

  render(winner) {
    const isPlayerWin = winner === "player";

    const title = isPlayerWin ? "🏆 ПОБЕДА" : "💀 ПОРАЖЕНИЕ";
    const subtitle = isPlayerWin
      ? "Все вражеские города захвачены или юниты уничтожены."
      : "Вы потеряли все города или все ваши юниты уничтожены.";

    const titleClass = isPlayerWin ? "victory" : "defeat";

    // ИЗМЕНЕНО: собираем статистику.
    const playerCities = this.game.cities.filter(
      (c) => c.owner === this.game.playerId
    ).length;

    const aiCities = this.game.cities.filter(
      (c) => c.owner === this.game.aiId
    ).length;

    const playerUnits = this.game.units.filter(
      (u) => u.owner === this.game.playerId && u.isAlive()
    ).length;

    const aiUnits = this.game.units.filter(
      (u) => u.owner === this.game.aiId && u.isAlive()
    ).length;

    const gold = Math.floor(this.game.playerGold || 0);

    this.content.innerHTML = `
      <div class="victory-panel-title ${titleClass}">
        ${title}
      </div>

      <div class="victory-panel-subtitle">
        ${subtitle}
      </div>

      <div class="victory-panel-stats">
        <div class="victory-stat">
          <span class="label">🏙️ Ваши города</span>
          <span class="value">${playerCities}</span>
        </div>
        <div class="victory-stat">
          <span class="label">🏙️ Города ИИ</span>
          <span class="value">${aiCities}</span>
        </div>
        <div class="victory-stat">
          <span class="label">👤 Ваши юниты</span>
          <span class="value">${playerUnits}</span>
        </div>
        <div class="victory-stat">
          <span class="label">🤖 Юниты ИИ</span>
          <span class="value">${aiUnits}</span>
        </div>
        <div class="victory-stat">
          <span class="label">🪙 Золото</span>
          <span class="value">${gold}</span>
        </div>
      </div>

      <div class="victory-panel-actions">
        <button class="action-btn" data-action="continue">
          ▶ Продолжить
        </button>
        <button class="action-btn" data-action="menu">
          🚪 В меню
        </button>
      </div>
    `;
  }

  // ============================================================
  // ACTIONS
  // ============================================================

  handleAction(action) {
    switch (action) {
      case "continue": {
        // ИЗМЕНЕНО: продолжаем игру — скрываем панель,
        // снимаем флаг победы, чтобы не показывать снова.
        console.log("▶ Продолжаем игру после победы");
        this.game.victoryResolved = true;
        this.game.paused = false;
        this.hide();
        break;
      }

      case "menu": {
        // ИЗМЕНЕНО: возврат в меню — перезагрузка страницы.
        console.log("🚪 Возврат в меню");
        window.location.href = "menu.html";
        break;
      }

      default:
        console.warn(`⚠️ Неизвестное действие: ${action}`);
    }
  }
}