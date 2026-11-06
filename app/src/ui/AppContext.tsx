/** React glue: provides the AppController and the persisted app data. */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { WebBluetoothAdapter } from '../ble/adapter';
import { MockAdapter } from '../ble/mockAdapter';
import type { SessionState } from '../ble/session';
import type { DeviceState } from '../protocol/zycela/state';
import { AppController } from '../state/controller';
import type { Toast } from '../state/controller';
import type { LogEntry } from '../state/lab';
import { appData, updateAppData } from '../state/appStore';
import type { StoredData } from '../state/storage';

function createController(demo: boolean): AppController {
  const adapter = demo ? new MockAdapter() : new WebBluetoothAdapter();
  return new AppController(adapter, {
    autoReconnect: appData.get().autoReconnect,
    lastDevice: () => appData.get().lastDevice,
    onConnected: (device) => {
      if (demo) return; // only remember real modules
      updateAppData((data) => ({ ...data, lastDevice: { id: device.id, name: device.name } }));
    },
  });
}

const ControllerContext = createContext<AppController | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const data = useSyncExternalStore(appData.subscribe, appData.get);
  const [controller, setController] = useState(() => createController(data.demo));

  // Switching demo mode replaces the adapter (and drops the current connection).
  useEffect(() => {
    if (controller.demo !== data.demo) {
      controller.dispose();
      setController(createController(data.demo));
    }
  }, [controller, data.demo]);

  useEffect(() => controller.setAutoReconnect(data.autoReconnect), [controller, data.autoReconnect]);

  // iOS suspends the page in the background: re-check the link when it comes back.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') controller.onVisible();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [controller]);

  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

export function useController(): AppController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('useController must be used inside <AppProvider>');
  return controller;
}

export function useConnection(): SessionState {
  const c = useController();
  return useSyncExternalStore(c.session.state.subscribe, c.session.state.get);
}

export function useReady(): boolean {
  return useConnection().status === 'ready';
}

export function useDevice(): DeviceState {
  const c = useController();
  return useSyncExternalStore(c.device.subscribe, c.device.get);
}

export function useLog(): LogEntry[] {
  const c = useController();
  return useSyncExternalStore(c.log.subscribe, c.log.get);
}

export function useToasts(): Toast[] {
  const c = useController();
  return useSyncExternalStore(c.toasts.subscribe, c.toasts.get);
}

export function useAppData(): [StoredData, (fn: (data: StoredData) => StoredData) => void] {
  const data = useSyncExternalStore(appData.subscribe, appData.get);
  return [data, updateAppData];
}
