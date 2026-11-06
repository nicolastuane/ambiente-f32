/**
 * Keeps the screen on during the experiment when the browser allows it: the
 * Screen Wake Lock API, and Bluefy's own `bluetooth.setScreenDimEnabled`
 * (undocumented; feature-detected and called defensively). iOS drops a wake
 * lock when the page is hidden, so keepAwake(true) is called again on return.
 */
let lock: WakeLockSentinel | null = null;
let wanted = false;

type BluefyBluetooth = { setScreenDimEnabled?: (enabled: boolean) => unknown };

function bluefy(enabled: boolean): void {
  try {
    const bt = (navigator as Navigator & { bluetooth?: BluefyBluetooth }).bluetooth;
    if (typeof bt?.setScreenDimEnabled === 'function') void bt.setScreenDimEnabled(enabled);
  } catch {
    // Not Bluefy, or a different signature.
  }
}

export function keepAwake(on: boolean): void {
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

/** Re-requests the lock after the page becomes visible again (iOS releases it when hidden). */
export function refreshWakeLock(): void {
  if (wanted) keepAwake(true);
}
