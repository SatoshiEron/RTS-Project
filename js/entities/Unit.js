export default class Unit {
  constructor({
    id,
    owner = 1,
    x,
    y,
    speed = 0.05,
    hp = 100,
    attack = 10,
    defense = 5,
    vision = 0.05,
    provinceId = null,
    role = "infantry",
  }) {
    this.id = id;
    this.owner = owner;

    this.x = x;
    this.y = y;

    this.speed = speed;
    this.hp = hp;
    this.maxHp = hp;

    this.attack = attack;
    this.defense = defense;
    this.vision = vision;

    this.provinceId = provinceId;

    this.targetX = x;
    this.targetY = y;
    this.path = [];

    this.role = role;

    this.aiState = "idle";
    this.aiTask = null;
    this.aiPriority = 0;

    this.state = "idle";

    // ИЗМЕНЕНО:
    // Показывает, что юнит получил явный приказ на движение.
    this.movementCommandActive = false;

    // ИЗМЕНЕНО:
    // ID текущего противника.
    this.combatTargetId = null;

    // ИЗМЕНЕНО:
    // Таймер обычной атаки юнит ↔ юнит.
    this.attackTimer = 0;

    // ИЗМЕНЕНО:
    // Отдельный таймер атаки города.
    this.cityAttackTimer = 0;

    this.lastCityId = null;
  }

  // ============================================================
  // ПРИКАЗ НА ДВИЖЕНИЕ
  // ============================================================

  setTarget(tx, ty) {
    this.targetX = tx;
    this.targetY = ty;

    this.movementCommandActive = true;
    this.state = "moving";

    this.combatTargetId = null;
    this.lastCityId = null;

    if (this.aiState === "idle") {
      this.aiState = "moving";
    }
  }

  assignTask(task) {
    this.aiTask = task;
    this.aiState = task.type;
    this.aiPriority = task.priority || 5;

    this.setTarget(
      task.target.x,
      task.target.y
    );
  }

  clearTask() {
    this.aiTask = null;
    this.aiState = "idle";
    this.aiPriority = 0;
    this.movementCommandActive = false;
  }

  // ============================================================
  // ОСНОВНОЙ UPDATE
  // ============================================================

  update(dt, game) {
    if (!this.isAlive()) return;

    if (
      game &&
      this.lastCityId !== null
    ) {
      const cityAtUnit =
        game.getCityAt(
          this.x,
          this.y,
          0.02
        );

      if (!cityAtUnit) {
        this.lastCityId = null;
      }
    }

    if (this.movementCommandActive) {
      this.updateMovement(dt, game);

      if (this.state === "idle") {
        this.movementCommandActive = false;
      }
    } else {
      const enemiesNearby =
        game.units.filter(
          (u) =>
            u !== this &&
            u.owner !== this.owner &&
            u.isAlive() &&
            Math.hypot(
              u.x - this.x,
              u.y - this.y
            ) < 0.03
        );

      if (
        enemiesNearby.length > 0
      ) {
        this.state = "fighting";

        if (!this.combatTargetId) {
          let nearest = null;
          let nearestDistance =
            Infinity;

          for (
            const enemy of enemiesNearby
          ) {
            const distance =
              Math.hypot(
                enemy.x - this.x,
                enemy.y - this.y
              );

            if (
              distance <
              nearestDistance
            ) {
              nearestDistance =
                distance;

              nearest = enemy;
            }
          }

          if (nearest) {
            this.combatTargetId =
              nearest.id;
          }
        }
      } else {
        if (
          this.state === "fighting"
        ) {
          this.state = "idle";
          this.combatTargetId = null;
        }

        this.updateMovement(
          dt,
          game
        );
      }
    }

    if (
      this.state === "idle" &&
      game
    ) {
      game.tryCaptureCity(this);
    }

    if (
      this.aiTask &&
      this.state === "idle"
    ) {
      this.aiTask.completed = true;
      this.clearTask();
    }
  }

  // ============================================================
  // ОБЫЧНОЕ ДВИЖЕНИЕ
  // ============================================================

  updateMovement(dt, game) {
    if (!this.isAlive()) return;

    if (this.path.length > 0) {
      this.followPath(dt, game);
      return;
    }

    if (
      game &&
      !game.isWalkable(
        this.targetX,
        this.targetY
      )
    ) {
      this.state = "idle";
      this.movementCommandActive = false;
      return;
    }

    const dx =
      this.targetX - this.x;

    const dy =
      this.targetY - this.y;

    const dist = Math.sqrt(
      dx * dx + dy * dy
    );

    if (dist < 0.0001) {
      this.x = this.targetX;
      this.y = this.targetY;

      this.state = "idle";
      this.movementCommandActive = false;

      return;
    }

    // ==========================================================
    // ИЗМЕНЕНО:
    // Скорость зависит от поверхности.
    //
    // Обычная земля = ×1
    // Дорога = ×2
    // ==========================================================

    const speedMultiplier =
      game
        ? game.getMovementSpeedMultiplier(
            this.x,
            this.y
          )
        : 1;

    const maxStep =
      this.speed *
      speedMultiplier *
      dt;

    const step = Math.min(
      maxStep,
      dist
    );

    const newX =
      this.x +
      (dx / dist) * step;

    const newY =
      this.y +
      (dy / dist) * step;

    if (
      game &&
      !game.isWalkable(
        newX,
        newY
      )
    ) {
      this.state = "idle";
      this.movementCommandActive = false;

      return;
    }

    this.x = newX;
    this.y = newY;
  }

  // ============================================================
  // ДВИЖЕНИЕ ПО PATH
  // ============================================================

  followPath(dt, game) {
    if (this.path.length === 0) {
      this.state = "idle";
      this.movementCommandActive = false;

      return;
    }

    const next =
      this.path[0];

    const dx =
      next.x - this.x;

    const dy =
      next.y - this.y;

    const dist = Math.sqrt(
      dx * dx + dy * dy
    );

    if (dist < 0.001) {
      this.x = next.x;
      this.y = next.y;

      this.path.shift();

      if (
        this.path.length === 0
      ) {
        this.state = "idle";
        this.movementCommandActive = false;
      }

      return;
    }

    // ==========================================================
    // ИЗМЕНЕНО:
    // Дорога также ускоряет движение по PATH.
    // ==========================================================

    const speedMultiplier =
      game
        ? game.getMovementSpeedMultiplier(
            this.x,
            this.y
          )
        : 1;

    const maxStep =
      this.speed *
      speedMultiplier *
      dt;

    const step = Math.min(
      maxStep,
      dist
    );

    const newX =
      this.x +
      (dx / dist) * step;

    const newY =
      this.y +
      (dy / dist) * step;

    if (
      game &&
      !game.isWalkable(
        newX,
        newY
      )
    ) {
      this.state = "idle";
      this.path = [];
      this.movementCommandActive = false;

      return;
    }

    this.x = newX;
    this.y = newY;
  }

  // ============================================================
  // УРОН
  // ============================================================

  takeDamage(amount) {
    this.hp -= amount;

    if (this.hp <= 0) {
      this.hp = 0;

      this.state = "dead";
      this.aiState = "dead";

      this.movementCommandActive = false;
      this.combatTargetId = null;

      this.path = [];
      this.lastCityId = null;
    }
  }

  // ============================================================
  // ПРОВЕРКА ЖИЗНИ
  // ============================================================

  isAlive() {
    return (
      this.hp > 0 &&
      this.state !== "dead"
    );
  }

  // ============================================================
  // РАССТОЯНИЕ ДО ЦЕЛИ
  // ============================================================

  getDistanceTo(target) {
    const dx =
      target.x - this.x;

    const dy =
      target.y - this.y;

    return Math.sqrt(
      dx * dx + dy * dy
    );
  }

  getDistanceToXY(tx, ty) {
    const dx =
      tx - this.x;

    const dy =
      ty - this.y;

    return Math.sqrt(
      dx * dx + dy * dy
    );
  }
}