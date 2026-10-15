export type ReconcilePlan<T> = {
  /** Rows that survive the edit, updated in place so their ids are preserved. */
  update: { id: string; item: T; sortOrder: number }[];
  /** Rows the edit introduces. */
  insert: { item: T; sortOrder: number }[];
  /** Rows the user actually removed. */
  deleteIds: string[];
};

/**
 * Works out how to turn a list's current rows into the submitted ones without
 * recreating the rows that survive.
 *
 * Other tables point at these rows (answers at questions, positions at
 * pipeline stages), so a row that is deleted and re-inserted takes whatever
 * points at it down with it. An edit must update the rows it keeps and delete
 * only the ones the user removed.
 *
 * A submitted item counts as surviving only when it carries an id the list
 * actually has: an unknown or absent id is treated as new, so a client cannot
 * adopt a row belonging to another list. The same id twice in one payload
 * becomes one update and one insert.
 */
export function planReconcileById<T extends { id?: string | null }>(
  existingIds: string[],
  submitted: T[],
): ReconcilePlan<T> {
  const existing = new Set(existingIds);
  const kept = new Set<string>();

  const update: ReconcilePlan<T>["update"] = [];
  const insert: ReconcilePlan<T>["insert"] = [];

  submitted.forEach((item, sortOrder) => {
    if (item.id && existing.has(item.id) && !kept.has(item.id)) {
      kept.add(item.id);
      update.push({ id: item.id, item, sortOrder });
    } else {
      insert.push({ item, sortOrder });
    }
  });

  return {
    update,
    insert,
    deleteIds: existingIds.filter((id) => !kept.has(id)),
  };
}
