import { useEffect, useState } from 'react';
import { AppProvider, useConnection, useController, useDevice } from './ui/AppContext';
import { ConnectionPill, NoBluetoothBanner } from './ui/connection';
import { ConfirmProvider, Toasts } from './ui/feedback';
import { Icon } from './ui/Icon';
import type { IconName } from './ui/Icon';
import { BrightnessTab } from './ui/tabs/BrightnessTab';
import { CarTab } from './ui/tabs/CarTab';
import { ColorTab } from './ui/tabs/ColorTab';
import { EffectsTab } from './ui/tabs/EffectsTab';
import { MoreTab } from './ui/tabs/MoreTab';

type Tab = 'color' | 'effects' | 'brightness' | 'car' | 'more';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'color', label: 'Color', icon: 'color' },
  { id: 'effects', label: 'Efectos', icon: 'effects' },
  { id: 'brightness', label: 'Brillo', icon: 'brightness' },
  { id: 'car', label: 'Coche', icon: 'car' },
  { id: 'more', label: 'Más', icon: 'more' },
];

const TAB_KEY = 'ambiente-f32:tab';

function readTab(): Tab {
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved && TABS.some((t) => t.id === saved)) return saved as Tab;
  } catch {
    // Storage unavailable: start on Color.
  }
  return 'color';
}

function Shell() {
  const controller = useController();
  const device = useDevice();
  const conn = useConnection();
  const [tab, setTab] = useState<Tab>(readTab);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      // Ignore.
    }
    window.scrollTo(0, 0);
  }, [tab]);

  // The header glow follows the module's current colour.
  useEffect(() => {
    document.documentElement.style.setProperty('--ambient', device.color ?? '#ff6a00');
  }, [device.color]);

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Ambiente F32</span>
          {controller.demo && conn.status !== 'ready' && <span className="badge">DEMO</span>}
        </div>
        <ConnectionPill />
      </header>
      <Toasts />
      <main id="main" className="main" aria-label={active.label}>
        <h1 className="sr-only">{active.label}</h1>
        <NoBluetoothBanner />
        {tab === 'color' && <ColorTab />}
        {tab === 'effects' && <EffectsTab />}
        {tab === 'brightness' && <BrightnessTab />}
        {tab === 'car' && <CarTab />}
        {tab === 'more' && <MoreTab />}
      </main>
      <nav className="tabbar" aria-label="Secciones">
        <div className="tabbar-inner">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tab"
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={24} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </AppProvider>
  );
}
