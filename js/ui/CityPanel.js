import Unit from "../entities/Unit.js";
import { UNIT_TYPES } from "../entities/Unit.js";

export default class CityPanel {
  constructor(game) {
    this.game = game;
    this._boundHandler = null;
    this.isProcessing = false;
    this.currentCity = null;
    this.selectedUnitType = 'infantry';

    this.overlay = document.createElement("div");
    this.overlay.className = "city-panel-overlay";

    this.panel = document.createElement("div");
    this.panel.className = "city-panel";

    this.closeBtn = document.createElement("button");
    this.closeBtn.className = "close-btn";
    this.closeBtn.textContent = "✕";

    this.content = document.createElement("div");
    this.content.id = "cityPanelContent";

    this.panel.appendChild(this.closeBtn);
    this.panel.appendChild(this.content);

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.panel);

    console.log("🏗️ CityPanel создан");

    this.closeBtn.addEventListener("click", () => this.hide());
    this.overlay.addEventListener("click", () => this.hide());

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hide();
      }
    });

    this.game.cityPanel = this;
    this.hide();
  }

  show(city) {
    if (!city) {
      console.warn("⚠️ city не передан!");
      return;
    }

    this.currentCity = city;
    this.render(city);

    this.overlay.classList.add("visible");
    this.panel.classList.add("visible");
  }

  hide() {
    if (!this.panel.classList.contains("visible")) {
      return;
    }

    this.overlay.classList.remove("visible");
    this.panel.classList.remove("visible");

    this.currentCity = null;
    this.isProcessing = false;
  }

  refresh() {
    if (!this.currentCity) {
      return;
    }

    this.render(this.currentCity);
  }

  render(city) {
    if (!city) {
      this.content.innerHTML =
        '<div style="color:#ff6666;padding:20px;">❌ Ошибка: город не найден</div>';
      return;
    }

    const name = city.name || `Город #${city.id}`;
    const level = city.level || 1;
    const maxLevel = this.game.getMaxCityLevel
      ? this.game.getMaxCityLevel()
      : 5;
    const population = Math.floor(city.population || 1000);

    const income = this.game.getCityIncome
      ? this.game.getCityIncome(city)
      : city.income || 10;

    const split = this.game.getCityIncomeSplit
      ? this.game.getCityIncomeSplit(city)
      : { income, treasuryIncome: income, localIncome: 0, share: 1 };

    const localBudget = Math.floor(city.resources || 0);

    const hp = Math.floor(city.hp || 500);
    const maxHp = city.maxHp || 500;
    const type = city.type || "city";

    let ownerName = "🌿 Нейтрал";
    let ownerClass = "neutral";

    if (city.owner === this.game.playerId) {
      ownerName = "👤 Игрок";
      ownerClass = "player";
    } else if (city.owner === this.game.aiId) {
      ownerName = "🤖 ИИ";
      ownerClass = "ai";
    }

    const garrison = city.garrison || 0;
    const isPlayerCity = city.owner === this.game.playerId;

    // ИЗМЕНЕНО (Шаг 1): рабочая сила города.
    const manpower = Math.floor(city.manpower || 0);
    const manpowerMax = Math.floor(city.manpowerMax || 0);

    // ИЗМЕНЕНО (Шаг 1): кнопки найма — по типам формирований.
    const availableTypes = this.game.getAvailableUnitTypes
      ? this.game.getAvailableUnitTypes(city)
      : ['infantry'];

    const source = this.game.getActionBudgetSource
      ? this.game.getActionBudgetSource(city)
      : 'city';

    const budgetLabel = (src) =>
      src === 'city' ? '🏙️ город' : '🏛️ казна';

    // ИЗМЕНЕНО (Шаг 2): кнопки найма с ценой в людях.
    const recruitButtons = Object.keys(UNIT_TYPES).map(t => {
      const stats = UNIT_TYPES[t];
      const allowed = availableTypes.includes(t);
      const check = this.game.canAffordAction
        ? this.game.canAffordAction(city, 'recruit', t)
        : { ok: false, cost: stats.cost, goldOk: false, manpowerOk: false, manpowerNeed: 0 };

      // ИЗМЕНЕНО (Шаг 2): проверка ресурсов.
      const resCheck = this.game.canAffordResources
        ? this.game.canAffordResources(city.owner, {
            ore: stats.oreCost || 0,
            goods: stats.goodsCost || 0,
            food: stats.foodCost || 0,
          })
        : { ok: true, missing: {}, have: {} };

      const disabled = !isPlayerCity || !allowed || !check.ok || !resCheck.ok;

      // ИЗМЕНЕНО (Шаг 2): строка стоимости с людьми.
      const manpowerCost = this.game.getRecruitManpower
        ? this.game.getRecruitManpower(t)
        : 0;

      const costParts = [`${stats.cost}💰`];
      if (manpowerCost > 0) costParts.push(`${manpowerCost}👥`);
      if (stats.oreCost > 0) costParts.push(`${stats.oreCost}🪨`);
      if (stats.goodsCost > 0) costParts.push(`${stats.goodsCost}📦`);
      if (stats.foodCost > 0) costParts.push(`${stats.foodCost}🌾`);
      const costStr = costParts.join(' ');

      let title = '';
      if (!isPlayerCity) {
        title = 'Не ваш город';
      } else if (!allowed) {
        title = `Нельзя нанять в типе «${this.getTypeName(city.type)}»`;
      } else if (!check.ok) {
        // ИЗМЕНЕНО (Шаг 2): различаем goldOk / manpowerOk.
        const parts = [];
        if (check.goldOk === false) {
          parts.push(`не хватает золота (нужно ${stats.cost}💰, есть ${Math.floor(check.budget || 0)}💰)`);
        }
        if (check.manpowerOk === false) {
          parts.push(`не хватает людей (нужно ${check.manpowerNeed}👥)`);
        }
        title = parts.length > 0
          ? `Нельзя нанять: ${parts.join('; ')}`
          : `Нельзя нанять`;
      } else if (!resCheck.ok) {
        const m = resCheck.missing;
        const parts = [];
        if (m.ore > 0) parts.push(`🪨 ${m.ore}`);
        if (m.goods > 0) parts.push(`📦 ${m.goods}`);
        if (m.food > 0) parts.push(`🌾 ${m.food}`);
        title = `Не хватает ресурсов: ${parts.join(', ')}`;
      } else {
        title = `${stats.name}: HP ${stats.hp}, ATK ${stats.attack}, DEF ${stats.defense}, SPD ${stats.speed}`;
      }

      return `
        <button
          class="action-btn unit-type-btn"
          data-action="recruit"
          data-type="${t}"
          ${disabled ? 'disabled' : ''}
          title="${title}"
        >
          <span class="unit-icon">${this.getUnitIcon(t)}</span>
          <span class="unit-name">${stats.name}</span>
          <span class="unit-cost">${costStr}</span>
        </button>
      `;
    }).join('');

    // Кнопка улучшения.
    const upgradeCost = this.game.getUpgradeCost
      ? this.game.getUpgradeCost(city)
      : 30 + level * 15;

    const upgradeCheck = this.game.canAffordAction
      ? this.game.canAffordAction(city, 'upgrade')
      : { ok: false, cost: upgradeCost };

    const canUpgradeLevel = this.game.canUpgradeCity
      ? this.game.canUpgradeCity(city)
      : level < 5;

    const upgradeDisabled = !isPlayerCity || !upgradeCheck.ok || !canUpgradeLevel;

    let upgradeTitle = '';
    if (!isPlayerCity) upgradeTitle = 'Не ваш город';
    else if (!canUpgradeLevel) upgradeTitle = 'Достигнут максимальный уровень';
    else if (!upgradeCheck.ok) upgradeTitle = `Не хватает (нужно ${upgradeCost}💰)`;
    else upgradeTitle = `Оплата: ${budgetLabel(source)}`;

    this.content.innerHTML = `
      <div class="city-panel-header">
        <h2>${this.getIcon(type)} ${name}</h2>
        <span class="city-owner ${ownerClass}">${ownerName}</span>
      </div>

      <div class="city-panel-body">
        <div class="city-stat">
          <span class="label">🏛️ Уровень</span>
          <span class="value">${level} / ${maxLevel}</span>
        </div>

        <div class="city-stat">
          <span class="label">👨‍👩‍👧‍👦 Население</span>
          <span class="value">${population.toLocaleString()}</span>
        </div>

        <!-- ИЗМЕНЕНО (Шаг 1): рабочая сила города -->
        <div class="city-stat">
          <span class="label">👥 Люди</span>
          <span class="value">${manpower} / ${manpowerMax}</span>
        </div>

        <div class="city-stat">
          <span class="label">💰 Доход</span>
          <span class="value">+${split.income}/ход</span>
        </div>

        <div class="city-stat">
          <span class="label">🏛️ В казну</span>
          <span class="value">+${split.treasuryIncome} (${Math.round(split.share * 100)}%)</span>
        </div>

        <div class="city-stat">
          <span class="label">🏙️ Остаётся городу</span>
          <span class="value">+${split.localIncome}</span>
        </div>

        <div class="city-stat">
          <span class="label">💵 Бюджет города</span>
          <span class="value">${localBudget}💰</span>
        </div>

        <div class="city-stat">
          <span class="label">⚔️ Гарнизон</span>
          <span class="value">${garrison} юнитов</span>
        </div>

        <div class="city-stat">
          <span class="label">🏗️ Тип</span>
          <span class="value">${this.getTypeName(type)}</span>
        </div>

        <div class="city-stat">
          <span class="label">🛡️ Здоровье</span>
          <span class="value">${hp}/${maxHp}</span>
        </div>

        ${this.renderProduction(city)}
      </div>

      <div class="city-panel-section-title">
        ⚔️ Найм (${budgetLabel(source)})
      </div>

      <div class="unit-type-grid">
        ${recruitButtons}
      </div>

      <div class="city-panel-section-title">
        ⬆️ Улучшение
      </div>

      <div class="city-panel-actions">
        <button
          class="action-btn"
          data-action="upgrade"
          ${upgradeDisabled ? 'disabled' : ''}
          title="${upgradeTitle}"
        >
          ${
            canUpgradeLevel
              ? `⬆️ Улучшить (${upgradeCost}💰 — ${budgetLabel(source)})`
              : `⬆️ Максимальный уровень`
          }
        </button>
      </div>
    `;

    if (this._boundHandler) {
      this.content.querySelectorAll("[data-action]").forEach((btn) => {
        btn.removeEventListener("click", this._boundHandler);
      });
    }

    this._boundHandler = (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      const unitType = e.target.closest('[data-type]')?.dataset.type;
      if (action) {
        this.handleAction(action, city, unitType);
      }
    };

    this.content.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", this._boundHandler);
    });
  }

  async handleAction(action, city, unitType = 'infantry') {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      switch (action) {
        case "recruit": {
          const result = this.game.tryRecruitUnit(city, unitType);

          if (!result.ok) {
            if (result.reason === 'type_not_allowed') {
              this.showNotification(
                `🏙️ ${city.name}: нельзя нанять «${UNIT_TYPES[unitType]?.name || unitType}» в этом типе города.`,
                []
              );
              return;
            }

            // ИЗМЕНЕНО (Шаг 2): не хватает людей.
            if (result.reason === 'not_enough_manpower') {
              const parts = [
                `🏙️ ${city.name}`,
                `⚔️ Найм «${UNIT_TYPES[unitType]?.name || unitType}»`,
                `❌ Не хватает людей: нужно ${result.needed}👥`,
              ];

              const buttons = [];

              // Если политика 'city' — предложить переключить на 'center'.
              if (result.policy === 'city' && this.game.playerId === city.owner) {
                buttons.push({
                  label: '🏛️ Переключить на призыв от центра',
                  onClick: () => {
                    this.game.setDraftPolicy(this.game.playerId, 'center');
                    this.render(city);
                    this.showNotification('🏛️ Призыв переключён на центр.', []);
                  },
                });
              }

              buttons.push({ label: '✖️ Отложить', onClick: () => {} });

              this.showNotification(parts.join('<br>'), buttons);
              return;
            }

            // ИЗМЕНЕНО (Шаг 2): не хватает ресурсов.
            if (result.reason === 'not_enough_resources') {
              const m = result.missing || {};
              const parts = [];
              if (m.ore > 0) parts.push(`🪨 ${m.ore}`);
              if (m.goods > 0) parts.push(`📦 ${m.goods}`);
              if (m.food > 0) parts.push(`🌾 ${m.food}`);

              this.showNotification(
                `🏙️ ${city.name}<br>⚔️ Найм «${UNIT_TYPES[unitType]?.name || unitType}»<br>` +
                `❌ Не хватает ресурсов: ${parts.join(', ')}`,
                [{ label: '✖️ Отложить', onClick: () => {} }]
              );
              return;
            }

            this.showInsufficientFunds(city, "recruit", result, unitType);
            return;
          }

          city.updateGarrison(this.game.units);
          this.render(city);
          break;
        }

        case "upgrade": {
          const result = this.game.tryUpgradeCity(city);

          if (!result.ok) {
            if (result.reason === "max_level") {
              this.showNotification(
                `🏛️ ${city.name} уже максимального уровня.`,
                []
              );
              return;
            }

            this.showInsufficientFunds(city, "upgrade", result);
            return;
          }

          this.render(city);
          break;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // ИЗМЕНЕНО: уведомление о нехватке средств с учётом типа.
  showInsufficientFunds(city, action, result, unitType = null) {
    let actionName = action === "recruit" ? "Найм" : "Улучшение";
    if (unitType && UNIT_TYPES[unitType]) {
      actionName = `Найм «${UNIT_TYPES[unitType].name}»`;
    }

    const cost = result.cost || 0;
    const budget = result.budget || 0;
    const source = result.source || "city";
    const sourceName = source === "city" ? "бюджет города" : "казна фракции";

    const lines = [
      `🏙️ Город: ${city.name}`,
      `⚔️ Действие: ${actionName}`,
      `💰 Стоимость: ${cost}`,
      `💵 Доступно (${sourceName}): ${Math.floor(budget)}`,
    ];

    const buttons = [];

    if (source === "city" && city.owner === this.game.playerId) {
      const centerBudget = this.game.playerGold;
      buttons.push({
        label: `🏛️ Оплатить из казны (${Math.floor(centerBudget)}💰)`,
        onClick: () => {
          this.game.setFundingPolicy(this.game.playerId, "center");
          this.render(city);
          this.showNotification(`🏛️ Финансирование переключено на казну.`, []);
        },
      });
    }

    buttons.push({
      label: "✖️ Отложить",
      onClick: () => {},
    });

    this.showNotification(lines.join("<br>"), buttons);
  }

  showNotification(messageHtml, buttons) {
    const existing = document.querySelector(".city-panel-notification");
    if (existing) existing.remove();

    const popup = document.createElement("div");
    popup.className = "city-panel-notification";

    popup.style.position = "fixed";
    popup.style.top = "50%";
    popup.style.left = "50%";
    popup.style.transform = "translate(-50%, -50%)";
    popup.style.zIndex = "10000";
    popup.style.background = "rgba(15, 18, 25, 0.96)";
    popup.style.border = "1px solid rgba(255, 255, 255, 0.25)";
    popup.style.borderRadius = "10px";
    popup.style.padding = "18px 22px";
    popup.style.boxShadow = "0 8px 28px rgba(0, 0, 0, 0.65)";
    popup.style.color = "#fff";
    popup.style.fontFamily = "Segoe UI, sans-serif";
    popup.style.fontSize = "14px";
    popup.style.lineHeight = "1.6";
    popup.style.maxWidth = "380px";
    popup.style.textAlign = "center";

    const text = document.createElement("div");
    text.innerHTML = messageHtml;
    text.style.marginBottom = buttons.length > 0 ? "14px" : "0";

    popup.appendChild(text);

    if (buttons.length > 0) {
      const btnRow = document.createElement("div");
      btnRow.style.display = "flex";
      btnRow.style.flexDirection = "column";
      btnRow.style.gap = "8px";

      for (const b of buttons) {
        const btn = document.createElement("button");
        btn.textContent = b.label;
        btn.style.padding = "8px 14px";
        btn.style.border = "1px solid rgba(255, 255, 255, 0.25)";
        btn.style.borderRadius = "6px";
        btn.style.background = "rgba(255, 255, 255, 0.08)";
        btn.style.color = "#fff";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "13px";

        btn.addEventListener("mouseenter", () => {
          btn.style.background = "rgba(255, 255, 255, 0.18)";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "rgba(255, 255, 255, 0.08)";
        });
        btn.addEventListener("click", () => {
          popup.remove();
          if (typeof b.onClick === "function") b.onClick();
        });

        btnRow.appendChild(btn);
      }

      popup.appendChild(btnRow);
    }

    document.body.appendChild(popup);

    if (buttons.length === 0) {
      setTimeout(() => {
        popup.addEventListener("click", () => popup.remove());
      }, 0);
    }
  }

  // ИЗМЕНЕНО: что производит город.
  renderProduction(city) {
    const res = this.game.getCityResourceProduction
      ? this.game.getCityResourceProduction(city)
      : { ore: 0, goods: 0, food: 0, gold: 0 };

    const parts = [];
    if (res.gold > 0) parts.push(`💰 +${res.gold}`);
    if (res.ore > 0) parts.push(`🪨 +${res.ore}`);
    if (res.goods > 0) parts.push(`📦 +${res.goods}`);
    if (res.food > 0) parts.push(`🌾 +${res.food}`);

    if (parts.length === 0) return '';

    return `
      <div class="city-stat city-stat-wide">
        <span class="label">🏭 Производит</span>
        <span class="value">${parts.join(' · ')}</span>
      </div>
    `;
  }

  getIcon(type) {
    const icons = {
      city: "🏙️",
      port: "⚓",
      airfield: "🛩️",
      farm: "🌾",
      mine: "⛏️",
      factory: "🏭",
      trade: "💰",
    };
    return icons[type] || "🏙️";
  }

  getTypeName(type) {
    const names = {
      city: "Город",
      port: "Порт",
      airfield: "Аэродром",
      farm: "Ферма",
      mine: "Шахта",
      factory: "Фабрика",
      trade: "Торговля",
    };
    return names[type] || "Город";
  }

  // ИЗМЕНЕНО: иконки для типов формирований.
  getUnitIcon(type) {
    const icons = {
      militia: "👥",
      infantry: "🪖",
      motorized: "🚚",
      armored: "🛡️",
      artillery: "💥",
      marines: "⚓",
    };
    return icons[type] || "⚔️";
  }
}