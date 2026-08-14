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
    role = 'infantry'
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
    this.aiState = 'idle';
    this.aiTask = null;
    this.aiPriority = 0;

    this.state = "idle";
  }

  setTarget(tx, ty) {
    this.targetX = tx;
    this.targetY = ty;
    this.state = "moving";
    if (this.aiState === 'idle') {
      this.aiState = 'moving';
    }
  }

  assignTask(task) {
    this.aiTask = task;
    this.aiState = task.type;
    this.aiPriority = task.priority || 5;
    this.setTarget(task.target.x, task.target.y);
  }

  clearTask() {
    this.aiTask = null;
    this.aiState = 'idle';
    this.aiPriority = 0;
  }

  update(dt, game) {
    if (this.state === "dead") return;

    this.updateMovement(dt, game);

    if (this.state === "idle" && game) {
      game.tryCaptureCity(this);
    }

    if (this.aiTask && this.state === "idle") {
      this.aiTask.completed = true;
      this.clearTask();
    }
  }

  updateMovement(dt, game) {
    if (this.state === "dead") return;

    if (this.path.length > 0) {
      this.followPath(dt, game);
      return;
    }

    if (game && !game.isWalkable(this.targetX, this.targetY)) {
      this.state = "idle";
      return;
    }

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.0001) {
      this.state = "idle";
      return;
    }

    const maxStep = this.speed * dt;
    const step = Math.min(maxStep, dist);
    
    const newX = this.x + (dx / dist) * step;
    const newY = this.y + (dy / dist) * step;

    if (game && !game.isWalkable(newX, newY)) {
      this.state = "idle";
      return;
    }

    this.x = newX;
    this.y = newY;
  }

  followPath(dt, game) {
    if (this.path.length === 0) {
      this.state = "idle";
      return;
    }

    const next = this.path[0];
    const dx = next.x - this.x;
    const dy = next.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.001) {
      this.path.shift();
      return;
    }

    const maxStep = this.speed * dt;
    const step = Math.min(maxStep, dist);
    
    const newX = this.x + (dx / dist) * step;
    const newY = this.y + (dy / dist) * step;

    if (game && !game.isWalkable(newX, newY)) {
      this.state = "idle";
      this.path = [];
      return;
    }

    this.x = newX;
    this.y = newY;
  }

  takeDamage(amount) {
    const dmg = Math.max(1, amount - this.defense);
    this.hp -= dmg;

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = "dead";
      this.aiState = "dead";
    }
  }

  isAlive() {
    return this.state !== "dead";
  }

  getDistanceTo(target) {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  getDistanceToXY(tx, ty) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}