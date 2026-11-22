import { UNIT_TYPES } from "../entities/Unit.js";
import { BALANCE } from "../core/GameState.js";
import { fmtCompact } from "./format.js";

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

    // ИЗМЕНЕНО: автообновление раз в секунду, пока открыта
    // (пул, дата и доходы меняются постоянно).
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => {
      if (this.isVisible) this.render();
    }, 1000);
  }

  hide() {
    this.isVisible = false;
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
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
    // ИЗМЕНЕНО: единая казна — весь доход городов целиком,
    // включая золото специализаций. Значения недельные
    // (экономический цикл = ECONOMY_TICK_DAYS дней).
    const TICK = BALANCE.ECONOMY_TICK_DAYS;
    let totalCityIncome = 0;
    let totalPopulation = 0;
    let cityCount = 0;

    for (const city of game.cities) {
      if (city.owner !== pid) continue;
      totalCityIncome += game.getCityIncome(city) * TICK;
      if (game.getCityResourceProduction) {
        totalCityIncome += game.getCityResourceProduction(city).gold * TICK;
      }
      totalPopulation += city.population || 0;
      cityCount++;
    }

    // Доход провинций (только суша — так работает updateEconomy).
    let provinceIncome = 0;
    let landOwned = 0;
    let landTotal = 0;
    for (const prov of game.map.provinces || []) {
      if (prov.type !== "water") {
        landTotal++;
        if (prov.owner === pid) landOwned++;
      }
      if (prov.owner !== pid) continue;
      if (prov.type === "water") continue;
      if (!prov.vertices || prov.vertices.length < 3) continue;
      provinceIncome += 5 * TICK;
    }

    // Юниты фракции.
    const aliveUnits = game.units.filter(
      (u) => u.owner === pid && u.isAlive()
    );

    // Содержание юнитов (недельное).
    const upkeep = aliveUnits.length * TICK;

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

    // ИЗМЕНЕНО: данные мобилизации и пула резервистов (v2).
    const reserve = game.getReserveInfo
      ? game.getReserveInfo(pid)
      : { target: 0, mobilized: 0, pool: 0, serving: 0, totalPopulation: 0, incomePenalty: 0 };

    // ИЗМЕНЕНО: блок «Призыв» показываем только для старой системы ('local').
    const isLocalManpower = BALANCE.MANPOWER_SYSTEM === 'local';
    const mobilizedPeople = Math.round(reserve.mobilized * reserve.totalPopulation);
    const incomePenaltyPct = (reserve.incomePenalty * 100).toFixed(0);

    // ---- Армия: состав по типам и статусы ----
    const typeCounts = {};
    let moving = 0;
    let fighting = 0;
    let idleReserve = 0;

    for (const u of aliveUnits) {
      const t = u.type || u.role || "infantry";
      typeCounts[t] = (typeCounts[t] || 0) + 1;

      if (u.state === "moving") moving++;
      else if (u.state === "fighting") fighting++;
      else idleReserve++;
    }

    const TYPE_ICONS = {
      militia: "⚒️",
      infantry: "🪖",
      motorized: "🚚",
      armored: "🛡️",
      artillery: "💥",
      marines: "⚓",
    };

    let armyRows = "";
    for (const [type, count] of Object.entries(typeCounts)) {
      const stats = UNIT_TYPES[type];
      const icon = TYPE_ICONS[type] || "⚔️";
      const name = stats ? stats.name : type;
      armyRows += `
        <div class="faction-stat">
          <span class="label">${icon} ${name}</span>
          <span class="value">${count}</span>
        </div>`;
    }
    if (!armyRows) {
      armyRows = `
        <div class="faction-slider-hint" style="margin-top:4px;">
          Нет действующих формирований
        </div>`;
    }

    // ---- Столица ----
    const capital = game.getCapital ? game.getCapital(pid) : null;
    let capitalHtml;
    if (capital && capital.owner === pid) {
      capitalHtml = `
        <div class="faction-stat">
          <span class="label">⭐ ${capital.name}</span>
          <span class="value">ур. ${capital.level}</span>
        </div>
        <div class="faction-stat">
          <span class="label">❤️ Прочность</span>
          <span class="value">${Math.floor(capital.hp)} / ${capital.maxHp}</span>
        </div>
        <div class="faction-stat">
          <span class="label">🛡️ Гарнизон</span>
          <span class="value">${capital.garrison} форм.</span>
        </div>
        <div class="faction-stat">
          <span class="label">💰 Доход (в неделю)</span>
          <span class="value faction-positive">+${game.getCityIncome(capital) * TICK}💰</span>
        </div>`;
    } else if (capital) {
      capitalHtml = `
        <div class="faction-stat">
          <span class="label">⭐ ${capital.name}</span>
          <span class="value faction-negative">❌ захвачена</span>
        </div>`;
    } else {
      capitalHtml = `
        <div class="faction-slider-hint" style="margin-top:4px;">
          Столица не назначена
        </div>`;
    }

    // ---- HTML ----
    this.content.innerHTML = `
      <div class="faction-panel-header">
        <h2>🏛️ Управление фракцией</h2>
        <span class="faction-owner">👤 Игрок</span>
      </div>

      <div class="faction-section">
        <div class="faction-section-title">⭐ Столица</div>
        ${capitalHtml}
      </div>

      <div class="faction-section">
        <div class="faction-section-title">⚔️ Армия — ${aliveUnits.length} форм.</div>

        ${armyRows}

        <div class="faction-stat faction-stat-total">
          <span class="label">📋 Статус</span>
          <span class="value">🥾 ${moving} · ⚔️ ${fighting} · 🏕️ ${idleReserve}</span>
        </div>
        <div class="faction-slider-hint" style="margin-top:4px;">
          🥾 на марше · ⚔️ в бою · 🏕️ в резерве
        </div>
      </div>

      <div class="faction-section">
        <div class="faction-section-title">🗺️ Территория</div>

        <div class="faction-stat">
          <span class="label">🏙️ Города</span>
          <span class="value">${cityCount}</span>
        </div>

        <div class="faction-stat">
          <span class="label">🧭 Провинции (суша)</span>
          <span class="value">${landOwned} из ${landTotal}</span>
        </div>

        <div class="faction-stat">
          <span class="label">👥 Население</span>
          <span class="value">${fmtCompact(totalPopulation)}</span>
        </div>
      </div>

      <!-- ИЗМЕНЕНО: секция мобилизации (mobilization v2) -->
      <div class="faction-section">
        <div class="faction-section-title">🎖️ Мобилизация</div>

        <div class="faction-slider-block">
          <div class="faction-slider-label">
            <span>Целевая мобилизация</span>
            <span id="mobilizationValue">${Math.round(reserve.target * 100)}%</span>
          </div>
          <input
            type="range"
            id="mobilizationSlider"
            min="0"
            max="30"
            step="1"
            value="${Math.round(reserve.target * 100)}"
          />
        </div>

        <div class="faction-stat">
          <span class="label">🪖 Мобилизовано</span>
          <span class="value">${Math.round(reserve.mobilized * 100)}% (${fmtCompact(mobilizedPeople)})</span>
        </div>

        <div class="faction-stat">
          <span class="label">📦 Резерв</span>
          <span class="value">${fmtCompact(reserve.pool)}</span>
        </div>

        <div class="faction-stat">
          <span class="label">⚔️ На службе</span>
          <span class="value">${fmtCompact(reserve.serving)}</span>
        </div>

        <div class="faction-stat">
          <span class="label">📉 Штраф к доходу</span>
          <span class="value faction-negative">−${incomePenaltyPct}%</span>
        </div>
      </div>

      <div class="faction-section">
        <div class="faction-section-title">💰 Экономика</div>

        <div class="faction-stat">
          <span class="label">💵 Казна фракции</span>
          <span class="value">${fmtCompact(Math.floor(game.playerGold))}💰</span>
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
            ${netTreasury >= 0 ? "+" : ""}${netTreasury}💰 / неделю
          </span>
        </div>

        <div class="faction-slider-hint" style="margin-top:4px;">
          🏛️ Единая казна: весь доход идёт в общую казну, все траты — из неё.
        </div>

        <!-- ИЗМЕНЕНО: блок призыва — только для старой системы ('local'). -->
        ${isLocalManpower ? `
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
        </div>` : ''}
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
    // ИЗМЕНЕНО: ползунок мобилизации (mobilization v2).
    const mobSlider = this.content.querySelector("#mobilizationSlider");
    if (mobSlider) {
      mobSlider.addEventListener("input", () => {
        const pct = Number(mobSlider.value);
        const label = this.content.querySelector("#mobilizationValue");
        if (label) label.textContent = pct + "%";
      });

      mobSlider.addEventListener("change", () => {
        const pct = Number(mobSlider.value);
        if (this.game.setMobilization) {
          this.game.setMobilization(this.game.playerId, pct / 100);
        }
        console.log(`🎖️ Мобилизация: ${pct}%`);
      });
    }

    // ИЗМЕНЕНО: обработчики радио «Призыв» (только для системы 'local').
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
