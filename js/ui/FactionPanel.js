export default class FactionPanel {
  constructor(game) {
    this.game = game;
    this.isVisible = false;

    this._build();
    this._bind();

    this.game.factionPanel = this;
    this.hide();
  }

  // ============================================================
  // DOM
  // ============================================================
  _build() {
    // Кнопка открытия — вставим рядом с goldDisplay.
    this.openBtn = document.createElement("button");
    this.openBtn.id = "factionPanelOpenBtn";
    this.openBtn.textContent = "🏛️ Фракция";
    this.openBtn.title = "Управление фракцией";

    const goldDisplay = document.getElementById("goldDisplay");
    if (goldDisplay && goldDisplay.parentNode) {
      goldDisplay.parentNode.insertBefore(this.openBtn, goldDisplay);
    } else {
      document.body.appendChild(this.openBtn);
    }

    // Оверлей.
    this.overlay = document.createElement("div");
    this.overlay.className = "faction-panel-overlay";

    // Сама панель.
    this.panel = document.createElement("div");
    this.panel.className = "faction-panel";

    this.closeBtn = document.createElement("button");
    this.closeBtn.className = "close-btn";
    this.closeBtn.textContent = "✕";

    this.content = document.createElement("div");
    this.content.className = "faction-panel-content";

    this.panel.appendChild(this.closeBtn);
    this.panel.appendChild(this.content);

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.panel);
  }

  _bind() {
    this.openBtn.addEventListener("click", () => this.show());
    this.closeBtn.addEventListener("click", () => this.hide());
    this.overlay.addEventListener("click", () => this.hide());

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isVisible) {
        this.hide();
      }
    });
  }

  // ============================================================
  // ПОКАЗ / СКРЫТИЕ
  // ============================================================
  show() {
    if (!this.game || !this.game.gameStarted) {
      console.warn("🏛️ Панель фракции доступна после старта игры");
      return;
    }

    this.isVisible = true;
    this.render();

    this.overlay.classList.add("visible");
    this.panel.classList.add("visible");
  }

  hide() {
    this.isVisible = false;
    this.overlay.classList.remove("visible");
    this.panel.classList.remove("visible");
  }

  // ============================================================
  // ОТРИСОВКА
  // ============================================================
  render() {
    const game = this.game;
    const pid = game.playerId;
    const eco = game.getFactionEconomy(pid);

    if (!eco) {
      this.content.innerHTML =
        '<div style="color:#ff6666;">❌ Нет данных о фракции</div>';
      return;
    }

    // ---- Считаем суммарные показатели ----
    // ИЗМЕНЕНО: единая казна — весь доход городов целиком.
    let totalCityIncome = 0;

    for (const city of game.cities) {
      if (city.owner !== pid) continue;
      totalCityIncome += game.getCityIncome(city);
    }

    // Доход провинций.
    let provinceIncome = 0;
    for (const prov of game.map.provinces || []) {
      if (prov.owner !== pid) continue;
      if (!prov.vertices || prov.vertices.length < 3) continue;
      provinceIncome += 5;
    }

    // Содержание юнитов.
    const upkeep = game.units.filter(
      (u) => u.owner === pid && u.isAlive()
    ).length;

    // Чистый доход казны.
    const netTreasury = totalCityIncome + provinceIncome - upkeep;

    // ИЗМЕНЕНО: резерв людей фракции.
    const mp = game.getFactionManpower
      ? game.getFactionManpower(pid)
      : { total: 0, max: 0 };

    // ИЗМЕНЕНО: текущая политика призыва.
    const draftPolicy = game.getDraftPolicy
      ? game.getDraftPolicy(pid)
      : 'city';

    // ---- HTML ----
    this.content.innerHTML = `
      <div class="faction-panel-header">
        <h2>🏛️ Управление фракцией</h2>
        <span class="faction-owner">👤 Игрок</span>
      </div>

      <div class="faction-section">
        <div class="faction-section-title">💰 Экономика</div>

        <div class="faction-stat">
          <span class="label">💵 Казна фракции</span>
          <span class="value">${Math.floor(game.playerGold)}💰</span>
        </div>

        <div class="faction-stat">
          <span class="label">🏙️ Доход городов</span>
          <span class="value faction-positive">+${totalCityIncome}💰</span>
        </div>

        <div class="faction-stat">
          <span class="label">🗺️ Доход провинций</span>
          <span class="value faction-positive">+${provinceIncome}💰</span>
        </div>

        <div class="faction-stat">
          <span class="label">⚔️ Содержание юнитов</span>
          <span class="value faction-negative">−${upkeep}💰</span>
        </div>

        <div class="faction-stat faction-stat-total">
          <span class="label">📈 Чистый доход казны</span>
          <span class="value ${netTreasury >= 0 ? "faction-positive" : "faction-negative"}">
            ${netTreasury >= 0 ? "+" : ""}${netTreasury}💰 / цикл
          </span>
        </div>

        <div class="faction-slider-hint" style="margin-top:4px;">
          🏛️ Единая казна: весь доход идёт в общую казну, все траты — из неё.
        </div>

        <!-- ИЗМЕНЕНО: блок призыва -->
        <div class="faction-policy-block">
          <div class="faction-slider-label">
            <span>🎖️ Призыв</span>
          </div>

          <div class="faction-stat">
            <span class="label">👥 Люди (всего)</span>
            <span class="value" id="factionManpower">${mp.total} / ${mp.max}</span>
          </div>

          <div style="display:flex;gap:8px;margin-top:6px;">
            <label style="flex:1;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input
                type="radio"
                name="draftPolicy"
                value="city"
                ${draftPolicy === "city" ? "checked" : ""}
              >
              Город сам
            </label>
            <label style="flex:1;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input
                type="radio"
                name="draftPolicy"
                value="center"
                ${draftPolicy === "center" ? "checked" : ""}
              >
              Центр
            </label>
          </div>
        </div>
      </div>

      <div class="faction-section faction-placeholder">
        <div class="faction-section-title">🌳 Древо технологий</div>
        <div class="faction-placeholder-body">🚧 В разработке</div>
      </div>

      <div class="faction-section faction-placeholder">
        <div class="faction-section-title">📜 Решения</div>
        <div class="faction-placeholder-body">🚧 В разработке</div>
      </div>

      <div class="faction-section faction-placeholder">
        <div class="faction-section-title">🏛️ Политика</div>
        <div class="faction-placeholder-body">🚧 В разработке</div>
      </div>
    `;

    this._bindControls();
  }

  // ============================================================
  // ОБРАБОТЧИКИ
  // ============================================================
  _bindControls() {
    // ИЗМЕНЕНО: обработчики радио «Призыв».
    document.querySelectorAll('input[name="draftPolicy"]').forEach(radio => {
      if (this.game.getDraftPolicy) {
        radio.checked = (this.game.getDraftPolicy(this.game.playerId) === radio.value);
      }

      radio.addEventListener("change", (e) => {
        if (!e.target.checked) return;
        if (!this.game.setDraftPolicy) return;

        this.game.setDraftPolicy(this.game.playerId, e.target.value);
        console.log(`🎖️ Политика призыва: ${e.target.value}`);
      });
    });
  }
}