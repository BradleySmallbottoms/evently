function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const ids = new Set(left);
  return right.every((id) => ids.has(id));
}

/** True when the area editor would persist something other than the saved area. */
export function areaDraftIsDirty(
  draft: {
    name: string;
    tagIds: readonly string[];
    searchRadiusM: number;
    notify: boolean;
    active: boolean;
    /** Notification radius that Save would write. Null when that radius is not part of the save. */
    notifyRadiusM: number | null;
  },
  saved: {
    name: string;
    tagIds: readonly string[];
    searchRadiusM: number;
    notify: boolean;
    active: boolean;
    notifyRadiusM: number | null;
  },
): boolean {
  if (draft.name.trim() !== saved.name) return true;
  if (!sameIds(draft.tagIds, saved.tagIds)) return true;
  if (draft.searchRadiusM !== saved.searchRadiusM) return true;
  if (draft.notify !== saved.notify) return true;
  if (draft.active !== saved.active) return true;
  if (draft.notify && draft.notifyRadiusM !== saved.notifyRadiusM) return true;
  return false;
}
