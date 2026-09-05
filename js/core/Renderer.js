export default class Renderer {
  constructor(canvas, game, camera) {
    this.inputHandler = null;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.camera = camera;
    this.selectionManager = null;
    this.bgImage = null;
    this.bgLoaded = false;
    this.paused = false;

    // ===== ЗОНЫ КОНТРОЛЯ (в мировых координатах) =====
    this.fogMode = 0; // 0 = все зоны, 1 = только спорные, 2 = выкл
    this.fogCityRadius = 0.12;   // мировые единицы
    this.fogUnitRadius = 0.07;   // мировые единицы
  }

  showPauseOverlay(paused) {
    this.paused = paused;
  }

  setSelectionManager(manager) {
    this.selectionManager = manager;
  }

  setInputHandler(handler) {
    this.inputHandler = handler;
  }

  setBackgroundImage(img) {
    this.bgImage = img;
    this.bgLoaded = !!img;
  }

  worldToScreen(wx, wy) {
    return this.camera.worldToScreen(wx, wy);
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // ===== ФОН (в мировых координатах, как и вся карта) =====
    if (this.bgLoaded && this.bgImage) {
      const topLeft = this.camera.worldToScreen(0, 0);
      const bottomRight = this.camera.worldToScreen(1, 1);

      const x = topLeft.x;
      const y = topLeft.y;
      const w = bottomRight.x - topLeft.x;
      const h = bottomRight.y - topLeft.y;

      ctx.save();
      ctx.drawImage(this.bgImage, x, y, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#0a0d14";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    const map = this.game.map;
    if (!map) return;

    // ===== ЗОНЫ КОНТРОЛЯ (перед провинциями) =====
    this.drawFogOfWar();

    this.drawProvinces(map.provinces || []);

    const roads = (map.roads || []).filter(r => r.type === 'road' || r.type === undefined);
    const rails = (map.roads || []).filter(r => r.type === 'rail');
    this.drawRoads(roads, "#666666", 2);
    this.drawRoads(rails, "#ffcc00", 3, [6, 4]);

    this.drawFrontline();
    this.drawPoints(map.points || []);
    
    for (const city of this.game.cities || []) {
      this.drawCity(city);
    }

    for (const unit of this.game.units || []) {
      this.drawUnit(unit);
    }

    this.drawUnitTarget();

    // ===== РАМКА ВЫДЕЛЕНИЯ =====
    if (this.selectionManager) {
      const rect = this.selectionManager.getSelectionRect();
      if (rect) {
        const p1 = this.worldToScreen(rect.x1, rect.y1);
        const p2 = this.worldToScreen(rect.x2, rect.y2);
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p1.x - p2.x);
        const h = Math.abs(p1.y - p2.y);

        ctx.save();
        ctx.strokeStyle = 'rgba(74, 158, 255, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.fillStyle = 'rgba(74, 158, 255, 0.08)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // ===== ПАУЗА =====
    if (this.paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = '48px Segoe UI';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⏸ ПАУЗА', this.canvas.width / 2, this.canvas.height / 2 - 20);
      ctx.font = '18px Segoe UI';
      ctx.fillStyle = '#aaaaaa';
      ctx.fillText('Нажмите ESC, чтобы продолжить', this.canvas.width / 2, this.canvas.height / 2 + 40);
      ctx.restore();
    }

    this.drawSelection();
  }

  drawRoads(roads, color, width, dash = null) {
    const ctx = this.ctx;
    if (!roads || roads.length === 0) return;
    
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);

    for (const road of roads) {
      if (!road.points || road.points.length < 2) continue;
      
      ctx.beginPath();
      for (let i = 0; i < road.points.length; i++) {
        const p = road.points[i];
        if (!p) continue;
        const s = this.worldToScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();

      if (this.game.selectedRoad && this.game.selectedRoad.id === road.id) {
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = width + 2;
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  drawProvinces(provinces) {
    const ctx = this.ctx;
    if (!provinces || provinces.length === 0) return;
    
    ctx.save();

    for (const prov of provinces) {
      if (!prov.vertices || prov.vertices.length < 3) continue;

      ctx.beginPath();
      prov.vertices.forEach((p, i) => {
        const s = this.worldToScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();

      let fillColor, strokeColor;
      if (prov.owner === 1) {
        fillColor = "rgba(50, 150, 255, 0.15)";
        strokeColor = "rgba(50, 150, 255, 0.4)";
      } else if (prov.owner === 2) {
        fillColor = "rgba(255, 80, 80, 0.15)";
        strokeColor = "rgba(255, 80, 80, 0.4)";
      } else {
        const hue = (prov.id * 137.508) % 360;
        fillColor = `hsla(${hue}, 70%, 50%, 0.08)`;
        strokeColor = `hsla(${hue}, 70%, 70%, 0.2)`;
      }
      
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();

      if (this.game.selectedProvince && this.game.selectedProvince.id === prov.id) {
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawPoints(points) {
    const ctx = this.ctx;
    if (!points || points.length === 0) return;

    const zoom = this.camera.zoom;
    const baseSize = 5;
    const size = Math.max(2, Math.min(15, baseSize * Math.sqrt(zoom)));

    for (const p of points) {
      const s = this.worldToScreen(p.x, p.y);
      
      if (s.x < -50 || s.x > this.canvas.width + 50 || 
          s.y < -50 || s.y > this.canvas.height + 50) continue;

      ctx.save();

      if (p.isCity) {
        const colors = {
          'city': '#3498db',
          'trade': '#f1c40f',
          'mine': '#95a5a6',
          'farm': '#2ecc71',
          'factory': '#e74c3c',
          'port': '#2980b9',
          'airfield': '#9b59b6'
        };
        ctx.fillStyle = colors[p.cityType] || '#888888';
        
        let r = size * 1.5;
        if (p.cityType === 'city') r = size * 2;
        else if (p.cityType === 'trade') r = size * 1.6;
        
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff44';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.max(8, r * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const icons = {
          'city': '🏛',
          'trade': '💰',
          'mine': '⛏',
          'farm': '🌾',
          'factory': '🏭',
          'port': '⚓',
          'airfield': '✈'
        };
        ctx.fillText(icons[p.cityType] || '•', s.x, s.y + 1);

        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Segoe UI';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const cityName = p.name || `Город #${p.id}`;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(cityName, s.x, s.y - r - 4);
        ctx.shadowBlur = 0;

      } else {
        ctx.fillStyle = '#666666';
        ctx.beginPath();
        ctx.arc(s.x, s.y, size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (this.game.selectedPoint && this.game.selectedPoint.id === p.id) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, size * 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  drawCity(city) {
    const ctx = this.ctx;
    const s = this.worldToScreen(city.x, city.y);

    ctx.save();
    
    if (this.game.selectedCity && this.game.selectedCity.id === city.id) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  drawUnit(unit) {
    const ctx = this.ctx;
    const s = this.worldToScreen(unit.x, unit.y);

    ctx.save();
    
    const color = unit.owner === 1 ? '#00ff88' : '#ff6644';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    
    ctx.beginPath();
    const size = 8;
    ctx.moveTo(s.x + size, s.y);
    ctx.lineTo(s.x - size, s.y - size * 0.6);
    ctx.lineTo(s.x - size, s.y + size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    const barW = 20;
    const barH = 3;
    const hpRatio = Math.max(0, unit.hp / unit.maxHp);
    ctx.fillStyle = '#222222cc';
    ctx.fillRect(s.x - barW/2, s.y + 12, barW, barH);
    ctx.fillStyle = hpRatio > 0.5 ? '#00ff66' : '#ff4444';
    ctx.fillRect(s.x - barW/2, s.y + 12, barW * hpRatio, barH);

    if (unit.owner === 1) {
      ctx.fillStyle = unit.state === 'moving' ? '#ffcc00' : '#8899bb';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(unit.state === 'moving' ? '▶' : '●', s.x, s.y - 12);
    }

    if (this.game.selectedUnit && this.game.selectedUnit.id === unit.id) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  drawUnitTarget() {
    const ctx = this.ctx;
    const unit = this.game.selectedUnit;
    if (!unit || unit.state !== 'moving' || !unit.isAlive()) return;

    const target = this.worldToScreen(unit.targetX, unit.targetY);
    const pos = this.worldToScreen(unit.x, unit.y);

    ctx.save();

    ctx.strokeStyle = "rgba(255, 255, 100, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(255, 255, 100, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(target.x - 4, target.y);
    ctx.lineTo(target.x + 4, target.y);
    ctx.moveTo(target.x, target.y - 4);
    ctx.lineTo(target.x, target.y + 4);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 100, 0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  drawFogOfWar() {
    if (this.fogMode === 2) return;

    const cities = this.game.cities || [];
    const units = this.game.units || [];

    const playerSources = [];
    const aiSources = [];

    for (const city of cities) {
      if (city.owner === this.game.playerId) {
        playerSources.push({ x: city.x, y: city.y, r: this.fogCityRadius, isCity: true });
      } else if (city.owner === this.game.aiId) {
        aiSources.push({ x: city.x, y: city.y, r: this.fogCityRadius, isCity: true });
      }
    }

    for (const unit of units) {
      if (!unit.isAlive()) continue;
      if (unit.owner === this.game.playerId) {
        playerSources.push({ x: unit.x, y: unit.y, r: this.fogUnitRadius, isCity: false });
      } else if (unit.owner === this.game.aiId) {
        aiSources.push({ x: unit.x, y: unit.y, r: this.fogUnitRadius, isCity: false });
      }
    }

    if (this.fogMode === 0) {
      for (const s of playerSources) {
        this.drawFogZone(s.x, s.y, s.r, '40, 220, 120', s.isCity ? 0.42 : 0.28);
      }
      for (const s of aiSources) {
        this.drawFogZone(s.x, s.y, s.r, '255, 70, 70', s.isCity ? 0.36 : 0.22);
      }
    }

    if (this.fogMode === 0 || this.fogMode === 1) {
      for (const p of playerSources) {
        for (const a of aiSources) {
          const dx = p.x - a.x;
          const dy = p.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const overlap = p.r + a.r - d;

          if (overlap > 0) {
            const t = p.r / (p.r + a.r);
            const cx = p.x + (a.x - p.x) * t;
            const cy = p.y + (a.y - p.y) * t;
            const contestRadius = Math.min(overlap * 0.7, Math.min(p.r, a.r) * 0.85);

            if (contestRadius > 0.01) {
              this.drawFogZone(cx, cy, contestRadius, '255, 200, 50', 0.38);
            }
          }
        }
      }
    }
  }

  drawFogZone(cx, cy, radius, rgb, intensity) {
    const ctx = this.ctx;

    const screenPos = this.worldToScreen(cx, cy);

    const p1 = this.worldToScreen(cx, cy);
    const p2 = this.worldToScreen(cx + radius, cy);
    const pixelRadius = Math.abs(p2.x - p1.x);

    if (pixelRadius < 1) return;

    const g = ctx.createRadialGradient(
      screenPos.x, screenPos.y, 0,
      screenPos.x, screenPos.y, pixelRadius
    );
    g.addColorStop(0,   `rgba(${rgb}, ${intensity})`);
    g.addColorStop(0.45, `rgba(${rgb}, ${intensity * 0.7})`);
    g.addColorStop(0.75, `rgba(${rgb}, ${intensity * 0.28})`);
    g.addColorStop(1,   `rgba(${rgb}, 0)`);

    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, pixelRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFrontline() {
    const ctx = this.ctx;
    const provinces = this.game.map.provinces || [];

    for (let i = 0; i < provinces.length; i++) {
      const prov = provinces[i];
      if (!prov.vertices || prov.vertices.length < 3) continue;
      if (prov.owner === 0) continue;

      for (let j = i + 1; j < provinces.length; j++) {
        const neighbor = provinces[j];
        if (!neighbor.vertices || neighbor.vertices.length < 3) continue;
        if (neighbor.owner === 0) continue;
        if (neighbor.owner === prov.owner) continue;

        const edge = this.getSharedEdge(prov, neighbor);
        if (edge) {
          const p1 = this.worldToScreen(edge[0].x, edge[0].y);
          const p2 = this.worldToScreen(edge[1].x, edge[1].y);

          ctx.save();
          ctx.strokeStyle = '#ffdd44';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#ffdd44';
          ctx.shadowBlur = 12;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }
    }
  }

  getSharedEdge(prov1, prov2) {
    const v1 = prov1.vertices || [];
    const v2 = prov2.vertices || [];
    const eps = 0.0001;

    for (let i = 0; i < v1.length; i++) {
      const a = v1[i];
      const b = v1[(i + 1) % v1.length];
      for (let j = 0; j < v2.length; j++) {
        const c = v2[j];
        const d = v2[(j + 1) % v2.length];
        if (this.segmentsEqual(a, b, c, d, eps)) {
          return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
        }
      }
    }
    return null;
  }

  segmentsEqual(a, b, c, d, eps = 0.0001) {
    const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    return (dist(a, c) < eps && dist(b, d) < eps) ||
           (dist(a, d) < eps && dist(b, c) < eps);
  }

  drawSelection() {}
}