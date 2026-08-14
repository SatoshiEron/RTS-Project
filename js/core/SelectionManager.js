export default class SelectionManager {
  constructor(canvas, game, camera, renderer) {
    this.canvas = canvas;
    this.game = game;
    this.camera = camera;
    this.renderer = renderer;

    this.isSelecting = false;
    this.startX = 0;
    this.startY = 0;
    this.endX = 0;
    this.endY = 0;

    if (this.renderer) {
      this.renderer.setSelectionManager(this);
    }

    // ЛКМ — только здесь (capture = true, чтобы перехватить ДО InputHandler)
    this.canvas.addEventListener("mousedown", this.onMouseDown.bind(this), true);
    this.canvas.addEventListener("mousemove", this.onMouseMove.bind(this), true);
    this.canvas.addEventListener("mouseup", this.onMouseUp.bind(this), true);
  }

  onMouseDown(e) {
    if (e.button !== 0) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.camera.screenToWorld(sx, sy);

    // Проверяем, есть ли под курсором юнит или город
    const unit = this.game.getUnitAt(world.x, world.y);
    const city = this.game.getCityAt(world.x, world.y);

    if (unit || city) {
      // Если кликнули по объекту — пусть InputHandler обрабатывает
      return;
    }

    // Начинаем рамку
    this.isSelecting = true;
    this.startX = world.x;
    this.startY = world.y;
    this.endX = world.x;
    this.endY = world.y;
  }

  onMouseMove(e) {
    if (!this.isSelecting) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.camera.screenToWorld(sx, sy);

    this.endX = world.x;
    this.endY = world.y;
  }

  onMouseUp(e) {
    if (!this.isSelecting) return;

    this.isSelecting = false;

    const dx = this.endX - this.startX;
    const dy = this.endY - this.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.001) return;

    this.game.selectUnitsInRect(
      this.startX, this.startY,
      this.endX, this.endY
    );
  }

  getSelectionRect() {
    if (!this.isSelecting) return null;
    return {
      x1: this.startX,
      y1: this.startY,
      x2: this.endX,
      y2: this.endY
    };
  }
}