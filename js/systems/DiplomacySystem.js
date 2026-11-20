// ИЗМЕНЕНО: новая отдельная система дипломатии.
// Отвечает только за отношения между фракциями,
// их изменение и историю дипломатических событий.

export default class DiplomacySystem {
  constructor(game) {
    this.game = game;

    // Одна запись на пару фракций.
    // Ключ всегда нормализован: "1:2".
    this.relations = {};

    // История дипломатических действий.
    this.history = [];
  }

  getPairKey(factionA, factionB) {
    const a = Number(factionA);
    const b = Number(factionB);
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  getRelation(factionA, factionB) {
    const a = Number(factionA);
    const b = Number(factionB);

    if (a === b) return "alliance";

    const key = this.getPairKey(a, b);
    return this.relations[key] || "peace";
  }

  setRelation(factionA, factionB, relation, reason = null) {
    const allowed = ["peace", "war", "alliance", "trade"];

    if (!allowed.includes(relation)) {
      throw new Error(`Неизвестное дипломатическое состояние: ${relation}`);
    }

    const key = this.getPairKey(factionA, factionB);
    const previous = this.getRelation(factionA, factionB);

    this.relations[key] = relation;

    return { key, previous, current: relation, reason };
  }

  isAtWar(factionA, factionB) {
    return this.getRelation(factionA, factionB) === "war";
  }

  declareWar(factionA, factionB) {
    const a = Number(factionA);
    const b = Number(factionB);

    if (a === b) {
      return { success: false, reason: "Нельзя объявить войну самому себе." };
    }

    if (this.isAtWar(a, b)) {
      return { success: false, reason: "Фракции уже находятся в состоянии войны." };
    }

    const change = this.setRelation(a, b, "war", "declare_war");
    this.recordEvent("war_declared", a, b, { previous: change.previous });

    console.log(`⚔️ Фракция #${a} объявила войну фракции #${b}`);

    return { success: true, relation: "war" };
  }

  proposePeace(proposerId, targetId) {
    const proposer = Number(proposerId);
    const target = Number(targetId);

    if (!this.isAtWar(proposer, target)) {
      return { success: false, accepted: false, reason: "Между фракциями сейчас нет войны." };
    }

    this.recordEvent("peace_proposed", proposer, target);

    const accepted = this.decidePeaceProposal(proposer, target);

    if (accepted) {
      this.setRelation(proposer, target, "peace", "peace_accepted");
      this.recordEvent("peace_accepted", target, proposer);
      console.log(`🕊️ Фракция #${target} приняла мир с фракцией #${proposer}`);
      return { success: true, accepted: true, relation: "peace" };
    }

    this.recordEvent("peace_rejected", target, proposer);
    console.log(`❌ Фракция #${target} отклонила мир с фракцией #${proposer}`);
    return { success: true, accepted: false, relation: "war" };
  }

  decidePeaceProposal(proposerId, targetId) {
    const aiUnits = this.game.units.filter(
      (unit) => unit.owner === targetId && unit.isAlive()
    ).length;

    const proposerUnits = this.game.units.filter(
      (unit) => unit.owner === proposerId && unit.isAlive()
    ).length;

    const aiGold = targetId === this.game.aiId ? this.game.aiGold : 0;
    const proposerGold = proposerId === this.game.playerId ? this.game.playerGold : 0;

    return aiUnits <= proposerUnits || aiGold < proposerGold;
  }

  recordEvent(type, actorId, targetId, data = {}) {
    this.history.push({
      type,
      actorId,
      targetId,
      data,
      timestamp: Date.now(),
    });
  }

  getHistory() {
    return [...this.history];
  }

  getRelationsForFaction(factionId) {
    const result = {};
    const id = Number(factionId);

    for (const [key, relation] of Object.entries(this.relations)) {
      const [a, b] = key.split(":").map(Number);
      if (a === id) result[b] = relation;
      else if (b === id) result[a] = relation;
    }

    return result;
  }
}