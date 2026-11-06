import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { About } from '../more/About';
import { Experiment } from '../more/Experiment';
import { Installation } from '../more/Installation';
import { Lab } from '../more/Lab';
import { ModuleInfo } from '../more/ModuleInfo';
import { Restore } from '../more/Restore';
import { Scenes } from '../more/Scenes';
import { Settings } from '../more/Settings';

type Page = 'scenes' | 'experiment' | 'info' | 'install' | 'restore' | 'lab' | 'settings' | 'about';

const PAGES: { id: Page; title: string; subtitle: string; icon: IconName; danger?: boolean }[] = [
  { id: 'scenes', title: 'Escenas', subtitle: 'Guarda y aplica tus combinaciones', icon: 'layers' },
  { id: 'experiment', title: 'Experimento: eventos del coche', subtitle: 'Qué avisa el módulo al abrir, arrancar…', icon: 'car' },
  { id: 'info', title: 'Información del módulo', subtitle: 'Versiones y firmware', icon: 'chip' },
  { id: 'install', title: 'Instalación', subtitle: 'Modo fábrica: códigos, tiras y cableado', icon: 'wrench', danger: true },
  { id: 'restore', title: 'Restaurar ajustes de fábrica', subtitle: 'Vuelve a la configuración inicial', icon: 'reset' },
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

export function MoreTab() {
  const [page, setPage] = useState<Page | null>(null);
  const back = () => setPage(null);
  const current = PAGES.find((p) => p.id === page);

  if (current) {
    return (
      <SubPage title={current.title} onBack={back}>
        {page === 'scenes' && <Scenes />}
        {page === 'experiment' && <Experiment />}
        {page === 'info' && <ModuleInfo />}
        {page === 'install' && <Installation onExit={back} />}
        {page === 'restore' && <Restore />}
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
          <Icon name="chevronRight" size={18} className="menu-chevron" />
        </button>
      ))}
    </nav>
  );
}
