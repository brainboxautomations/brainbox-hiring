/** Fewer characters than this match too much to be worth a round trip. */
export const MIN_CANDIDATE_SEARCH_LENGTH = 2;

/**
 * Splits what someone typed into search words safe to put in a PostgREST
 * filter, or null when there is nothing worth searching for.
 *
 * The filter is built as text (`first_name.ilike.%word%,…`), so a comma or a
 * bracket in the input would change its structure, and `%`, `_` and `*` are
 * wildcards. All of those are dropped rather than escaped: nobody's name or
 * email needs them to be found.
 */
export function candidateSearchWords(input: string): string[] | null {
  const words = input
    .toLowerCase()
    .replace(/[,()%_*\\:"'`]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.join("").length < MIN_CANDIDATE_SEARCH_LENGTH) return null;
  return words;
}

/**
 * Whether a candidate matches every word typed, in any of name or email.
 * "nadia rahman" should find Nadia Rahman even though no single column holds both
 * words.
 */
export function matchesAllWords(
  words: string[],
  candidate: { firstName: string; lastName: string | null; email: string },
): boolean {
  const haystack =
    `${candidate.firstName} ${candidate.lastName ?? ""} ${candidate.email}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}
