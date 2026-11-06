import { resetAppData } from '../../state/appStore';
import { useAppData, useController } from '../AppContext';
import { Card, Toggle } from '../controls';
import { useConfirm } from '../feedback';
import { Icon } from '../Icon';

export function Settings() {
  const controller = useController();
  const confirm = useConfirm();
  const [data, update] = useAppData();

  return (
    <>
      <Card title="Ajustes de la app" icon="sliders">
        <Toggle
          label="Modo demo"
          description="Simula un módulo ZYCL-FWD para probar la app sin el coche. Al cambiarlo se corta la conexión actual."
          checked={data.demo}
          onChange={(demo) => update((d) => ({ ...d, demo }))}
        />
        <Toggle
          label="Reconexión automática"
          description="Si se corta la conexión, la app lo reintenta hasta 5 veces. Nunca después de pulsar «Desconectar»."
          checked={data.autoReconnect}
          onChange={(autoReconnect) => update((d) => ({ ...d, autoReconnect }))}
        />
        <Toggle
          label="Mostrar opciones peligrosas"
          description="Muestra en Instalación la activación del menú de ambiente original del coche ([4100])."
          checked={data.showDangerous}
          onChange={(showDangerous) => update((d) => ({ ...d, showDangerous }))}
        />
      </Card>
      <Card title="Datos de la app" icon="trash">
        <p className="card-sub">
          Borra escenas, favoritos, el último módulo y estos ajustes de este navegador. No cambia nada en el módulo.
        </p>
        <button
          type="button"
          className="btn btn-danger btn-wide"
          onClick={() => {
            void confirm({
              title: 'Borrar los datos de la app',
              message: 'Se borrarán tus escenas, favoritos y ajustes guardados en este navegador.',
              confirmLabel: 'Borrar',
              danger: true,
            }).then((ok) => {
              if (!ok) return;
              resetAppData();
              controller.toast('Datos de la app borrados', 'success');
            });
          }}
        >
          <Icon name="trash" size={18} />
          Borrar datos de la app
        </button>
      </Card>
    </>
  );
}
