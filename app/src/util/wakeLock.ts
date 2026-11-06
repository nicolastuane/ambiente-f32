/**
 * Keeps the screen on while a guided session needs it, when the browser
 * allows it: the Screen Wake Lock API, and Bluefy's own
 * `bluetooth.setScreenDimEnabled` (undocumented; feature-detected and called
 * defensively). Several features can ask at once (the experiment, the car
 * tests): the screen stays on while any owner wants it. iOS drops a wake lock
 * when the page is hidden, so refreshWakeLock() asks again on return.
 */
let lock: WakeLockSentinel | null = null;
let wanted = false;
const owners = new Set<string>();

type BluefyBluetooth = { setScreenDimEnabled?: (enabled: boolean) => unknown };

function bluefy(enabled: boolean): void {
  try {
    const bt = (navigator as Navigator & { bluetooth?: BluefyBluetooth }).bluetooth;
    if (typeof bt?.setScreenDimEnabled === 'function') void bt.setScreenDimEnabled(enabled);
  } catch {
    // Not Bluefy, or a different signature.
  }
}

function apply(on: boolean): void {
  if (on !== wanted) bluefy(!on);
  wanted = on;
  if (!on) {
    void lock?.release().catch(() => undefined);
    lock = null;
    return;
  }
  if (lock && !lock.released) return;
  try {
    navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        if (wanted) lock = sentinel;
        else void sentinel.release().catch(() => undefined);
      })
      .catch(() => undefined);
  } catch {
    // Not supported.
  }
}

/** `owner` wants the screen on (or not any more); it stays on while any owner wants it. */
export function keepAwake(owner: string, on: boolean): void {
  const had = owners.has(owner);
  if (on === had && on === wanted) return;
  if (on) owners.add(owner);
  else owners.delete(owner);
  apply(owners.size > 0);
}

/** true while some owner wants the screen on. */
export function wakeLockWanted(): boolean {
  return owners.size > 0;
}

/** Re-requests the lock after the page becomes visible again (iOS releases it when hidden). */
export function refreshWakeLock(): void {
  if (owners.size > 0) apply(true);
}
