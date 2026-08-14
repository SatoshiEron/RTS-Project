export default class InputHandler {
  constructor(canvas, game, renderer, camera, cityPanel) {
    this.canvas = canvas;
    this.game = game;
    this.renderer = renderer;
    this.camera = camera;
    this.cityPanel = cityPanel;

    // Флаги для обработки кликов
    this.isPointerDown = false;
    this.pointerStartX = 0;
    this.pointerStartY = 0;

    // Отключаем контекстное меню на Canvas
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ЛКМ — захват нажатия
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    // ЛКМ — отпускание и проверка на клик
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
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

    // Если кнопка не была зажата — выходим
    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    // Проверяем, был ли это drag (движение мыши) или клик
    const dx = e.clientX - this.pointerStartX;
    const dy = e.clientY - this.pointerStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Если курсор сместился больше чем на 5px — это drag, не клик
    if (dist > 5) return;

    // Если это был клик — обрабатываем
    this.handleClick(e);
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = this.camera.screenToWorld(sx, sy);

    // ===== 1. ПРОВЕРКА КЛИКА ПО ЮНИТУ =====
    const unit = this.game.getUnitAt(wx, wy);
    if (unit && unit.owner === this.game.playerId && unit.isAlive()) {
      if (this.game.selectedUnit && this.game.selectedUnit.id === unit.id) {
        this.game.selectedUnit = null;
        this.game.selectedCity = null;
        this.game.selectedProvince = null;
        this.game.selectedPoint = null;
        this.game.selectedUnits = [];
        if (this.cityPanel) this.cityPanel.hide();
        console.log('🔓 Юнит сброшен');
        return;
      }
      this.game.selectedUnit = unit;
      this.game.selectedPoint = null;
      this.game.selectedCity = null;
      this.game.selectedProvince = null;
      this.game.selectedUnits = [];
      if (this.cityPanel) this.cityPanel.hide();
      console.log(`🎯 Выбран юнит #${unit.id}`);
      return;
    }

    // ===== 2. ДВИЖЕНИЕ ГРУППЫ =====
    if (this.game.selectedUnits.length > 0) {
      if (this.game.isWalkable(wx, wy)) {
        for (const u of this.game.selectedUnits) {
          if (u && u.isAlive()) {
            u.setTarget(
              wx + (Math.random() - 0.5) * 0.005,
              wy + (Math.random() - 0.5) * 0.005
            );
            u.aiState = 'moving';
          }
        }
        console.log(`🔄 Группа (${this.game.selectedUnits.length} юнитов) движется`);
        return;
      } else {
        console.warn('⚠️ Нельзя ходить по воде!');
        return;
      }
    }

    // ===== 3. ДВИЖЕНИЕ ОДИНОЧНОГО ЮНИТА =====
    if (this.game.selectedUnit && this.game.selectedUnit.owner === this.game.playerId) {
      const unitAtTarget = this.game.getUnitAt(wx, wy);
      if (unitAtTarget && unitAtTarget.id !== this.game.selectedUnit.id && unitAtTarget.owner === this.game.playerId) {
        console.warn('⚠️ Точка занята другим юнитом!');
        return;
      }

      if (this.game.isWalkable(wx, wy)) {
        this.game.selectedUnit.setTarget(wx, wy);
        this.game.selectedUnit.aiState = 'moving';
        console.log(`🔄 Юнит #${this.game.selectedUnit.id} движется`);
        return;
      } else {
        console.warn('⚠️ Нельзя ходить по воде!');
        return;
      }
    }

    // ===== 4. ПРОВЕРКА ГОРОДОВ =====
    const city = this.game.getCityAt(wx, wy);
    if (city) {
      this.game.selectedCity = city;
      this.game.selectedPoint = null;
      this.game.selectedProvince = null;
      this.game.selectedUnit = null;
      this.game.selectedUnits = [];
      if (this.cityPanel) {
        this.cityPanel.show(city);
      }
      return;
    }

    // ===== 5. ПРОВЕРКА ТОЧЕК =====
    const point = this.findClosestPoint(wx, wy);
    if (point) {
      this.game.selectedPoint = point;
      this.game.selectedProvince = null;
      this.game.selectedCity = null;
      this.game.selectedUnit = null;
      this.game.selectedUnits = [];
      if (this.cityPanel) this.cityPanel.hide();
      return;
    }

    // ===== 6. ПРОВЕРКА ПРОВИНЦИЙ =====
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

    // ===== 7. СБРОС ВСЕГО =====
    this.game.selectedPoint = null;
    this.game.selectedProvince = null;
    this.game.selectedCity = null;
    this.game.selectedUnit = null;
    this.game.selectedUnits = [];
    if (this.cityPanel) this.cityPanel.hide();
    console.log('🔓 Всё сброшено');
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