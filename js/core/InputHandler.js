export default class InputHandler {
  constructor(canvas, game, renderer, camera, cityPanel, unitPanel) {
    this.canvas = canvas;
    this.game = game;
    this.renderer = renderer;
    this.camera = camera;
    this.cityPanel = cityPanel;
    this.unitPanel = unitPanel;

    // ПКМ — движение и атака
    this.canvas.addEventListener('mousedown', this.onRightMouseDown.bind(this));

    // Флаги для обработки кликов
    this.isPointerDown = false;
    this.pointerStartX = 0;
    this.pointerStartY = 0;

    // ИЗМЕНЕНО: DOM-пикер для выбора юнита из стека
    this.unitPicker = null;

    // Двойной клик по одному юниту открывает его панель
    this.lastUnitClick = null;
    this.doubleClickDelay = 350;

    // Отключаем контекстное меню на Canvas
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ЛКМ — захват нажатия
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));

    // ЛКМ — отпускание и проверка на клик
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));

    // ИЗМЕНЕНО: hover-подсветка nearest-candidate-wins
    this.hoverCandidate = null;
    this._lastHoverCheck = 0;
    this._hoverThrottleMs = 100;

    this.canvas.addEventListener('mousemove', this.onCanvasMouseMove.bind(this));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverCandidate = null;
    });

    // ===== КЛАВИАТУРА =====
    window.addEventListener('keydown', (e) => {
      // Не перехватываем ввод в полях ввода (терминал и т.п.).
      const tag = e.target && e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';

      // ИЗМЕНЕНО: переключение слоёв карты — клавиша M (по коду клавиши,
      // работает в любой раскладке, включая русскую).
      if (!typing && e.code === 'KeyM') {
        const mode = this.renderer.toggleMapMode();
        const msg = mode === 'physical'
          ? '🗺️ Слой карты: физический'
          : '🗺️ Слой карты: политический';
        if (typeof window.terminalLog === 'function') {
          window.terminalLog(msg, 'info');
        } else {
          console.log(msg);
        }
        return;
      }

      // ИЗМЕНЕНО: переключение маркеров юнитов — клавиша N (по коду клавиши,
      // работает в любой раскладке, включая русскую).
      if (!typing && e.code === 'KeyN') {
        const mode = this.renderer.toggleUnitMarkerMode();
        const msg = mode === 'faction'
          ? '🎖️ Маркеры юнитов: эмблемы фракций'
          : '🎖️ Маркеры юнитов: типы формирований';
        if (typeof window.terminalLog === 'function') {
          window.terminalLog(msg, 'info');
        } else {
          console.log(msg);
        }
        return;
      }

      if (e.key === 'Escape') {
        // ИЗМЕНЕНО: закрываем пикер по Escape
        if (this.unitPicker) {
          this.hideUnitPicker();
          return;
        }

        // ИЗМЕНЕНО: до старта игры Escape не работает.
        if (!this.game.gameStarted) {
          console.warn('🏙️ Сначала выберите стартовый город');
          return;
        }

        const paused = this.game.togglePause();
        this.renderer.showPauseOverlay(paused);
      }
    });
  }

  onMouseDown(e) {
    // Работаем только с ЛКМ
    if (e.button !== 0) return;

    this.isPointerDown = true;
    this.pointerStartX = e.clientX;
    this.pointerStartY = e.clientY;
  }

  onMouseUp(e) {
    // Работаем только с ЛКМ
    if (e.button !== 0) return;

    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    const dx = e.clientX - this.pointerStartX;
    const dy = e.clientY - this.pointerStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 5) return;

    this.handleClick(e);
  }

  // ИЗМЕНЕНО: поиск nearest candidate под курсором с throttle 100 мс
  onCanvasMouseMove(e) {
    if (this.game.paused || !this.game.gameStarted || this.game.victoryResolved) {
      if (this.hoverCandidate !== null) this.hoverCandidate = null;
      return;
    }

    const now = performance.now();
    if (now - this._lastHoverCheck < this._hoverThrottleMs) return;
    this._lastHoverCheck = now;

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);

    const candidates = this.game.getClickTargets(wx, wy);

    this.hoverCandidate = candidates.length > 0 ? candidates[0] : null;
  }

  onRightMouseDown(e) {
    if (e.button !== 2) return;

    // ИЗМЕНЕНО: до старта игры ПКМ заблокирована.
    if (!this.game.gameStarted) {
      console.warn('🏙️ Сначала выберите стартовый город');
      return;
    }

    if (this.game.paused || this.game.victoryResolved) {
      return;
    }

    // ИЗМЕНЕНО: ПКМ закрывает открытый пикер
    this.hideUnitPicker();

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);

    // ===== 1. АТАКА ПО ВРАГУ =====
    const targetUnit = this.game.getUnitAt(wx, wy);

    if (
      targetUnit &&
      targetUnit.owner !== this.game.playerId &&
      targetUnit.isAlive()
    ) {
      if (this.game.selectedUnits.length > 0) {
        for (const u of this.game.selectedUnits) {
          if (
            u &&
            u.isAlive() &&
            u.owner === this.game.playerId
          ) {
            u.setTarget(targetUnit.x, targetUnit.y);
            u.aiState = 'attacking';
            u.targetUnit = targetUnit;
          }
        }

        console.log(`⚔️ Группа атакует юнита #${targetUnit.id}`);
        return;
      }

      if (
        this.game.selectedUnit &&
        this.game.selectedUnit.owner === this.game.playerId &&
        this.game.selectedUnit.isAlive()
      ) {
        this.game.selectedUnit.setTarget(targetUnit.x, targetUnit.y);
        this.game.selectedUnit.aiState = 'attacking';
        this.game.selectedUnit.targetUnit = targetUnit;

        console.log(
          `⚔️ Юнит #${this.game.selectedUnit.id} атакует юнита #${targetUnit.id}`
        );

        return;
      }

      console.warn('⚠️ Нет выбранных юнитов для атаки');
      return;
    }

    // ===== 2. ДВИЖЕНИЕ ГРУППЫ =====
    if (this.game.selectedUnits.length > 0) {
      // ИЗМЕНЕНО: проверяем каждого юнита (морпехи могут, танки — нет).
      const aliveUnits = this.game.selectedUnits.filter(
        (u) => u && u.isAlive() && u.owner === this.game.playerId
      );

      const allWalkable = aliveUnits.every((u) =>
        this.game.isWalkable(wx, wy, u)
      );

      if (allWalkable && aliveUnits.length > 0) {
        for (const u of aliveUnits) {
          u.setTarget(
            wx + (Math.random() - 0.5) * 0.005,
            wy + (Math.random() - 0.5) * 0.005
          );

          u.aiState = 'moving';
          u.targetUnit = null;
        }

        console.log(
          `🔄 Группа (${aliveUnits.length} юнитов) движется`
        );

        return;
      } else {
        this._warnUnwalkable(wx, wy, aliveUnits[0]);
        return;
      }
    }

    // ===== 3. ДВИЖЕНИЕ ОДИНОЧНОГО ЮНИТА =====
    if (
      this.game.selectedUnit &&
      this.game.selectedUnit.owner === this.game.playerId &&
      this.game.selectedUnit.isAlive()
    ) {
      const unitAtTarget = this.game.getUnitAt(wx, wy);

      if (
        unitAtTarget &&
        unitAtTarget.id !== this.game.selectedUnit.id &&
        unitAtTarget.owner === this.game.playerId
      ) {
        console.warn('⚠️ Точка занята другим юнитом!');
        return;
      }

      // ИЗМЕНЕНО: проверка с учётом типа юнита.
      if (this.game.isWalkable(wx, wy, this.game.selectedUnit)) {
        this.game.selectedUnit.setTarget(wx, wy);
        this.game.selectedUnit.aiState = 'moving';
        this.game.selectedUnit.targetUnit = null;

        console.log(`🔄 Юнит #${this.game.selectedUnit.id} движется`);
        return;
      } else {
        this._warnUnwalkable(wx, wy, this.game.selectedUnit);
        return;
      }
    }

    console.warn('⚠️ Нет выбранных юнитов для движения');
  }

  // ИЗМЕНЕНО: понятное сообщение, почему нельзя идти.
  _warnUnwalkable(wx, wy, unit) {
    const prov = this.game.getProvinceAt(wx, wy);

    if (!prov) {
      console.warn('⚠️ Точка вне карты');
      return;
    }

    if (prov.type === 'water') {
      const canSwim = unit && unit.canSwim;
      console.warn(
        canSwim
          ? '⚠️ Морпех не может плыть в эту точку'
          : '⚠️ Нельзя ходить по воде (нужны морпехи)'
      );
      if (typeof window.terminalLog === 'function') {
        window.terminalLog(
          canSwim
            ? '⚠️ Морпех не может плыть в эту точку'
            : '⚠️ Нельзя ходить по воде (нужны морпехи)',
          'warning'
        );
      }
      return;
    }

    const targetOwner = prov.owner || 0;
    const unitOwner = unit ? unit.owner : this.game.playerId;

    if (
      targetOwner !== 0 &&
      targetOwner !== unitOwner &&
      !this.game.isAtWar(unitOwner, targetOwner)
    ) {
      console.warn(
        `⚠️ Чужая провинция (#${prov.id}). В мирное время вход запрещён.`
      );
      if (typeof window.terminalLog === 'function') {
        window.terminalLog(
          `⚠️ Чужая провинция (#${prov.id}). Объявите войну.`,
          'warning'
        );
      }
      return;
    }

    console.warn('⚠️ Путь недоступен');
  }

  handleClick(e) {
    // ИЗМЕНЕНО: если идёт драфт — обрабатываем клик по провинции.
    if (this.game.draft && this.game.draft.active) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);

      if (typeof window.handleDraftClick === 'function') {
        window.handleDraftClick(wx, wy);
      }
      return;
    }

    if (this.game.paused || this.game.victoryResolved) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);

    // ИЗМЕНЕНО: Shift+клик — принудительный выбор города/точки/провинции
    if (e.shiftKey) {
      this.lastUnitClick = null;
      this.selectCityPointOrProvince(wx, wy);
      return;
    }

    // Режим выбора стартового города (не трогаем)
    if (!this.game.gameStarted) {
      const city = this.game.getCityAt(wx, wy);
      if (city) {
        this.game.selectedCity = city;
        this.game.selectedPoint = null;
        this.game.selectedProvince = null;
        this.game.selectedUnit = null;
        this.game.selectedUnits = [];
        if (this.cityPanel) this.cityPanel.hide();
        window.dispatchEvent(new CustomEvent("startcityselected", { detail: { city } }));
        return;
      }
      console.log('🏙️ Кликните по городу, чтобы выбрать его');
      return;
    }

    // ИЗМЕНЕНО: nearest-candidate-wins
    const candidates = this.game.getClickTargets(wx, wy);

    if (candidates.length === 0) {
      this.lastUnitClick = null;
      this.selectCityPointOrProvince(wx, wy);
      return;
    }

    const top = candidates[0];

    if (top.type === "city") {
      this.lastUnitClick = null;
      this.selectCity(top.data);
      return;
    }

    // top.type === "units"
    if (top.data.length === 1) {
      this.selectSingleUnit(top.data[0]);
    } else {
      this.lastUnitClick = null;
      this.showUnitPicker(top.data, sx, sy);
    }
  }

  // ИЗМЕНЕНО: вынесенная логика выбора города/точки/провинции
  selectCityPointOrProvince(wx, wy) {
    const city = this.game.getCityAt(wx, wy);
    if (city) {
      this.selectCity(city);
      return;
    }

    const point = this.findClosestPoint(wx, wy);
    if (point) {
      this.game.selectedPoint = point;
      this.game.selectedProvince = null;
      this.game.selectedCity = null;
      this.game.selectedUnit = null;
      this.game.selectedUnits = [];
      if (this.cityPanel) this.cityPanel.hide();
      if (this.unitPanel) this.unitPanel.hide();
      return;
    }

    const prov = this.game.getProvinceAt(wx, wy);
    if (prov) {
      const name = prov.properties?.name || '';
      if (name.startsWith('Territory_')) {
        this.game.selectedPoint = null;
        this.game.selectedProvince = null;
        this.game.selectedCity = null;
        this.game.selectedUnit = null;
        this.game.selectedUnits = [];
        if (this.cityPanel) this.cityPanel.hide();
        return;
      }
      this.game.selectedProvince = prov;
      this.game.selectedPoint = null;
      this.game.selectedCity = null;
      this.game.selectedUnit = null;
      this.game.selectedUnits = [];
      if (this.cityPanel) this.cityPanel.hide();
      return;
    }

    // Сброс всего
    this.game.selectedPoint = null;
    this.game.selectedProvince = null;
    this.game.selectedCity = null;
    this.game.selectedUnit = null;
    this.game.selectedUnits = [];
    if (this.cityPanel) this.cityPanel.hide();
    if (this.unitPanel) this.unitPanel.hide();
    console.log('🔓 Всё сброшено');
  }

  // =====================================================
  // ИЗМЕНЕНО: ВСПОМОГАТЕЛЬНЫЙ МЕТОД ВЫБОРА ЮНИТА
  // =====================================================

  selectSingleUnit(unit) {
    const now = performance.now();

    const isDoubleClick =
      this.lastUnitClick &&
      this.lastUnitClick.unitId === unit.id &&
      now - this.lastUnitClick.time <= this.doubleClickDelay;

    this.lastUnitClick = {
      unitId: unit.id,
      time: now
    };

    this.selectUnit(unit, Boolean(isDoubleClick));
  }

  selectUnit(unit, openPanel = true) {
    this.game.selectedUnit = unit;
    this.game.selectedPoint = null;
    this.game.selectedCity = null;
    this.game.selectedProvince = null;
    this.game.selectedUnits = [];

    if (this.cityPanel) this.cityPanel.hide();

    if (this.unitPanel) {
      if (openPanel) {
        this.unitPanel.show(unit);
      } else {
        this.unitPanel.hide();
      }
    }

    console.log(`🎯 Выбран юнит #${unit.id}`);
  }

  // =====================================================
  // ИЗМЕНЕНО: ВСПОМОГАТЕЛЬНЫЙ МЕТОД ВЫБОРА ГОРОДА
  // =====================================================
  selectCity(city) {
    this.game.selectedCity = city;
    this.game.selectedPoint = null;
    this.game.selectedProvince = null;
    this.game.selectedUnit = null;
    this.game.selectedUnits = [];

    if (this.unitPanel) this.unitPanel.hide();

    if (this.cityPanel) {
      this.cityPanel.show(city);
    }
  }

  // =====================================================
  // ИЗМЕНЕНО: СОЗДАНИЕ ПИКЕРА СТЕКА
  // =====================================================
  showUnitPicker(units, screenX, screenY) {
    this.hideUnitPicker();
    if (this.unitPanel) this.unitPanel.hide();

    const picker = document.createElement('div');

    picker.className = 'rts-unit-picker';

    picker.style.position = 'fixed';
    picker.style.left = `${screenX + this.canvas.getBoundingClientRect().left}px`;
    picker.style.top = `${screenY + this.canvas.getBoundingClientRect().top}px`;
    picker.style.zIndex = '9999';

    picker.style.display = 'flex';
    picker.style.flexDirection = 'column';
    picker.style.gap = '3px';
    picker.style.padding = '5px';
    picker.style.background = 'rgba(15, 18, 25, 0.94)';
    picker.style.border = '1px solid rgba(255, 255, 255, 0.22)';
    picker.style.borderRadius = '7px';
    picker.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.55)';
    picker.style.backdropFilter = 'blur(4px)';
    picker.style.minWidth = '125px';

    for (const unit of units) {
      const item = this.createUnitPickerItem(unit);

      item.addEventListener('click', (event) => {
        event.stopPropagation();
        this.hideUnitPicker();
        this.lastUnitClick = null;
        this.selectUnit(unit, false);
      });

      item.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        this.hideUnitPicker();
        this.lastUnitClick = null;
        this.selectUnit(unit, true);
      });

      picker.appendChild(item);
    }

    document.body.appendChild(picker);

    this.unitPicker = picker;

    requestAnimationFrame(() => {
      if (!this.unitPicker) return;

      const margin = 8;
      const rect = this.unitPicker.getBoundingClientRect();

      let left = rect.left;
      let top = rect.top;

      if (rect.right > window.innerWidth - margin) {
        left = window.innerWidth - rect.width - margin;
      }

      if (rect.bottom > window.innerHeight - margin) {
        top = window.innerHeight - rect.height - margin;
      }

      if (left < margin) left = margin;
      if (top < margin) top = margin;

      this.unitPicker.style.left = `${left}px`;
      this.unitPicker.style.top = `${top}px`;
    });
  }

  // =====================================================
  // ИЗМЕНЕНО: ЭЛЕМЕНТ ОДНОГО ЮНИТА В ПИКЕРЕ
  // =====================================================
  createUnitPickerItem(unit) {
    const item = document.createElement('button');

    item.type = 'button';
    item.className = 'rts-unit-picker-item';

    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.gap = '6px';
    item.style.width = '100%';
    item.style.height = '28px';
    item.style.padding = '2px 5px';
    item.style.border = '0';
    item.style.borderRadius = '4px';
    item.style.background = 'rgba(255, 255, 255, 0.07)';
    item.style.color = '#ffffff';
    item.style.cursor = 'pointer';
    item.style.fontFamily = 'Segoe UI, sans-serif';
    item.style.fontSize = '12px';
    item.style.textAlign = 'left';

    const icon = document.createElement('span');
    icon.textContent = this.getUnitIcon(unit);
    icon.style.width = '20px';
    icon.style.minWidth = '20px';
    icon.style.textAlign = 'center';
    icon.style.fontSize = '16px';
    icon.style.lineHeight = '20px';

    const hpContainer = document.createElement('div');
    hpContainer.style.flex = '1';
    hpContainer.style.height = '7px';
    hpContainer.style.background = 'rgba(0, 0, 0, 0.55)';
    hpContainer.style.borderRadius = '3px';
    hpContainer.style.overflow = 'hidden';

    const maxHp = Number(unit.maxHp) || 1;
    const hp = Math.max(0, Math.min(Number(unit.hp) || 0, maxHp));
    const hpRatio = hp / maxHp;

    const hpBar = document.createElement('div');
    hpBar.style.height = '100%';
    hpBar.style.width = `${hpRatio * 100}%`;

    if (hpRatio > 0.6) {
      hpBar.style.background = '#35d66f';
    } else if (hpRatio > 0.3) {
      hpBar.style.background = '#e8c547';
    } else {
      hpBar.style.background = '#e74c3c';
    }

    hpContainer.appendChild(hpBar);

    const hpText = document.createElement('span');
    hpText.textContent = `${Math.round(hp)}`;
    hpText.style.width = '30px';
    hpText.style.minWidth = '30px';
    hpText.style.textAlign = 'right';
    hpText.style.fontSize = '10px';
    hpText.style.color = '#cccccc';

    item.appendChild(icon);
    item.appendChild(hpContainer);
    item.appendChild(hpText);

    item.addEventListener('mouseenter', () => {
      item.style.background = 'rgba(255, 255, 255, 0.18)';
    });

    item.addEventListener('mouseleave', () => {
      item.style.background = 'rgba(255, 255, 255, 0.07)';
    });

    return item;
  }

  // =====================================================
  // ИЗМЕНЕНО: ИКОНКА ЮНИТА
  // =====================================================
  getUnitIcon(unit) {
    const type = String(
      unit.type ||
      unit.unitType ||
      unit.category ||
      ''
    ).toLowerCase();

    if (
      type.includes('tank') ||
      type.includes('armor') ||
      type.includes('armour')
    ) {
      return '🛡️';
    }

    if (
      type.includes('artillery') ||
      type.includes('art')
    ) {
      return '💥';
    }

    if (
      type.includes('infantry') ||
      type.includes('soldier') ||
      type.includes('inf')
    ) {
      return '🪖';
    }

    if (
      type.includes('air') ||
      type.includes('plane')
    ) {
      return '✈️';
    }

    if (
      type.includes('ship') ||
      type.includes('naval') ||
      type.includes('fleet')
    ) {
      return '⚓';
    }

    return '⚔️';
  }

  // =====================================================
  // ИЗМЕНЕНО: ЗАКРЫТИЕ ПИКЕРА
  // =====================================================
  hideUnitPicker() {
    if (this.unitPicker) {
      this.unitPicker.remove();
      this.unitPicker = null;
    }
  }

  findClosestPoint(wx, wy, radius = 0.02) {
    let best = null;
    let bestDist = Infinity;

    for (const p of this.game.map.points || []) {
      const dx = p.x - wx;
      const dy = p.y - wy;
      const d2 = dx * dx + dy * dy;

      if (d2 < bestDist && d2 <= radius * radius) {
        bestDist = d2;
        best = p;
      }
    }

    return best;
  }
}