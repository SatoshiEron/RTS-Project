import { fmtCompact } from "./format.js";

export default class UnitPanel {
  constructor(game) {
    this.game = game;
    // ИЗМЕНЕНО: DOM-панель юнита (по аналогии с CityPanel).
    this.overlay = document.createElement("div");
    this.overlay.className = "unit-panel-overlay";

    this.panel = document.createElement("div");
    this.panel.className = "unit-panel";

    this.closeBtn = document.createElement("button");
    this.closeBtn.className = "close-btn";
    this.closeBtn.textContent = "✕";

    this.content = document.createElement("div");
    this.content.id = "unitPanelContent";

    this.panel.appendChild(this.closeBtn);
    this.panel.appendChild(this.content);

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.panel);

    console.log("🎯 UnitPanel создан");

    // ИЗМЕНЕНО: закрытие.
    this.closeBtn.addEventListener("click", () => this.hide());
    this.overlay.addEventListener("click", () => this.hide());

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hide();
      }
    });

    // ИЗМЕНЕНО: drag&drop панели за заголовок.
    // Позиция НЕ запоминается — при каждом show() панель возвращается
    // к исходной позиции (центр снизу), как в CityPanel.
    this._isDragging = false;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;

    this.panel.addEventListener("mousedown", (e) => {
      // Тянем только за header или за пустые места панели,
      // но НЕ за кнопки и не за контент.
      if (e.target.closest("button")) return;
      if (e.target.closest(".unit-panel-body")) return;
      if (e.target.closest(".unit-panel-actions")) return;

      this._startDrag(e);
    });

    document.addEventListener("mousemove", (e) => {
      if (!this._isDragging) return;
      this._onDrag(e);
    });

    document.addEventListener("mouseup", () => {
      if (!this._isDragging) return;
      this._endDrag();
    });

    this.currentUnit = null;
    this.hide();
  }

  // ============================================================
  // DRAG & DROP
  // ============================================================

  _startDrag(e) {
    this._isDragging = true;

    const rect = this.panel.getBoundingClientRect();

    this._dragOffsetX = e.clientX - rect.left;
    this._dragOffsetY = e.clientY - rect.top;

    // ИЗМЕНЕНО: на время перетаскивания отключаем transition
    // и translateX(-50%), иначе панель будет «прыгать».
    this.panel.style.transition = "none";
    this.panel.style.transform = "none";
    this.panel.style.left = `${rect.left}px`;
    this.panel.style.top = `${rect.top}px`;
    this.panel.style.bottom = "auto";

    this.panel.classList.add("dragging");
    document.body.style.cursor = "grabbing";
  }

  _onDrag(e) {
    const x = e.clientX - this._dragOffsetX;
    const y = e.clientY - this._dragOffsetY;

    // Не даём утащить панель за пределы окна.
    const maxX = window.innerWidth - this.panel.offsetWidth;
    const maxY = window.innerHeight - this.panel.offsetHeight;

    this.panel.style.left = `${Math.max(0, Math.min(maxX, x))}px`;
    this.panel.style.top = `${Math.max(0, Math.min(maxY, y))}px`;
  }

  _endDrag() {
    this._isDragging = false;
    this.panel.classList.remove("dragging");
    document.body.style.cursor = "";
  }

  // ИЗМЕНЕНО: сброс inline-позиции — панель возвращается к исходной.
  _resetPosition() {
    this.panel.style.transition = "";
    this.panel.style.transform = "";
    this.panel.style.left = "";
    this.panel.style.top = "";
    this.panel.style.bottom = "";
  }

  // ============================================================
  // SHOW / HIDE
  // ============================================================

  show(unit) {
    if (!unit) {
      console.warn("⚠️ unit не передан!");
      return;
    }

    console.log("🎯 UnitPanel.show(), unit:", unit);

    this.currentUnit = unit;

    // ИЗМЕНЕНО: перед показом — сброс позиции.
    this._resetPosition();

    this.render(unit);

    this.overlay.classList.add("visible");
    this.panel.classList.add("visible");
  }

  hide() {
    if (!this.panel.classList.contains("visible")) {
      return;
    }

    this.overlay.classList.remove("visible");
    this.panel.classList.remove("visible");

    this.currentUnit = null;

    // ИЗМЕНЕНО: сбрасываем позицию при закрытии.
    this._resetPosition();
  }

  // ИЗМЕНЕНО: обновление открытой панели (HP, state и т.д.).
  refresh() {
    if (!this.currentUnit) return;
    this.render(this.currentUnit);
  }

  // ============================================================
  // RENDER
  // ============================================================

  render(unit) {
    if (!unit) {
      this.content.innerHTML =
        '<div style="color:#ff6666;padding:20px;">❌ Ошибка: юнит не найден</div>';
      return;
    }

    const id = unit.id;
    const role = unit.role || "infantry";

    const hp = Math.max(0, Math.floor(unit.hp || 0));
    const maxHp = Math.max(1, Math.floor(unit.maxHp || 100));
    const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));

    let hpColor = "#35d66f";
    if (hpPercent <= 60) hpColor = "#e8c547";
    if (hpPercent <= 30) hpColor = "#e74c3c";

    const attack = unit.attack || 0;
    const defense = unit.defense || 0;

    const state = unit.state || "idle";
    const stateName = this.getStateName(state);
    const stateIcon = this.getStateIcon(state);

    let ownerName = "🌿 Нейтрал";
    let ownerClass = "neutral";

    if (unit.owner === this.game.playerId) {
      ownerName = "👤 Игрок";
      ownerClass = "player";
    } else if (unit.owner === this.game.aiId) {
      ownerName = "🤖 ИИ";
      ownerClass = "ai";
    }

    const roleName = this.getRoleName(role);
    const roleIcon = this.getRoleIcon(role);

    this.content.innerHTML = `
      <div class="unit-panel-header">
        <h2>${roleIcon} Юнит #${id}</h2>
        <span class="unit-owner ${ownerClass}">${ownerName}</span>
      </div>

      <div class="unit-panel-body">
        <div class="unit-stat">
        <span class="label">🎖️ Тип</span>
        <span class="value">${unit.typeName || this.getRoleName(unit.role)}</span>
      </div>
      <div class="unit-stat">
        <span class="label">💨 Скорость</span>
        <span class="value">${(unit.speed || 0).toFixed(3)}</span>
      </div>

<div class="unit-stat">
  <span class="label">🎯 Радиус атаки</span>
  <span class="value">${(unit.attackRadius || 0.03).toFixed(3)}</span>
</div>
        <div class="unit-stat">
          <span class="label">${stateIcon} Состояние</span>
          <span class="value">${stateName}</span>
        </div>

        <div class="unit-stat unit-stat-wide">
          <span class="label">❤️ HP</span>
          <span class="value">${hp} / ${maxHp}</span>
        </div>

        <!-- ИЗМЕНЕНО: личный состав (mobilization v2) -->
        <div class="unit-stat unit-stat-wide">
          <span class="label">👥 Личный состав</span>
          <span class="value">${fmtCompact(unit.men || 0)} / ${fmtCompact(unit.maxMen || 0)}</span>
        </div>

        <div class="unit-hp-bar">
          <div class="unit-hp-fill" style="width:${hpPercent}%;background:${hpColor};"></div>
        </div>

        <div class="unit-stat">
          <span class="label">⚔️ Атака</span>
          <span class="value">${attack}</span>
        </div>

        <div class="unit-stat">
          <span class="label">🛡️ Защита</span>
          <span class="value">${defense}</span>
        </div>
      </div>

      <div class="unit-panel-actions">
        <button class="action-btn" data-action="stop">
          🛑 Стоп
        </button>

        <button class="action-btn" data-action="garrison">
          🏰 В гарнизон
        </button>
      </div>
    `;

    // ИЗМЕНЕНО: навешиваем обработчики кнопок.
    this.content.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = e.target.dataset.action;
        this.handleAction(action, unit);
      });
    });
  }

  // ============================================================
  // ACTIONS (заглушки)
  // ============================================================

  handleAction(action, unit) {
    switch (action) {
      case "stop":
        // TODO: реализовать сброс приказа движения.
        console.log(`🛑 Стоп: функция в разработке (юнит #${unit.id})`);
        break;

      case "garrison":
        // TODO: реализовать отправку в гарнизон.
        console.log(`🏰 Гарнизон: функция в разработке (юнит #${unit.id})`);
        break;

      default:
        console.warn(`⚠️ Неизвестное действие: ${action}`);
    }
  }

  // ============================================================
  // ХЕЛПЕРЫ
  // ============================================================

  getRoleIcon(role) {
    const r = String(role).toLowerCase();

    if (r.includes("tank") || r.includes("armor") || r.includes("armour")) return "🛡️";
    if (r.includes("art") || r.includes("artillery")) return "💥";
    if (r.includes("inf") || r.includes("infantry") || r.includes("soldier")) return "🪖";
    if (r.includes("air") || r.includes("plane")) return "✈️";
    if (r.includes("ship") || r.includes("naval") || r.includes("fleet")) return "⚓";

    return "⚔️";
  }

  getRoleName(role) {
    const r = String(role).toLowerCase();

    if (r.includes("tank") || r.includes("armor") || r.includes("armour")) return "Танк";
    if (r.includes("art") || r.includes("artillery")) return "Артиллерия";
    if (r.includes("inf") || r.includes("infantry") || r.includes("soldier")) return "Пехота";
    if (r.includes("air") || r.includes("plane")) return "Авиация";
    if (r.includes("ship") || r.includes("naval") || r.includes("fleet")) return "Флот";

    return "Пехота";
  }

  getStateName(state) {
    const names = {
      idle: "Ожидание",
      moving: "Движение",
      fighting: "Бой",
      dead: "Уничтожен",
    };
    return names[state] || state;
  }

  getStateIcon(state) {
    const icons = {
      idle: "●",
      moving: "▶",
      fighting: "⚔",
      dead: "💀",
    };
    return icons[state] || "●";
  }
}