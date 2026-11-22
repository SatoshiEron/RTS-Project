export default class CombatSystem {
  constructor(game) {
    this.game = game;

    this.unitAttackRadius = 0.03;
    this.cityAttackRadius = 0.04;
    this.provinceCaptureRadius = 0.05;

    this.captureSpeed = 0.2;

    // ИЗМЕНЕНО: атака происходит раз в 0.6 сек.
    this.attackCooldown = 0.6;

    // ИЗМЕНЕНО: временные визуальные эффекты боя.
    this.combatEffects = [];

    // ИЗМЕНЕНО: длительность волны захвата провинции (сек.)
    this.provinceCaptureEffectLife = 0.7;
  }

  update(dt) {
    const units = this.game.units.filter((u) => u.isAlive());

    // ИЗМЕНЕНО: обновляем временные эффекты.
    this.updateCombatEffects(dt);

    // ============================================================
    // 1. БОИ ЮНИТ ↔ ЮНИТ
    // ============================================================

    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];

        // ИЗМЕНЕНО: защита от дубликатов юнитов в массиве
        if (a === b) continue;
        if (a.id === b.id) continue;

        if (a.owner === b.owner) continue;
        if (!a.isAlive() || !b.isAlive()) continue;

        // ИЗМЕНЕНО: не атаковать, если фракции в мире.
        if (!this.game.isAtWar(a.owner, b.owner)) continue;

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // ИЗМЕНЕНО: радиус атаки из юнита (арта бьёт дальше).
        const aRadius = a.attackRadius || this.unitAttackRadius;
        const bRadius = b.attackRadius || this.unitAttackRadius;
        const maxRadius = Math.max(aRadius, bRadius);

        if (dist < maxRadius) {
          a.combatTargetId = b.id;
          b.combatTargetId = a.id;

          if (!a.movementCommandActive) {
            a.state = "fighting";
          }

          if (!b.movementCommandActive) {
            b.state = "fighting";
          }

          a.attackTimer = Math.max(0, (a.attackTimer || 0) - dt);
          b.attackTimer = Math.max(0, (b.attackTimer || 0) - dt);

          // ======================================================
          // АТАКА A — только если A достаёт до B
          // ======================================================

          if (a.attackTimer <= 0 && a.isAlive() && b.isAlive() && dist < aRadius) {
            const damage = Math.max(1, a.attack - b.defense);

            // ИЗМЕНЕНО: учёт численности и потерь (mobilization v2).
            this.game.lastCombatDay = this.game.gameDay;
            const prevMen = b.men || 0;
            b.takeDamage(damage);
            this.game.onCasualties(b, prevMen);
            a.attackTimer = this.attackCooldown;

            console.log(
              `⚔️ Юнит #${a.id} (${a.typeName || a.type}) нанёс ${damage} урона юниту #${b.id}`
            );

            this.addAttackEffect(a, b, damage);

            if (!b.isAlive()) {
              a.combatTargetId = null;

              if (!a.movementCommandActive) {
                a.state = "idle";
              }

              console.log(`💀 Юнит #${b.id} уничтожен юнитом #${a.id}`);
            }
          }

          // ======================================================
          // АТАКА B — только если B достаёт до A
          // ======================================================

          if (b.attackTimer <= 0 && a.isAlive() && b.isAlive() && dist < bRadius) {
            const damage = Math.max(1, b.attack - a.defense);

            // ИЗМЕНЕНО: учёт численности и потерь (mobilization v2).
            this.game.lastCombatDay = this.game.gameDay;
            const prevMen = a.men || 0;
            a.takeDamage(damage);
            this.game.onCasualties(a, prevMen);
            b.attackTimer = this.attackCooldown;

            console.log(
              `⚔️ Юнит #${b.id} (${b.typeName || b.type}) нанёс ${damage} урона юниту #${a.id}`
            );

            this.addAttackEffect(b, a, damage);

            if (!a.isAlive()) {
              b.combatTargetId = null;

              if (!b.movementCommandActive) {
                b.state = "idle";
              }

              console.log(`💀 Юнит #${a.id} уничтожен юнитом #${b.id}`);
            }
          }
        } else {
          if (a.combatTargetId === b.id) {
            a.combatTargetId = null;

            if (!a.movementCommandActive && a.state === "fighting") {
              a.state = "idle";
            }
          }

          if (b.combatTargetId === a.id) {
            b.combatTargetId = null;

            if (!b.movementCommandActive && b.state === "fighting") {
              b.state = "idle";
            }
          }
        }
      }
    }

    // ============================================================
    // 2. ОСАДЫ ГОРОДОВ
    // ============================================================

    for (const unit of units) {
      if (!unit.isAlive()) continue;

      // ИЗМЕНЕНО: перебираем ВСЕ города, фильтруем внутри цикла.
      for (const city of this.game.cities) {
        // Жёсткая защита: свой город не бьём никогда.
        if (city.owner === unit.owner) continue;

        // Юнит уже захватил этот город.
        if (unit.lastCityId === city.id) continue;
        // ИЗМЕНЕНО: нейтральные города (owner === 0) НЕ бьём.
        // Захват нейтралов идёт только через GameState.tryCaptureCity —
        // юнит входит в город и захватывает мгновенно, без осады.
        if (city.owner === 0) continue;

        // ИЗМЕНЕНО: нельзя атаковать город в мире.
        if (
          city.owner !== 0 &&
          !this.game.isAtWar(unit.owner, city.owner)
        ) {
          continue;
        }

        const dx = unit.x - city.x;
        const dy = unit.y - city.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= this.cityAttackRadius) continue;

        // Если игрок отдал приказ на движение — приказ приоритетнее.
        if (!unit.movementCommandActive) {
          unit.state = "fighting";
        }

        unit.cityAttackTimer = Math.max(
          0,
          (unit.cityAttackTimer || 0) - dt
        );

        if (unit.cityAttackTimer <= 0) {
          // Повторная проверка прямо перед уроном.
          if (city.owner === unit.owner) continue;
          // ИЗМЕНЕНО: ещё одна проверка нейтрала прямо перед уроном.
          if (city.owner === 0) continue;

          const damage = Math.max(1, unit.attack - (city.defense || 20));

          city.takeDamage(damage);
          unit.cityAttackTimer = this.attackCooldown;

          console.log(
            `🏰 Юнит #${unit.id} (${unit.typeName || unit.type}) нанёс ${damage} урона городу "${city.name}" (HP: ${Math.floor(
              city.hp
            )}/${city.maxHp})`
          );

          this.addCityAttackEffect(unit, city, damage);
        }

        if (city.isDestroyed()) {
          city.owner = unit.owner;
          city.hp = city.maxHp * 0.5;
          unit.lastCityId = city.id;

          // ИЗМЕНЕНО: смена владельца через осаду → пересборка территории.
          if (this.game.renderer && this.game.renderer.markTerritoryDirty) {
            this.game.renderer.markTerritoryDirty();
          }

          console.log(
            `🏙️ Город "${city.name}" захвачен юнитом #${unit.id}`
          );

          if (!unit.movementCommandActive) {
            unit.state = "idle";
          }
        }
      }
    }

    // ============================================================
    // 3. ЗАХВАТ ПРОВИНЦИЙ
    // ============================================================

    for (const unit of units) {
      if (!unit.isAlive()) continue;

      const provinces = this.game.map.provinces || [];

      if (!provinces.length) continue;

      for (const prov of provinces) {
        let centerX;
        let centerY;

        if (prov.center) {
          centerX = prov.center.x;
          centerY = prov.center.y;
        } else if (prov.vertices && prov.vertices.length > 0) {
          let sumX = 0;
          let sumY = 0;

          for (const v of prov.vertices) {
            sumX += v.x;
            sumY += v.y;
          }

          centerX = sumX / prov.vertices.length;
          centerY = sumY / prov.vertices.length;
        } else {
          continue;
        }

        const dx = unit.x - centerX;
        const dy = unit.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.provinceCaptureRadius) {
          if (prov.owner === unit.owner) continue;

          if (
            prov.owner !== 0 &&
            !this.game.isAtWar(unit.owner, prov.owner)
          ) {
            continue;
          }

          prov.captureProgress =
            (prov.captureProgress || 0) + this.captureSpeed * dt;

          if (prov.captureProgress >= 1) {
            prov.owner = unit.owner;
            prov.captureProgress = 0;

            console.log(
              `🗺️ Провинция #${prov.id} захвачена юнитом #${unit.id}`
            );

            this.addProvinceCaptureEffect(
              prov,
              centerX,
              centerY,
              unit.owner
            );
          }
        } else {
          if (prov.captureProgress) {
            prov.captureProgress -= dt * 0.1;

            if (prov.captureProgress < 0) {
              prov.captureProgress = 0;
            }
          }
        }
      }
    }

    // ============================================================
    // 4. УДАЛЕНИЕ МЁРТВЫХ ЮНИТОВ
    // ============================================================

    this.game.units = this.game.units.filter((u) => u.isAlive());
  }

  // ============================================================
  // ВИЗУАЛЬНЫЕ ЭФФЕКТЫ БОЯ
  // ============================================================

  addAttackEffect(attacker, target, damage) {
    this.combatEffects.push({
      type: "unitAttack",
      x1: attacker.x,
      y1: attacker.y,
      x2: target.x,
      y2: target.y,
      targetX: target.x,
      targetY: target.y,
      damage,
      life: 0.18,
      maxLife: 0.18,
    });
  }

  addCityAttackEffect(attacker, city, damage) {
    this.combatEffects.push({
      type: "cityAttack",
      x1: attacker.x,
      y1: attacker.y,
      x2: city.x,
      y2: city.y,
      targetX: city.x,
      targetY: city.y,
      damage,
      life: 0.2,
      maxLife: 0.2,
    });
  }

  addProvinceCaptureEffect(prov, centerX, centerY, ownerId) {
    let maxRadius = 0.05;

    if (prov.vertices && prov.vertices.length > 0) {
      for (const v of prov.vertices) {
        const d = Math.hypot(v.x - centerX, v.y - centerY);
        if (d > maxRadius) maxRadius = d;
      }
    }

    this.combatEffects.push({
      type: "provinceCapture",
      x: centerX,
      y: centerY,
      maxRadius,
      ownerId,
      life: this.provinceCaptureEffectLife,
      maxLife: this.provinceCaptureEffectLife,
    });
  }

  updateCombatEffects(dt) {
    if (!this.combatEffects.length) return;

    for (const effect of this.combatEffects) {
      effect.life -= dt;
    }

    this.combatEffects = this.combatEffects.filter(
      (effect) => effect.life > 0
    );
  }
}