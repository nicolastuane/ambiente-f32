/** Lets a banner open a page of «Más» from anywhere (App switches the tab, MoreTab opens the page). */
import { createStore } from '../util/store';

export type MorePage = 'cartests' | 'scenes' | 'backup' | 'experiment' | 'info' | 'install' | 'lab' | 'settings' | 'about';

/** The page asked for, until MoreTab opens it. */
export const moreRequest = createStore<{ page: MorePage; seq: number } | null>(null);
let seq = 0;

export function openMorePage(page: MorePage): void {
  moreRequest.set({ page, seq: ++seq });
}
