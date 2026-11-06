/** In-memory copy of the persisted app data; every update is saved to localStorage. */
import { createStore } from '../util/store';
import { clearData, defaultData, loadData, saveData } from './storage';
import type { StoredData } from './storage';

export const appData = createStore<StoredData>(loadData());

export function updateAppData(fn: (data: StoredData) => StoredData): void {
  appData.update(fn);
  saveData(appData.get());
}

export function resetAppData(): void {
  clearData();
  appData.set(defaultData());
}
