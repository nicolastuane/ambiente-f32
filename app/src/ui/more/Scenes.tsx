import { useRef, useState } from 'react';
import { effectName, rgbModeName } from '../../protocol/zycela/catalog';
import { BUILT_IN_SCENES, sceneFromState } from '../../protocol/zycela/scenes';
import type { Scene, SceneData } from '../../protocol/zycela/scenes';
import { exportScenes, importScenes, newId } from '../../state/storage';
import { copyText, downloadText, readFileText, timestampForFile } from '../../util/files';
import { useAppData, useController, useDevice, useReady } from '../AppContext';
import { Card, Notice, Spinner } from '../controls';
import { useConfirm } from '../feedback';
import { Icon } from '../Icon';

function summary(data: SceneData): string {
  const parts: string[] = [];
  if (data.power === 0) parts.push('Apagado');
  if (data.rgbMode !== undefined) parts.push(`RGB: ${rgbModeName(data.rgbMode) ?? data.rgbMode}`);
  if (data.effect) parts.push(`Efecto: ${effectName(data.effect.id) ?? data.effect.id}`);
  const b = data.brightness;
  if (b) parts.push(`Brillo ${b.b1 ?? '–'}/${b.b2 ?? '–'}/${b.b3 ?? '–'}`);
  return parts.join(' · ') || 'Sin ajustes';
}

function sceneColors(data: SceneData): string[] {
  const c = data.colors ?? {};
  return [c.all, c.zone1, c.zone2].filter((x): x is string => !!x);
}

export function Scenes() {
  const controller = useController();
  const device = useDevice();
  const ready = useReady();
  const confirm = useConfirm();
  const [data, update] = useAppData();
  const [editing, setEditing] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const scenes = data.scenes;

  const setScenes = (fn: (list: Scene[]) => Scene[]) => update((d) => ({ ...d, scenes: fn(d.scenes) }));

  const apply = (scene: Scene) => {
    setApplying(scene.id);
    controller.driver
      .applyScene(scene.data)
      .then(() => controller.toast(`Escena «${scene.name}» aplicada`, 'success'))
      .catch((error: unknown) => controller.reportError(error))
      .finally(() => setApplying(null));
  };

  const saveCurrent = () => {
    const name = newName.trim();
    if (!name) return;
    const snapshot = sceneFromState(device);
    if (!Object.keys(snapshot).length) {
      controller.toast('Aún no hay estado del módulo que guardar. Conéctate primero.', 'warning');
      return;
    }
    setScenes((list) => [...list, { id: newId(), name: name.slice(0, 60), data: snapshot }]);
    setNewName('');
    controller.toast(`Escena «${name}» guardada`, 'success');
  };

  const move = (index: number, delta: number) =>
    setScenes((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const remove = async (scene: Scene) => {
    const ok = await confirm({
      title: 'Borrar escena',
      message: `¿Borrar «${scene.name}»?`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (ok) setScenes((list) => list.filter((s) => s.id !== scene.id));
  };

  const addImported = (text: string) => {
    const imported = importScenes(text);
    if (!imported.length) {
      controller.toast('El archivo no contiene escenas válidas.', 'error');
      return false;
    }
    setScenes((list) => [...list, ...imported]);
    controller.toast(`${imported.length} escena(s) importada(s)`, 'success');
    return true;
  };

  const exportAll = () => {
    const text = exportScenes(scenes);
    // A download can fail silently (e.g. in iOS WebViews such as Bluefy): say where to look and offer the copy.
    const ok = downloadText(`escenas-ambiente-f32-${timestampForFile()}.json`, text);
    controller.toast(
      ok ? 'Descarga iniciada. Si no aparece el archivo, usa «Copiar JSON».' : 'No se pudo descargar: usa «Copiar JSON».',
      ok ? 'info' : 'warning',
    );
  };

  const copyAll = () => {
    void copyText(exportScenes(scenes)).then((copied) =>
      controller.toast(copied ? 'JSON copiado al portapapeles' : 'No se pudo copiar el JSON', copied ? 'success' : 'error'),
    );
  };

  const restoreBuiltIns = () => {
    const missing = BUILT_IN_SCENES.filter((b) => !scenes.some((s) => s.id === b.id));
    if (!missing.length) {
      controller.toast('Las escenas de ejemplo ya están en la lista');
      return;
    }
    setScenes((list) => [...list, ...missing.map((s) => ({ ...s, data: JSON.parse(JSON.stringify(s.data)) as SceneData }))]);
  };

  return (
    <>
      {!ready && <Notice>Conéctate al módulo para aplicar escenas. Puedes ordenarlas y exportarlas sin conexión.</Notice>}

      <Card
        title="Mis escenas"
        icon="layers"
        actions={
          scenes.length > 0 && (
            <button type="button" className="btn btn-ghost btn-small" aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? 'Hecho' : 'Editar'}
            </button>
          )
        }
      >
        {scenes.length === 0 && <p className="hint">No hay escenas. Guarda el estado actual o importa un archivo.</p>}
        <ul className="scene-list">
          {scenes.map((scene, index) => (
            <li key={scene.id} className="scene">
              <span className="scene-colors" aria-hidden="true">
                {sceneColors(scene.data).map((hex, i) => (
                  <span key={i} style={{ background: hex }} />
                ))}
                {sceneColors(scene.data).length === 0 && <span className="scene-rainbow" />}
              </span>
              {editing ? (
                <input
                  className="text-input scene-name-input"
                  aria-label={`Nombre de la escena ${index + 1}`}
                  defaultValue={scene.name}
                  maxLength={60}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== scene.name)
                      setScenes((list) => list.map((s) => (s.id === scene.id ? { ...s, name } : s)));
                    else event.target.value = scene.name;
                  }}
                />
              ) : (
                <span className="scene-text">
                  <span className="scene-name">{scene.name}</span>
                  <span className="scene-sum">{summary(scene.data)}</span>
                </span>
              )}
              {editing ? (
                <span className="scene-tools">
                  <button type="button" className="btn btn-icon" aria-label={`Subir ${scene.name}`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <Icon name="up" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={`Bajar ${scene.name}`}
                    disabled={index === scenes.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <Icon name="down" />
                  </button>
                  <button type="button" className="btn btn-icon btn-danger" aria-label={`Borrar ${scene.name}`} onClick={() => void remove(scene)}>
                    <Icon name="trash" />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={!ready || applying !== null}
                  aria-label={`Aplicar ${scene.name}`}
                  onClick={() => apply(scene)}
                >
                  {applying === scene.id ? <Spinner /> : 'Aplicar'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Guardar el estado actual" icon="star" subtitle="Guarda encendido, color por zona, modo RGB y velocidad, efecto y sus ajustes y los tres brillos.">
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveCurrent();
          }}
        >
          <input
            className="text-input"
            placeholder="Nombre de la escena"
            aria-label="Nombre de la nueva escena"
            maxLength={60}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>
            Guardar
          </button>
        </form>
      </Card>

      <Card title="Copia de seguridad" icon="download">
        <div className="row-actions">
          <button type="button" className="btn" disabled={!scenes.length} onClick={exportAll}>
            <Icon name="download" size={18} />
            Exportar JSON
          </button>
          <button type="button" className="btn" disabled={!scenes.length} onClick={copyAll}>
            <Icon name="copy" size={18} />
            Copiar JSON
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} />
            Importar archivo
          </button>
          <button type="button" className="btn btn-ghost" aria-expanded={pasteOpen} onClick={() => setPasteOpen(!pasteOpen)}>
            Pegar JSON
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void readFileText(file).then(addImported).catch(() => controller.toast('No se pudo leer el archivo', 'error'));
          }}
        />
        {pasteOpen && (
          <div className="paste-box">
            <textarea
              className="text-input"
              rows={5}
              aria-label="JSON de escenas"
              placeholder='{"app":"ambiente-f32-scenes", "scenes":[…]}'
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!pasteText.trim()}
              onClick={() => {
                if (addImported(pasteText)) {
                  setPasteText('');
                  setPasteOpen(false);
                }
              }}
            >
              Importar
            </button>
          </div>
        )}
        <button type="button" className="btn btn-ghost btn-wide" onClick={restoreBuiltIns}>
          Volver a añadir las escenas de ejemplo
        </button>
      </Card>
    </>
  );
}
