// ИЗМЕНЕНО: одноразовая миграция населения (mobilization v2).
// Умножает population всех точек-городов в maps/world.json на POP_SCALE.
// Запуск: node tools/scale-population.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POP_SCALE = 12; // = BALANCE.POP_SCALE (константа дублируется, т.к.
                      // tools/ не должен импортировать игровые модули).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, '..', 'maps', 'world.json');

const raw = fs.readFileSync(file, 'utf8');
const world = JSON.parse(raw);

let scaled = 0;

for (const p of world.points || []) {
  if (typeof p.population === 'number') {
    p.population = Math.round(p.population * POP_SCALE);
    scaled++;
  }
}

if (scaled > 0) {
  fs.writeFileSync(file, JSON.stringify(world, null, 2));
  console.log(`✅ Миграция: население ×${POP_SCALE} у ${scaled} городов → ${file}`);
} else {
  console.log(`ℹ️ Полей population в ${file} нет — миграция не требуется.`);
  console.log('   Население задаётся дефолтом City.js (12000 = 1000 × 12).');
}
