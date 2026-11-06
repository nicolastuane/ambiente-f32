/** Minimal observable value, compatible with React's useSyncExternalStore. */
export interface Store<T> {
  get(): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    update(fn) {
      store.set(fn(value));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

/** Tiny typed event emitter. */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        console.error(error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
