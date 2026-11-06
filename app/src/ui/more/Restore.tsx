import { useController, useReady } from '../AppContext';
import { Card, Notice } from '../controls';
import { useConfirm } from '../feedback';
import { Icon } from '../Icon';

export function Restore() {
  const controller = useController();
  const ready = useReady();
  const confirm = useConfirm();

  const run = async () => {
    const ok = await confirm({
      title: 'Restaurar ajustes de fábrica',
      message:
        'El módulo volverá a su configuración inicial (colores, modos, brillos y avisos). Tus escenas guardadas en esta app no se borran.',
      confirmLabel: 'Restaurar',
      danger: true,
    });
    if (!ok) return;
    controller.run(async (d) => {
      await d.restoreFactory();
      // Read the state back after giving the module a moment to reset.
      await new Promise((resolve) => setTimeout(resolve, 800));
      await d.requestState();
    });
  };

  return (
    <Card title="Restaurar ajustes de fábrica" icon="reset">
      <p className="card-sub">
        Envía la orden de restaurar ([4200]). El módulo responde si lo ha hecho, y la app vuelve a leer su estado.
      </p>
      {!ready && <Notice>Conéctate al módulo primero.</Notice>}
      <button type="button" className="btn btn-danger btn-wide" disabled={!ready} onClick={() => void run()}>
        <Icon name="reset" size={18} />
        Restaurar ajustes de fábrica
      </button>
    </Card>
  );
}
