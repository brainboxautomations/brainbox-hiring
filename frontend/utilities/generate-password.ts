/**
 * Characters that survive being read out or copied off a screen: no 0/O,
 * 1/l/I, or symbols that are awkward to type or easy to mistake.
 */
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export const GENERATED_PASSWORD_LENGTH = 16;

/** An unbiased index into `size` items, from the platform's secure RNG. */
function randomIndex(size: number): number {
  // Rejection sampling: a plain modulo favours the low end of the alphabet.
  const limit = Math.floor(0x1_0000_0000 / size) * size;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer);
  while (buffer[0]! >= limit);
  return buffer[0]! % size;
}

function pick(from: string): string {
  return from[randomIndex(from.length)]!;
}

/**
 * A random password for a new team member, set by whoever adds them and passed
 * on by hand. Always has at least one lowercase letter, capital, digit and
 * symbol, so it passes any composition rule a password field might have.
 */
export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));

  // Shuffle, so the guaranteed characters are not always the first four.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
