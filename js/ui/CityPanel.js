import Unit from "../entities/Unit.js";

export default class CityPanel {
  constructor(game) {
    this.game = game;
    this._boundHandler = null;
    this.isProcessing = false;

    this.overlay = document.createElement('div');
    this.overlay.className = 'city-panel-overlay';
    
    this.panel = document.createElement('div');
    this.panel.className = 'city-panel';
    
    this.closeBtn = document.createElement('button');
    this.closeBtn.className = 'close-btn';
    this.closeBtn.textContent = '✕';
    
    this.content = document.createElement('div');
    this.content.id = 'cityPanelContent';
    
    this.panel.appendChild(this.closeBtn);
    this.panel.appendChild(this.content);
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.panel);

    console.log('🏗️ CityPanel создан');

    this.closeBtn.addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', () => this.hide());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });

    this.game.cityPanel = this;
    this.hide();
  }

  show(city) {
    console.log('🏙️ show() вызван, city:', city);
    
    if (!city) {
      console.warn('⚠️ city не передан!');
      return;
    }
    
    this.currentCity = city;
    this.render(city);
    
    this.overlay.classList.add('visible');
    this.panel.classList.add('visible');
    
    console.log('✅ Панель должна быть видна');
  }

  hide() {
    if (!this.panel.classList.contains('visible')) return; // ← НЕ ВЫЗЫВАТЬ, ЕСЛИ УЖЕ СКРЫТА
    console.log('❌ hide() вызван');
    this.overlay.classList.remove('visible');
    this.panel.classList.remove('visible');
    this.currentCity = null;
    this.isProcessing = false;
  }

  render(city) {
    console.log('📦 render() вызван для города:', city);
    
    if (!city) {
      this.content.innerHTML = '<div style="color:#ff6666;padding:20px;">❌ Ошибка: город не найден</div>';
      return;
    }

    const name = city.name || `Город #${city.id}`;
    const level = city.level || 1;
    const population = Math.floor(city.population || 1000);
    const income = this.game.getCityIncome ? this.game.getCityIncome(city) : (city.income || 10);
    const hp = Math.floor(city.hp || 500);
    const maxHp = city.maxHp || 500;
    const type = city.type || 'city';
    
    let ownerName = '🌿 Нейтрал';
    let ownerClass = 'neutral';
    if (city.owner === this.game.playerId) {
      ownerName = '👤 Игрок';
      ownerClass = 'player';
    } else if (city.owner === this.game.aiId) {
      ownerName = '🤖 ИИ';
      ownerClass = 'ai';
    }

    const garrison = this.game.units.filter(u => 
      Math.abs(u.x - city.x) < 0.001 && Math.abs(u.y - city.y) < 0.001
    ).length;

    this.content.innerHTML = `
      <div class="city-panel-header">
        <h2>${this.getIcon(type)} ${name}</h2>
        <span class="city-owner ${ownerClass}">${ownerName}</span>
      </div>

      <div class="city-panel-body">
        <div class="city-stat">
          <span class="label">🏛️ Уровень</span>
          <span class="value">${level}</span>
        </div>
        <div class="city-stat">
          <span class="label">👨‍👩‍👧‍👦 Население</span>
          <span class="value">${population.toLocaleString()}</span>
        </div>
        <div class="city-stat">
          <span class="label">💰 Доход</span>
          <span class="value">+${income}/ход</span>
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
      </div>

      <div class="city-panel-actions">
        <button class="action-btn" data-action="recruit">
          ⚔️ Нанять (${this.getRecruitCost(city)}💰)
        </button>
        <button class="action-btn" data-action="upgrade" ${city.owner !== this.game.playerId ? 'disabled' : ''}>
          ⬆️ Улучшить (${this.getUpgradeCost(city)}💰)
        </button>
      </div>
    `;

    if (this._boundHandler) {
      this.content.querySelectorAll('[data-action]').forEach(btn => {
        btn.removeEventListener('click', this._boundHandler);
      });
    }

    this._boundHandler = (e) => {
      const action = e.target.dataset.action;
      this.handleAction(action, city);
    };

    this.content.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', this._boundHandler);
    });
  }

  async handleAction(action, city) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      switch(action) {
        case 'recruit': {
          const cost = this.getRecruitCost(city);
          if (city.owner === this.game.playerId && this.game.playerGold >= cost) {
            this.game.playerGold -= cost;
            const unit = new Unit({
              id: this.game.units.length + 1,
              owner: this.game.playerId,
              x: city.x + (Math.random() - 0.5) * 0.005,
              y: city.y + (Math.random() - 0.5) * 0.005,
              hp: 100,
              attack: 10,
              defense: 5,
              role: 'infantry'
            });
            this.game.units.push(unit);
            console.log(`⚔️ Нанят юнит #${unit.id} в ${city.name}`);
            this.render(city);
          } else {
            alert('❌ Недостаточно золота!');
          }
          break;
        }
        case 'upgrade': {
          const cost = this.getUpgradeCost(city);
          if (city.owner === this.game.playerId && this.game.playerGold >= cost) {
            this.game.playerGold -= cost;
            city.level += 1;
            city.population *= 1.1;
            city.defense = (city.defense || 20) + 5;
            console.log(`⬆️ ${city.name} улучшен до ${city.level} уровня`);
            this.render(city);
          } else {
            alert('❌ Недостаточно золота!');
          }
          break;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  getIcon(type) {
    const icons = {
      city: '🏙️', port: '⚓', airfield: '🛩️',
      farm: '🌾', mine: '⛏️', factory: '🏭', trade: '💰'
    };
    return icons[type] || '🏙️';
  }

  getTypeName(type) {
    const names = {
      city: 'Город', port: 'Порт', airfield: 'Аэродром',
      farm: 'Ферма', mine: 'Шахта', factory: 'Фабрика', trade: 'Торговля'
    };
    return names[type] || 'Город';
  }

  getRecruitCost(city) {
    return 20 + (city.level || 1) * 5;
  }

  getUpgradeCost(city) {
    return 30 + (city.level || 1) * 15;
  }
}