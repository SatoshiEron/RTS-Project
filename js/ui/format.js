// ИЗМЕНЕНО: компактный формат чисел для UI (mobilization v2).
// <10 000 → целое; <1 млн → «X,XК»; ≥1 млн → «X,XМ».
export function fmtCompact(n) {
  const num = Math.floor(Number(n) || 0);
  const abs = Math.abs(num);

  if (abs < 10000) return String(num);
  if (abs < 1000000) return (num / 1000).toFixed(1).replace('.', ',') + 'К';
  return (num / 1000000).toFixed(1).replace('.', ',') + 'М';
}
