import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useController } from '../AppContext';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { About } from '../more/About';
import { Backup } from '../more/Backup';
import { CarTests, carTestsFor } from '../more/CarTests';
import { Experiment } from '../more/Experiment';
import { Installation } from '../more/Installation';
import { Lab } from '../more/Lab';
import { ModuleInfo } from '../more/ModuleInfo';
import { Scenes } from '../more/Scenes';
import { Settings } from '../more/Settings';
import { moreRequest } from '../nav';
import type { MorePage } from '../nav';

// There is no «Restaurar ajustes de fábrica» page: [42…] wipes the installation
// and is never sent. «Copia de seguridad» puts the user's settings back instead.
const PAGES: { id: MorePage; title: string; subtitle: string; icon: IconName; danger?: boolean }[] = [
  { id: 'cartests', title: 'Pruebas del coche', subtitle: 'Qué lee el módulo y por qué no sale la bienvenida', icon: 'steering' },
  { id: 'scenes', title: 'Escenas', subtitle: 'Guarda y aplica tus combinaciones', icon: 'layers' },
  { id: 'backup', title: 'Copia de seguridad', subtitle: 'Guarda y restaura los ajustes del módulo', icon: 'download' },
  { id: 'experiment', title: 'Experimento: eventos del coche', subtitle: 'Qué avisa el módulo al abrir, arrancar…', icon: 'car' },
  { id: 'info', title: 'Información del módulo', subtitle: 'Versiones y firmware', icon: 'chip' },
  { id: 'install', title: 'Instalación', subtitle: 'Modo fábrica: códigos, tiras y cableado', icon: 'wrench', danger: true },
  { id: 'lab', title: 'Laboratorio', subtitle: 'Consola de comandos y registro', icon: 'flask' },
  { id: 'settings', title: 'Ajustes de la app', subtitle: 'Modo demo, reconexión, datos', icon: 'sliders' },
  { id: 'about', title: 'Acerca de', subtitle: 'Qué es esta app', icon: 'info' },
];

function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className="subpage">
      <div className="subpage-head">
        <button type="button" className="btn btn-icon btn-ghost" aria-label="Volver a Más" onClick={onBack}>
          <Icon name="chevronLeft" />
        </button>
        <h2 ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

/** «En curso», «Por restaurar»…: the car tests leave settings changed while they last. */
function useCarTestsBadge(): string | null {
  const controller = useController();
  const runner = carTestsFor(controller);
  const state = useSyncExternalStore(runner.state.subscribe, runner.state.get);
  if (state.pendingRestore) return 'Por restaurar';
  if (state.waiting) return 'Esperando respuesta';
  if (state.phase === 'active' || state.phase === 'starting' || state.phase === 'finishing') return 'En curso';
  return null;
}

/** Takes a page asked for by a banner (openMorePage). */
function takeRequest(): MorePage | null {
  const request = moreRequest.get();
  if (!request) return null;
  moreRequest.set(null);
  return request.page;
}

export function MoreTab() {
  const [page, setPage] = useState<MorePage | null>(takeRequest);
  const badge = useCarTestsBadge();
  const back = () => setPage(null);
  const current = PAGES.find((p) => p.id === page);

  useEffect(
    () =>
      moreRequest.subscribe(() => {
        const requested = takeRequest();
        if (requested) setPage(requested);
      }),
    [],
  );

  if (current) {
    return (
      <SubPage key={current.id} title={current.title} onBack={back}>
        {page === 'cartests' && <CarTests />}
        {page === 'scenes' && <Scenes />}
        {page === 'backup' && <Backup />}
        {page === 'experiment' && <Experiment />}
        {page === 'info' && <ModuleInfo />}
        {page === 'install' && <Installation onExit={back} />}
        {page === 'lab' && <Lab />}
        {page === 'settings' && <Settings />}
        {page === 'about' && <About />}
      </SubPage>
    );
  }

  return (
    <nav className="menu" aria-label="Más opciones">
      {PAGES.map((p) => (
        <button key={p.id} type="button" className="menu-row" onClick={() => setPage(p.id)}>
          <span className={p.danger ? 'menu-icon menu-icon-warn' : 'menu-icon'}>
            <Icon name={p.icon} />
          </span>
          <span className="menu-text">
            <span className="menu-title">{p.title}</span>
            <span className="menu-sub">{p.subtitle}</span>
          </span>
          {p.id === 'cartests' && badge && <span className="badge menu-badge">{badge}</span>}
          <Icon name="chevronRight" size={18} className="menu-chevron" />
        </button>
      ))}
    </nav>
  );
}
