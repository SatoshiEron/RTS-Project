export default class CombatSystem {
  constructor(game) {
    this.game = game;

    this.unitAttackRadius = 0.03;
    this.cityAttackRadius = 0.04;
    this.provinceCaptureRadius = 0.05;

    this.captureSpeed = 0.2;
  }

  update(dt) {
    const units = this.game.units.filter(u => u.isAlive());

    // ===== 1. Бои юнит ↔ юнит =====
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        if (a.owner === b.owner) continue;

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.unitAttackRadius) {
          a.state = "fighting";
          b.state = "fighting";

          const dmgA = Math.max(1, a.attack - b.defense);
          const dmgB = Math.max(1, b.attack - a.defense);

          a.takeDamage(dmgB * dt);
          b.takeDamage(dmgA * dt);
        }
      }
    }

    // ===== 2. Осады городов =====
    for (const unit of units) {
      const enemyCities = this.game.cities.filter(c => c.owner !== unit.owner);

      for (const city of enemyCities) {
        const dx = unit.x - city.x;
        const dy = unit.y - city.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.cityAttackRadius) {
          unit.state = "fighting";

          const dmg = Math.max(1, unit.attack - (city.defense || 20));
          city.takeDamage(dmg * dt);

          if (city.isDestroyed()) {
            city.owner = unit.owner;
            city.hp = city.maxHp * 0.5;
          }
        }
      }
    }

    // ===== 3. Захват провинций (с защитой от undefined) =====
    for (const unit of units) {
      const provinces = this.game.map.provinces || [];
      if (!provinces.length) continue;

      for (const prov of provinces) {
        // Вычисляем центр провинции, если его нет
        let centerX, centerY;
        if (prov.center) {
          centerX = prov.center.x;
          centerY = prov.center.y;
        } else if (prov.vertices && prov.vertices.length > 0) {
          // Считаем центр по вершинам
          let sumX = 0, sumY = 0;
          for (const v of prov.vertices) {
            sumX += v.x;
            sumY += v.y;
          }
          centerX = sumX / prov.vertices.length;
          centerY = sumY / prov.vertices.length;
        } else {
          continue; // нет данных — пропускаем
        }

        const dx = unit.x - centerX;
        const dy = unit.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.provinceCaptureRadius) {
          if (prov.owner === unit.owner) continue;

          prov.captureProgress = (prov.captureProgress || 0) + this.captureSpeed * dt;

          if (prov.captureProgress >= 1) {
            prov.owner = unit.owner;
            prov.captureProgress = 0;
          }
        } else {
          if (prov.captureProgress) {
            prov.captureProgress -= dt * 0.1;
            if (prov.captureProgress < 0) prov.captureProgress = 0;
          }
        }
      }
    }

    // ===== 4. Удаляем мёртвых юнитов =====
    this.game.units = this.game.units.filter(u => u.isAlive());
  }
}