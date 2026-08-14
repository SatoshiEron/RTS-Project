export default class Camera {
  constructor(canvas) {
    this.canvas = canvas;

    this.worldWidth = 1;
    this.worldHeight = 1;

    this.zoom = 1;
    this.minZoom = 0.5;
    this.maxZoom = 4;

    this.offsetX = 0;
    this.offsetY = 0;

    // ===== ПАНОРАМИРОВАНИЕ (ПКМ) =====
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    this.initEvents();
  }

  initEvents() {
    // ===== ЗУМ =====
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (e.deltaY < 0) this.zoomInAt(sx, sy);
      else this.zoomOutAt(sx, sy);
    }, { passive: false });

    // ===== ПАНОРАМИРОВАНИЕ (ПКМ) =====
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.canvas.style.cursor = "grabbing";
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isPanning) return;
      const dx = e.clientX - this.panStartX;
      const dy = e.clientY - this.panStartY;
      this.pan(dx, dy);
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 2) {
        this.isPanning = false;
        this.canvas.style.cursor = "default";
      }
    });

    // ===== ДВОЙНОЙ КЛИК — ПРИБЛИЖЕНИЕ =====
    this.canvas.addEventListener("dblclick", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      this.zoomInAt(sx, sy);
    });

    // ===== ОТКЛЮЧАЕМ КОНТЕКСТНОЕ МЕНЮ =====
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  centerOnWorld() {
    const screenW = this.canvas.width;
    const screenH = this.canvas.height;

    const worldPixelW = this.worldWidth * this.zoom * screenW;
    const worldPixelH = this.worldHeight * this.zoom * screenH;

    this.offsetX = (screenW - worldPixelW) / 2;
    this.offsetY = (screenH - worldPixelH) / 2;
  }

  zoomAt(factor, sx, sy) {
    const oldZoom = this.zoom;
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    if (newZoom === oldZoom) return;

    const wx = (sx - this.offsetX) / (this.canvas.width * oldZoom);
    const wy = (sy - this.offsetY) / (this.canvas.height * oldZoom);

    this.zoom = newZoom;

    const newSx = wx * this.canvas.width * this.zoom + this.offsetX;
    const newSy = wy * this.canvas.height * this.zoom + this.offsetY;

    this.offsetX += sx - newSx;
    this.offsetY += sy - newSy;
  }

  zoomInAt(sx, sy) {
    this.zoomAt(1.1, sx, sy);
  }

  zoomOutAt(sx, sy) {
    this.zoomAt(1 / 1.1, sx, sy);
  }

  pan(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.canvas.width * this.zoom + this.offsetX,
      y: wy * this.canvas.height * this.zoom + this.offsetY
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.offsetX) / (this.canvas.width * this.zoom),
      y: (sy - this.offsetY) / (this.canvas.height * this.zoom)
    };
  }
}