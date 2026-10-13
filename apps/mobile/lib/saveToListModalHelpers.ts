import { Alert } from 'react-native';
import { formatNtdpCategoryTagLabel } from './ntdpDisplayLabels';

export const SAVE_TO_LIST_CREATE_BUSY_ID = '__create__';

export function suggestedSaveListName(ntdpCategory?: string | null): string {
  const raw = ntdpCategory?.trim();
  if (raw) return formatNtdpCategoryTagLabel(raw);
  return 'My list';
}

export function pluralCountLabel(count: number, label: string): string {
  if (count === 1) {
    return label.endsWith('s') ? label.slice(0, -1) : label;
  }
  return label;
}

type SaveResult =
  | { ok: true }
  | { ok: false; duplicate: boolean; message?: string };

export function alertAfterSaveToList(
  res: SaveResult,
  itemName: string,
  listName: string,
  onSuccess: () => void,
  /** Optional in-app dialog/toast; falls back to the system Alert. */
  notify?: (title: string, message: string, tone?: 'success' | 'error' | 'info') => void
): void {
  if (res.ok) {
    onSuccess();
    if (notify) notify('Saved', `Added to “${listName}”.`, 'success');
    else Alert.alert('Saved', `Added to “${listName}”.`);
    return;
  }
  if (res.duplicate) {
    onSuccess();
    if (notify) notify('Already in list', `“${itemName}” is already in “${listName}”.`, 'info');
    else Alert.alert('Already in list', `“${itemName}” is already in “${listName}”.`);
    return;
  }
  const message = res.message ?? 'Could not save to this list.';
  if (notify) notify('Error', message, 'error');
  else Alert.alert('Error', message);
}
