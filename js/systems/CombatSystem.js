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

        if (a.owner === b.owner) continue;
        if (!a.isAlive() || !b.isAlive()) continue;

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.unitAttackRadius) {
          // ИЗМЕНЕНО:
          // Бой больше НЕ заставляет юниты навсегда стоять.
          // CombatSystem только сообщает им, что они находятся в бою.
          a.combatTargetId = b.id;
          b.combatTargetId = a.id;

          // Если юнит не выполняет приказ на движение,
          // он может находиться в состоянии fighting.
          if (!a.movementCommandActive) {
            a.state = "fighting";
          }

          if (!b.movementCommandActive) {
            b.state = "fighting";
          }

          // ИЗМЕНЕНО:
          // Кулдаун теперь хранится непосредственно у юнита
          // и считается через dt.
          a.attackTimer = Math.max(
            0,
            (a.attackTimer || 0) - dt
          );

          b.attackTimer = Math.max(
            0,
            (b.attackTimer || 0) - dt
          );

          // ======================================================
          // АТАКА A
          // ======================================================

          if (a.attackTimer <= 0 && a.isAlive() && b.isAlive()) {
            const damage = Math.max(
              1,
              a.attack - b.defense
            );

            b.takeDamage(damage);

            a.attackTimer = this.attackCooldown;

            console.log(
              `⚔️ Юнит #${a.id} нанёс ${damage} урона юниту #${b.id}`
            );

            // ИЗМЕНЕНО: визуальный эффект атаки.
            this.addAttackEffect(a, b, damage);

            if (!b.isAlive()) {
              a.combatTargetId = null;

              if (!a.movementCommandActive) {
                a.state = "idle";
              }

              console.log(
                `💀 Юнит #${b.id} уничтожен юнитом #${a.id}`
              );
            }
          }

          // ======================================================
          // АТАКА B
          // ======================================================

          if (b.attackTimer <= 0 && a.isAlive() && b.isAlive()) {
            const damage = Math.max(
              1,
              b.attack - a.defense
            );

            a.takeDamage(damage);

            b.attackTimer = this.attackCooldown;

            console.log(
              `⚔️ Юнит #${b.id} нанёс ${damage} урона юниту #${a.id}`
            );

            // ИЗМЕНЕНО: визуальный эффект атаки.
            this.addAttackEffect(b, a, damage);

            if (!a.isAlive()) {
              b.combatTargetId = null;

              if (!b.movementCommandActive) {
                b.state = "idle";
              }

              console.log(
                `💀 Юнит #${a.id} уничтожен юнитом #${b.id}`
              );
            }
          }
        } else {
          // ИЗМЕНЕНО:
          // Если противники разошлись, бой прекращается.
          if (a.combatTargetId === b.id) {
            a.combatTargetId = null;

            if (
              !a.movementCommandActive &&
              a.state === "fighting"
            ) {
              a.state = "idle";
            }
          }

          if (b.combatTargetId === a.id) {
            b.combatTargetId = null;

            if (
              !b.movementCommandActive &&
              b.state === "fighting"
            ) {
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

      const enemyCities = this.game.cities.filter(
        (c) => c.owner !== unit.owner
      );

      for (const city of enemyCities) {
        // ИЗМЕНЕНО:
        // Юнит уже захватил этот город и всё ещё находится
        // около него. Не позволяем снова наносить ему урон.
        if (unit.lastCityId === city.id) {
          continue;
        }

        // ИЗМЕНЕНО:
        // Дополнительная защита от устаревшего списка enemyCities.
        // Если город уже принадлежит этому юниту/фракции,
        // осада невозможна.
        if (city.owner === unit.owner) {
          continue;
        }

        const dx = unit.x - city.x;
        const dy = unit.y - city.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.cityAttackRadius) {
          // ИЗМЕНЕНО:
          // Если игрок отдал приказ на движение,
          // приказ имеет приоритет и город не блокирует движение.
          if (!unit.movementCommandActive) {
            unit.state = "fighting";
          }

          // ИЗМЕНЕНО:
          // Отдельный таймер осады для каждого юнита.
          unit.cityAttackTimer = Math.max(
            0,
            (unit.cityAttackTimer || 0) - dt
          );

          if (unit.cityAttackTimer <= 0) {
            // ИЗМЕНЕНО:
            // Повторно проверяем владельца прямо перед нанесением урона.
            // Это защищает от ситуации, когда город был захвачен
            // другим юнитом в предыдущей итерации.
            if (city.owner === unit.owner) {
              continue;
            }

            const damage = Math.max(
              1,
              unit.attack - (city.defense || 20)
            );

            city.takeDamage(damage);

            unit.cityAttackTimer = this.attackCooldown;

            console.log(
              `🏰 Юнит #${unit.id} нанёс ${damage} урона городу "${city.name}" (HP: ${Math.floor(
                city.hp
              )}/${city.maxHp})`
            );

            // ИЗМЕНЕНО: визуальный эффект попадания по городу.
            this.addCityAttackEffect(
              unit,
              city,
              damage
            );
          }

          if (city.isDestroyed()) {
            // ИЗМЕНЕНО:
            // Явно передаём владельца города владельцу юнита.
            city.owner = unit.owner;

            city.hp = city.maxHp * 0.5;

            // Защита от повторной атаки/захвата этого же города.
            unit.lastCityId = city.id;

            console.log(
              `🏙️ Город "${city.name}" захвачен юнитом #${unit.id}`
            );

            // После захвата бой с городом прекращается.
            if (!unit.movementCommandActive) {
              unit.state = "idle";
            }
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
        } else if (
          prov.vertices &&
          prov.vertices.length > 0
        ) {
          let sumX = 0;
          let sumY = 0;

          for (const v of prov.vertices) {
            sumX += v.x;
            sumY += v.y;
          }

          centerX =
            sumX / prov.vertices.length;

          centerY =
            sumY / prov.vertices.length;
        } else {
          continue;
        }

        const dx = unit.x - centerX;
        const dy = unit.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.provinceCaptureRadius) {
          if (prov.owner === unit.owner) continue;

          prov.captureProgress =
            (prov.captureProgress || 0) +
            this.captureSpeed * dt;

          if (prov.captureProgress >= 1) {
            prov.owner = unit.owner;
            prov.captureProgress = 0;

            console.log(
              `🗺️ Провинция #${prov.id} захвачена юнитом #${unit.id}`
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

    // ИЗМЕНЕНО:
    // Оставляем этот фильтр, как и раньше.
    // Основная очистка также выполняется GameState.cleanupDeadUnits().
    this.game.units = this.game.units.filter(
      (u) => u.isAlive()
    );
  }

  // ============================================================
  // ВИЗУАЛЬНЫЕ ЭФФЕКТЫ БОЯ
  // ============================================================

  // ИЗМЕНЕНО:
  // Создаёт эффект выстрела/удара между двумя юнитами.
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

  // ИЗМЕНЕНО:
  // Эффект попадания по городу.
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

  // ИЗМЕНЕНО:
  // Уменьшаем время жизни визуальных эффектов.
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