/**
 * Guided car tests («Pruebas del coche»), docs/investigacion-eventos.md §5.
 *
 * A session starts with a mandatory backup (installation included), turns on
 * the module's debug mode and FFE2 listening, and walks through data-driven
 * tests. Each stage prepares the module (declared as data, see PrepareAction),
 * tells the user what to do in the car and records the answer, a fresh
 * [0A01] diff against the session snapshot (decoded fields and the raw
 * positions nobody decodes), link drops, and any notification the app did
 * not ask for (FFE1 and FFE2). After each test the runner restores what the
 * test touched plus anything that differs from the snapshot; a restore that
 * cannot run (link down) is persisted as pending and applied, then verified,
 * as soon as the link is ready again.
 *
 * Nothing changes the module on its own while nobody is looking: after a
 * reload the session only resumes (debug, FFE2, preparations) once the tests
 * page is opened, and the interruptor-8 preparation always needs a tap. Only
 * restoring (back to the copy) happens by itself on reconnection.
 */
import { bleErrorMessage } from '../ble/session';
import type { Ffe2Status } from '../ble/session';
import { WELCOME_MODES } from '../protocol/zycela/catalog';
import * as cmd from '../protocol/zycela/commands';
import type { BinaryValue, CarEventKey } from '../protocol/zycela/commands';
import { describeCommand } from '../protocol/zycela/describe';
import {
  BUILTIN_SNAPSHOT,
  SETTINGS_FIELDS,
  changedFields,
  cloneValues,
  countKnown,
  diffValues,
  fieldLabel,
  formatField,
  isFactoryField,
  readField,
  restoreCommands,
  withFeatureSwitch,
} from '../protocol/zycela/snapshot';
import type { FieldCheck, Snapshot, SnapshotField, SnapshotValues } from '../protocol/zycela/snapshot';
import { UNSUPPORTED } from '../protocol/zycela/state';
import { createStore } from '../util/store';
import type { Store } from '../util/store';
import {
  BackupError,
  DialGuardError,
  UnsafeCommandError,
  acquireLock,
  changeDialGuarded,
  lockHolder,
  missingEssentials,
  readModuleValues,
  sendPaced,
  takeSnapshot,
  unknownPositionChanges,
  waitLockFree,
} from './backup';
import type { BackupStore, DialResult, RawChange } from './backup';
import type { AppController } from './controller';
import { classifyEntries } from './experiment';
import type { LogEntry } from './lab';

// ---------------------------------------------------------------------------
// Test definitions (data)

/** What a stage changes on the module before the user acts. Plain data, so it can be tested and persisted. */
export type PrepareAction =
  | { kind: 'event'; key: CarEventKey; on: boolean }
  | { kind: 'turnColor'; index: number }
  | { kind: 'doorColor'; index: number }
  /** [07]: 1 on, 2 follow the car's lights. The module never reports it. */
  | { kind: 'power'; mode: cmd.PowerMode }
  /** [14]: 0 upper/lower, 1 front/rear. The brightness values are sent again after it. */
  | { kind: 'zoning'; value: BinaryValue }
  /** [06]/[10]/[09]: whole car or one zone. */
  | { kind: 'color'; zone: cmd.ColorZone; hex: string }
  | { kind: 'rgbMode'; mode: number }
  | { kind: 'effect'; id: number }
  | { kind: 'nightHalf'; on: boolean }
  | { kind: 'controlMethod'; value: BinaryValue }
  | { kind: 'welcome'; enabled?: boolean; mode?: number; color?: number }
  /** Feature switch nº 8 of the dial codes: guarded factory sequence with read-back. */
  | { kind: 'dialFeature8'; on: boolean };

/** Values the module never reports: restored to their default, with a note. */
export type UnreadableField = 'turnColor' | 'doorColor' | 'power';

/** An answer can offer to keep a change instead of restoring it (never the default). */
export type Offer =
  | 'keepNightHalfOff'
  | 'keepFeature8'
  | 'keepWelcome'
  | 'keepWelcomeWhite'
  | 'keepFollowLights'
  | 'keepFrontRearZones'
  | 'keepSpeedOn'
  | 'keepRadarOn'
  | 'keepDoorWarning'
  | 'keepTurnWarning';

export interface Answer {
  id: string;
  label: string;
  /** Stage to go to, or 'end'. Default: the next stage in order, or the end. */
  next?: string;
  conclusion?: string;
  offers?: readonly Offer[];
  /** Offers of an earlier answer of this test that this answer takes back (e.g. the door warning broke). */
  withdraws?: readonly Offer[];
}

export interface Stage {
  id: string;
  prepare?: readonly PrepareAction[];
  /** Imperative, short. */
  instruction: string;
  /** What to look at (lower case: shown after «Mira:»). */
  observe: string;
  /** Countdown the user starts before acting: the answers wait for it. */
  countdownSec?: number;
  question: string;
  answers: readonly Answer[];
  /** Can be left waiting when the session ends (answered another day). */
  deferred?: boolean;
}

/** A conclusion that needs answers from several tests. */
export interface CombinedConclusion {
  when: readonly { test: string; stage: string; answers: readonly string[] }[];
  text: string;
}

export interface CarTest {
  id: string;
  title: string;
  why: string;
  /** Extra note shown before starting. */
  note?: string;
  advanced?: boolean;
  /** Changes the installation: needs the dial codes in the snapshot. */
  needsFactory?: boolean;
  /** Checkbox the user must tick before starting. */
  acknowledge?: string;
  /** Only offered in the normal order after this answer (otherwise on demand, from the results). */
  offeredWhen?: { test: string; stage: string; answers: readonly string[]; reason: string };
  /** Never offered in the normal order (an earlier round): the reason, shown in the results, where it can be run on demand. */
  archived?: string;
  /** Deferred tests: what stays changed while the test waits for its answer, in plain words. */
  waitingNote?: string;
  stages: readonly Stage[];
  conclusions?: readonly CombinedConclusion[];
}

const WELCOME_PRESET: readonly PrepareAction[] = [
  { kind: 'welcome', enabled: true, mode: 0, color: 9 },
  { kind: 'event', key: 'door', on: false },
];

const KEEP_WELCOME: readonly Offer[] = ['keepWelcome', 'keepWelcomeWhite'];

const GARAGE = 'Si estás en un garaje, abre su puerta antes de arrancar y apaga el motor en cuanto contestes.';

/** Feature switch 8 on, plus every warning the car does not seem to read (and the radar, which it does). */
const FEATURE8_PRESET: readonly PrepareAction[] = [
  { kind: 'dialFeature8', on: true },
  { kind: 'event', key: 'door', on: true },
  // Blue: the default door colour (red) would not show on the user's red strips.
  { kind: 'doorColor', index: 3 },
  { kind: 'event', key: 'turn', on: true },
  { kind: 'turnColor', index: 1 },
  { kind: 'event', key: 'ac', on: true },
  { kind: 'event', key: 'radar', on: true },
];

const KEEP_FEATURE8: readonly Offer[] = ['keepFeature8'];
const KEEP_FEATURE8_AND_WELCOME: readonly Offer[] = ['keepFeature8', ...KEEP_WELCOME];

/** The first round (7–9/11/2026): interruptor 8, radio, strips, turn, door, dimming, iDrive, welcome. */
export const CAR_TESTS_ROUND1: readonly CarTest[] = [
  {
    // First: the module reads the radar and the lights (seen 2026-11-07) but not doors, turn
    // signals or A/C, and the vendor manuals for F30–F36 and G38 show this switch on.
    id: 'feature8',
    title: 'Interruptor de funciones nº 8',
    why: 'Tu módulo lee el radar y las luces del coche, pero no las puertas, los intermitentes ni el aire, y la bienvenida no sale. En los manuales del fabricante para tu BMW el interruptor de funciones nº 8 sale encendido; en tu módulo está apagado. Puede ser lo que le falta.',
    note: 'Unos 10 minutos. Empieza dentro del coche, con la puerta cerrada. La app pone el módulo un momento en modo de instalación, comprueba los códigos, enciende solo el interruptor 8, lo vuelve a leer y sale. Después activa los avisos de puerta, intermitentes, aire y radar. Al terminar lo deja todo como estaba, salvo que elijas dejar el interruptor 8 encendido. Al final hay que bloquear el coche: si el móvil se desconecta, al volver pulsa «Conectar» arriba.',
    advanced: true,
    needsFactory: true,
    acknowledge: 'Entiendo que cambia la configuración de instalación; la app lo deja como estaba al terminar',
    stages: [
      {
        id: 'a',
        prepare: FEATURE8_PRESET,
        instruction: 'Si no está puesto, pon el contacto (START sin pisar el freno). Abre la puerta del conductor, espera 5 segundos y ciérrala.',
        observe: 'si las tiras se ponen azules o parpadean al abrir (el aviso de puerta está en azul para que se distinga).',
        question: '¿Se pusieron azules o parpadearon las tiras al abrir?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Con el interruptor 8 el módulo lee las puertas.', offers: KEEP_FEATURE8 },
          { id: 'no', label: 'No', conclusion: 'Con el interruptor 8 el aviso de puerta sigue sin verse.' },
          { id: 'unsure', label: 'No estoy seguro' },
        ],
      },
      {
        id: 'b',
        instruction: 'Pon el intermitente izquierdo unos segundos y quítalo. Luego enciende las luces de emergencia unos segundos y apágalas.',
        observe: 'si alguna tira parpadea en amarillo.',
        question: '¿Parpadeó alguna tira en amarillo?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Con el interruptor 8 el módulo lee los intermitentes.', offers: KEEP_FEATURE8 },
          { id: 'no', label: 'No', conclusion: 'Con el interruptor 8 los intermitentes siguen sin verse en las tiras.' },
          { id: 'unsure', label: 'No estoy seguro' },
        ],
      },
      {
        id: 'c',
        instruction: 'Sube 2 o 3 grados la temperatura del climatizador y vuelve a bajarla. Luego pulsa dos veces el botón A/C.',
        observe: 'si las tiras cambian de color un momento.',
        question: '¿Cambiaron de color las tiras?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Con el interruptor 8 el módulo lee el climatizador.', offers: KEEP_FEATURE8 },
          { id: 'no', label: 'No', conclusion: 'Con el interruptor 8 el aviso del aire sigue sin verse.' },
          { id: 'unsure', label: 'No estoy seguro' },
        ],
      },
      {
        id: 'd',
        // Never a person behind the car: only the brakes hold it.
        instruction: `${GARAGE} Arranca (freno + START) y pon el freno de mano. Con el pie en el freno, mete la marcha atrás sin mover el coche. Detrás, a menos de un metro, tiene que haber una pared o un objeto (nunca una persona). Luego vuelve a P.`,
        observe: 'las tiras de luz, no la pantalla del coche (la pantalla también se pone verde y roja).',
        question: '¿Parpadean las tiras con la marcha atrás, como cuando probaste el radar?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Con el interruptor 8 el radar sigue funcionando.' },
          {
            id: 'no',
            label: 'No',
            conclusion: 'Con el interruptor 8 el radar dejó de verse en las tiras: tenlo en cuenta antes de dejarlo encendido.',
          },
          { id: 'unsure', label: 'No estoy seguro' },
        ],
      },
      {
        id: 'e',
        prepare: WELCOME_PRESET,
        countdownSec: 15,
        instruction:
          'Apaga el coche, baja, cierra la puerta y bloquea con el botón de la llave. Justo después pulsa «Empezar cuenta atrás». Cuando ponga «¡Ya!», desbloquea con el botón de la llave (sin tocar la manilla) y mira las tiras 10 segundos. Luego abre la puerta del conductor y mira otros 10 segundos.',
        observe: 'luz blanca recorriendo alguna tira.',
        question: '¿Viste luz blanca recorriendo alguna tira?',
        answers: [
          {
            id: 'unlock',
            label: 'Sí, al desbloquear',
            next: 'end',
            conclusion: 'Con el interruptor 8 aparece la bienvenida («envolvente consola»), al desbloquear.',
            offers: KEEP_FEATURE8_AND_WELCOME,
          },
          {
            id: 'door',
            label: 'Sí, al abrir la puerta',
            next: 'end',
            conclusion: 'Con el interruptor 8 aparece la bienvenida («envolvente consola»), al abrir la puerta.',
            offers: KEEP_FEATURE8_AND_WELCOME,
          },
          { id: 'no', label: 'No', next: 'f' },
        ],
      },
      {
        id: 'f',
        prepare: [{ kind: 'welcome', mode: 1 }],
        countdownSec: 15,
        instruction:
          'Cierra la puerta y bloquea con el botón de la llave. Justo después pulsa «Empezar cuenta atrás». Cuando ponga «¡Ya!», desbloquea con el botón de la llave y abre la puerta del conductor.',
        observe: 'luz blanca recorriendo alguna tira.',
        question: '¿Y ahora viste luz blanca recorriendo alguna tira?',
        answers: [
          {
            id: 'yes',
            label: 'Sí',
            conclusion: 'Con el interruptor 8 aparece la bienvenida en el modo «envolvente puertas».',
            offers: KEEP_FEATURE8_AND_WELCOME,
          },
          { id: 'no', label: 'No', conclusion: 'Con el interruptor 8 la bienvenida sigue sin aparecer con el módulo despierto.' },
        ],
      },
    ],
    conclusions: [
      {
        when: [
          { test: 'feature8', stage: 'a', answers: ['no'] },
          { test: 'feature8', stage: 'b', answers: ['no'] },
          { test: 'feature8', stage: 'c', answers: ['no'] },
          { test: 'feature8', stage: 'd', answers: ['yes'] },
          { test: 'feature8', stage: 'f', answers: ['no'] },
        ],
        text: 'Con el interruptor 8 encendido no cambió nada: no hace falta dejarlo así.',
      },
    ],
  },
  {
    id: 'radio',
    title: 'Botones de favoritos de la radio',
    why: 'El fabricante dice que los botones de favoritos de la radio controlan las luces: 4 = modo, 5/6 = color, 7/8 = brillo.',
    stages: [
      {
        id: 'a',
        instruction:
          'Pon el contacto (START sin pisar el freno). Toca sin apretar los botones de favoritos 5 y 6. Luego púlsalos. Después mantén pulsado el 1 y pulsa el 5. Prueba también el 7/8 y el 4.',
        observe: 'el color, el brillo o el modo de las tiras.',
        question: '¿Cambiaron las luces?',
        answers: [
          {
            id: 'color',
            label: 'Sí, el color',
            conclusion: 'Los botones de favoritos cambian el color del kit: puedes cambiar de color con un toque, sin el móvil.',
          },
          {
            id: 'brightness',
            label: 'Sí, el brillo o el modo',
            conclusion: 'Los botones de favoritos cambian el brillo o el modo del kit: puedes ajustarlos sin el móvil.',
          },
          { id: 'no', label: 'No cambió nada', conclusion: 'En tu coche los botones de favoritos no controlan el kit.' },
        ],
      },
    ],
  },
  {
    id: 'hcStrips',
    title: '¿Tienes tiras animadas?',
    why: 'La bienvenida solo se dibuja en las tiras animadas (cables HC). Con el efecto «Flujo» se ve si las hay y dónde.',
    stages: [
      {
        id: 'a',
        prepare: [{ kind: 'effect', id: 3 }],
        instruction: 'Mira las tiras del salpicadero y de las puertas durante unos segundos.',
        observe: 'luz que avanza a lo largo de la tira.',
        question: '¿Ves luz que se mueve a lo largo de alguna tira?',
        answers: [
          { id: 'dash', label: 'Sí, en el salpicadero', conclusion: 'Hay tiras animadas en el salpicadero.' },
          { id: 'doors', label: 'Sí, en las puertas', conclusion: 'Hay tiras animadas en las puertas.' },
          { id: 'both', label: 'Sí, en las dos', conclusion: 'Hay tiras animadas en el salpicadero y en las puertas.' },
          {
            id: 'no',
            label: 'No se mueve nada',
            conclusion: 'No se ven tiras animadas: la bienvenida usa esas tiras, así que no puede verse. Revisa la instalación (cables HC).',
          },
        ],
      },
    ],
  },
  {
    id: 'turn',
    title: '¿Lee los intermitentes?',
    why: 'El módulo lee la red del coche (el radar funciona). Falta saber si también hace parpadear las tiras con los intermitentes.',
    stages: [
      {
        id: 'a',
        prepare: [
          { kind: 'event', key: 'turn', on: true },
          { kind: 'turnColor', index: 1 },
        ],
        instruction:
          'Con el contacto puesto, pon el intermitente izquierdo unos segundos y quítalo. Luego enciende las luces de emergencia unos segundos y apágalas.',
        observe: 'si alguna tira parpadea en amarillo.',
        question: '¿Parpadeó alguna tira en amarillo?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'El módulo lee los intermitentes del coche.' },
          { id: 'no', label: 'No', conclusion: 'El módulo no reaccionó a los intermitentes.' },
          { id: 'unsure', label: 'No estoy seguro' },
        ],
      },
    ],
  },
  {
    id: 'door',
    title: '¿Lee las puertas?',
    why: 'El aviso de puerta abierta solo funciona si el módulo lee las puertas del coche.',
    stages: [
      {
        id: 'a',
        prepare: [
          { kind: 'event', key: 'door', on: true },
          // Blue: the default door colour (red) would not show on the user's red strips.
          { kind: 'doorColor', index: 3 },
        ],
        instruction: 'Con el contacto puesto, abre la puerta del conductor, espera 5 segundos y ciérrala.',
        observe: 'si las tiras se ponen azules o parpadean al abrir (el aviso de puerta está en azul para que se distinga).',
        question: '¿Se pusieron azules o parpadearon las tiras al abrir?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'El módulo lee las puertas.' },
          { id: 'no', label: 'No', conclusion: 'El aviso de puerta no se vio.' },
          { id: 'unsure', label: 'No estoy seguro' },
        ],
      },
    ],
    conclusions: [
      {
        when: [
          { test: 'turn', stage: 'a', answers: ['no'] },
          { test: 'door', stage: 'a', answers: ['no'] },
        ],
        // The module does read the car bus: the parking-sensor effect and the night dimming work (seen 2026-11-07).
        text: 'Ni las puertas ni los intermitentes cambian las tiras. El cable del coche está bien (el radar y la bajada de noche funcionan): son estos avisos los que no responden.',
      },
    ],
  },
  {
    id: 'dimming',
    title: 'La bajada de brillo al arrancar',
    why: 'Al arrancar baja la luz. Puede ser la opción «consola a mitad de brillo de noche» (activada en tu módulo) o que el módulo copie la atenuación del coche.',
    note: `Vas a arrancar el motor hasta tres veces. ${GARAGE}`,
    stages: [
      {
        id: 'a',
        instruction: `Deja el mando de luces en AUTO. ${GARAGE} Pon el contacto con el motor apagado, mira las tiras y arranca (freno + START).`,
        observe: 'el brillo de las tiras justo al arrancar.',
        question: '¿Bajó la luz al arrancar?',
        answers: [
          { id: 'all', label: 'Sí, todas las tiras', next: 'b' },
          { id: 'dash', label: 'Sí, solo el salpicadero', next: 'b' },
          { id: 'no', label: 'No bajó', next: 'end', conclusion: 'Ahora no baja; quizá solo de noche. Repite la prueba de noche.' },
        ],
      },
      {
        id: 'b',
        prepare: [{ kind: 'nightHalf', on: false }],
        instruction: 'Apaga el motor. Pon el contacto (START sin pisar el freno), espera 5 segundos y arranca (freno + START).',
        observe: 'el brillo de las tiras justo al arrancar.',
        question: '¿Sigue bajando?',
        answers: [
          { id: 'yes', label: 'Sí', next: 'c' },
          {
            id: 'no',
            label: 'No',
            next: 'end',
            conclusion: 'Era la opción «consola a mitad de brillo de noche». Puedes dejarla desactivada.',
            offers: ['keepNightHalfOff'],
          },
        ],
      },
      {
        id: 'c',
        prepare: [{ kind: 'controlMethod', value: 1 }],
        instruction: 'Apaga el motor. Pon el contacto (START sin pisar el freno), espera 5 segundos y arranca (freno + START).',
        observe: 'el brillo de las tiras justo al arrancar.',
        question: '¿Sigue bajando?',
        answers: [
          { id: 'no', label: 'No', conclusion: 'El módulo copia la atenuación del coche (control «coche + móvil»).' },
          { id: 'yes', label: 'Sí', conclusion: 'No es ninguna de las dos opciones; puede ser eléctrico.' },
        ],
      },
    ],
  },
  {
    id: 'idrive',
    title: 'Menú de luz ambiente del iDrive',
    why: 'Algunos iDrive tienen un menú de luz ambiente; con el control «coche + móvil» el módulo podría seguirlo.',
    stages: [
      {
        id: 'a',
        instruction: 'En el iDrive entra en Ajustes y busca Iluminación o Luces → luz ambiente / iluminación interior.',
        observe: 'si existe un menú de luz ambiente.',
        question: '¿Hay un menú de luz ambiente con brillo o color?',
        answers: [
          { id: 'yes', label: 'Sí', next: 'b' },
          {
            id: 'no',
            label: 'No',
            next: 'end',
            conclusion: 'Tu iDrive no tiene el menú; se podría activar con codificación (BimmerCode), opcional.',
          },
        ],
      },
      {
        id: 'b',
        instruction: 'Cambia el brillo de la luz ambiente en el iDrive mirando las tiras.',
        observe: 'si el brillo de las tiras cambia a la vez.',
        question: '¿Las tiras siguen el cambio?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Las tiras siguen el menú de luz ambiente del iDrive.' },
          { id: 'no', label: 'No', conclusion: 'Las tiras no siguen el menú de luz ambiente del iDrive.' },
        ],
      },
    ],
  },
  {
    id: 'welcome',
    title: 'Bienvenida (coche despierto)',
    why: 'La bienvenida no se ve. Se prueba en blanco, con un modo que se dibuja en el salpicadero (adecuado para un coupé), y con el aviso de puerta apagado para que no la tape.',
    note: 'Puede que el móvil se desconecte mientras estás fuera. Al volver, si no se conecta solo, pulsa «Conectar» arriba.',
    stages: [
      {
        id: 'a',
        prepare: WELCOME_PRESET,
        instruction: 'Apaga el coche, baja, cierra la puerta y bloquea con la llave.',
        observe: 'las tiras justo al bloquear.',
        question: '¿Se apagaron las tiras justo al bloquear?',
        answers: [
          { id: 'now', label: 'Sí, al momento', conclusion: 'Las tiras se apagan al bloquear: otra señal de que el módulo lee el coche.' },
          { id: 'later', label: 'Se apagaron más tarde' },
          { id: 'on', label: 'Siguen encendidas' },
        ],
      },
      {
        id: 'b',
        countdownSec: 15,
        instruction:
          'Sin desbloquear todavía, pulsa «Empezar cuenta atrás». Cuando ponga «¡Ya!», desbloquea con el botón de la llave (sin tocar la manilla) y mira las tiras 10 segundos. Luego abre la puerta del conductor y mira otros 10 segundos.',
        observe: 'luz blanca recorriendo alguna tira.',
        question: '¿Viste luz blanca recorriendo alguna tira?',
        answers: [
          {
            id: 'unlock',
            label: 'Sí, al desbloquear',
            next: 'end',
            conclusion: 'La bienvenida funciona con el modo que se dibuja en el salpicadero («envolvente consola»): aparece al desbloquear.',
            offers: KEEP_WELCOME,
          },
          {
            id: 'door',
            label: 'Sí, al abrir la puerta',
            next: 'end',
            conclusion: 'La bienvenida funciona con el modo que se dibuja en el salpicadero («envolvente consola»): aparece al abrir la puerta.',
            offers: KEEP_WELCOME,
          },
          { id: 'no', label: 'No', next: 'c' },
        ],
      },
      {
        id: 'c',
        prepare: [{ kind: 'welcome', mode: 1 }],
        countdownSec: 15,
        instruction:
          'Cierra la puerta y bloquea con el botón de la llave. Justo después pulsa «Empezar cuenta atrás». Cuando ponga «¡Ya!», desbloquea con el botón de la llave y abre la puerta del conductor.',
        observe: 'luz blanca recorriendo alguna tira.',
        question: '¿Y ahora viste luz blanca recorriendo alguna tira?',
        answers: [
          {
            id: 'yes',
            label: 'Sí',
            conclusion: 'La bienvenida funciona con el modo que se dibuja en las puertas («envolvente puertas»).',
            offers: KEEP_WELCOME,
          },
          {
            id: 'no',
            label: 'No',
            conclusion: 'Con el módulo despierto la bienvenida no aparece. Queda la prueba tras dormir el coche.',
          },
        ],
      },
    ],
  },
  {
    id: 'sleep',
    title: 'Bienvenida tras dormir el coche (opcional, otro día)',
    why: 'Puede que el módulo se apague cuando el coche se duerme y que la bienvenida solo salga al despertar.',
    note: 'Antes de irte, pulsa «Terminar»: esta prueba se queda esperando y el resto se restaura. Hasta que contestes, el aviso de puerta abierta sigue apagado y la bienvenida está en blanco. Pon un recordatorio en el iPhone: la página no puede avisarte.',
    waitingNote: 'Hasta que contestes, el aviso de puerta abierta sigue apagado y la bienvenida está en blanco.',
    stages: [
      {
        id: 'a',
        prepare: WELCOME_PRESET,
        deferred: true,
        instruction:
          'Antes de irte, pulsa «Terminar» abajo. Bloquea el coche y déjalo al menos 40 minutos (mejor una noche) con Bluefy cerrado. Al volver, desbloquea y abre la puerta mirando las tiras. Después abre la app: esta prueba te estará esperando.',
        observe: 'la animación blanca al desbloquear o al abrir la puerta.',
        question: '¿Apareció la animación?',
        answers: [
          {
            id: 'yes',
            label: 'Sí',
            conclusion: 'La bienvenida aparece tras dormir el coche: depende de que el módulo arranque.',
            offers: KEEP_WELCOME,
          },
          { id: 'no', label: 'No', conclusion: 'Tampoco aparece tras dormir el coche.' },
        ],
      },
    ],
  },
];


const KEEP_RADAR: readonly Offer[] = ['keepRadarOn'];

const SAME_AS_BEFORE = 'Otra vez el 5, igual que antes.';
const radioPress = (id: string, next5: string | undefined): Stage => ({
  id,
  instruction: SAME_AS_BEFORE,
  observe: 'el color de las tiras.',
  question: '¿Qué color salió?',
  answers: [
    { id: 'new', label: 'Uno nuevo', ...(next5 ? { next: next5 } : {}) },
    { id: 'seen', label: 'Uno que ya salió', next: 'k6' },
    { id: 'same', label: 'No cambió', next: 'k6' },
  ],
});

/**
 * Second round (from 2026-11-09): what the module can do without the phone,
 * after the first round showed a solid-colour kit (no movement with «Flujo»)
 * that reads the radar, the climate control, the radio keys and the iDrive
 * brightness but shows no door, turn or welcome effect. See docs/opciones-sin-movil.md.
 * Day tests first, then driving, then night; «seguir las luces» last, because
 * keeping it leaves the strips off by day for the rest of the session.
 */
export const CAR_TESTS_ROUND2: readonly CarTest[] = [
  {
    id: 'kitType',
    title: '¿Tiras de color fijo o animadas?',
    why: 'Con «Flujo» no se movió nada. Si tu kit es de color fijo, la bienvenida y los efectos animados no pueden verse nunca. Esta prueba lo confirma y, de paso, muestra qué tiras son de cada zona.',
    stages: [
      {
        id: 'a',
        prepare: [
          { kind: 'color', zone: 1, hex: '#ff00ff' },
          { kind: 'color', zone: 2, hex: '#ffffff' },
        ],
        instruction: 'Pon el contacto (START sin pisar el freno) y mira todas las tiras: salpicadero, puertas, pies y portaobjetos.',
        observe: 'qué tiras salen moradas y cuáles blancas.',
        question: '¿Cómo se repartieron los colores?',
        answers: [
          {
            id: 'vendor',
            label: 'Salpicadero y puertas moradas; pies y portaobjetos blancos',
            conclusion: 'Las zonas son las del fabricante: zona 1 = salpicadero, tiradores y contornos; zona 2 = pies y portaobjetos. Puedes tener dos colores a la vez.',
          },
          { id: 'other', label: 'Otro reparto', conclusion: 'Las zonas no son las del manual del fabricante.' },
          { id: 'same', label: 'Todas del mismo color', conclusion: 'Tu instalación no separa zonas: todas las tiras van juntas.' },
        ],
      },
      {
        id: 'b',
        // All white first: any second colour or movement then comes from the effect.
        prepare: [
          { kind: 'color', zone: 0, hex: '#ffffff' },
          { kind: 'effect', id: 0 },
        ],
        instruction: 'Mira las tiras durante 10 segundos.',
        observe: 'si alguna tira deja de ser blanca: varios colores a la vez o luz que se mueve.',
        question: '¿Alguna tira tiene ahora varios colores o luz que se mueve?',
        answers: [
          {
            id: 'no',
            label: 'No, todas siguen blancas',
            conclusion:
              'Tu kit es de color fijo, sin tiras animadas: la bienvenida y los efectos animados no pueden verse. Para tenerlos habría que poner las tiras animadas («幻彩») del mismo fabricante, que van en esta misma caja.',
          },
          { id: 'yes', label: 'Sí, colores o movimiento', conclusion: 'Hay tiras animadas: la bienvenida debería poder verse en ellas.' },
        ],
      },
    ],
  },
  {
    id: 'acLook',
    title: 'Qué hace el climatizador en las tiras',
    why: 'Ya viste que el climatizador cambia el color. Si el color se queda puesto, la rueda de temperatura serviría para elegir color sin el móvil.',
    note: 'Al terminar, vuelve a poner tu temperatura de siempre.',
    stages: [
      {
        id: 'a',
        // White, so a red or orange reaction shows (the user's colour is red).
        prepare: [
          { kind: 'color', zone: 0, hex: '#ffffff' },
          { kind: 'event', key: 'ac', on: true },
        ],
        instruction: 'Con el contacto puesto, sube 2 grados la temperatura y espera 15 segundos sin tocar nada.',
        observe: 'de qué color se ponen las tiras (ahora están en blanco para que se note) y cuánto dura.',
        question: '¿Qué hicieron las tiras al subir?',
        answers: [
          { id: 'flash', label: 'Cambiaron un momento y volvieron', conclusion: 'Al subir, el climatizador solo da un aviso corto.' },
          { id: 'stay', label: 'Cambiaron y se quedaron así', conclusion: 'Al subir, el color se queda.' },
          { id: 'none', label: 'Nada' },
        ],
      },
      {
        id: 'b',
        instruction: 'Ahora baja 4 grados y espera 15 segundos.',
        observe: 'de qué color se ponen las tiras y cuánto dura.',
        question: '¿Y al bajar?',
        answers: [
          { id: 'flash', label: 'Cambiaron un momento y volvieron', conclusion: 'Al bajar, también es solo un aviso corto: no sirve para elegir color.' },
          { id: 'stay', label: 'Cambiaron y se quedaron así', conclusion: 'Al bajar, el color se queda: la temperatura cambia el color del kit.' },
          { id: 'none', label: 'Nada' },
        ],
      },
    ],
  },
  {
    id: 'radioMap',
    title: 'Botones de la radio: qué colores recorren',
    why: 'Los botones de favoritos cambian el color sin el móvil. Para usarlos como escenas (por ejemplo, dos toques al arrancar) hay que saber qué colores recorren y en qué orden. La app apunta el color después de cada toque.',
    note: 'Si en un botón tienes guardado un teléfono, apretarlo lo llamaría: tócalo sin apretar.',
    stages: [
      {
        id: 'a',
        instruction: 'Con el contacto puesto, toca el botón de favoritos 5 sin apretarlo (solo apoya el dedo).',
        observe: 'el color de las tiras.',
        question: '¿Cambió el color?',
        answers: [
          { id: 'yes', label: 'Sí', next: 'p2', conclusion: 'Basta con tocar el botón, sin apretarlo.' },
          { id: 'no', label: 'No' },
        ],
      },
      {
        id: 'a2',
        instruction: 'Ahora aprieta el 5 una vez. Si cambia de emisora, es normal.',
        observe: 'el color de las tiras.',
        question: '¿Cambió el color?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Hay que apretar el botón (tocarlo no basta).' },
          { id: 'no', label: 'No', next: 'k4', conclusion: 'El botón 5 no cambia el color.' },
        ],
      },
      radioPress('p2', undefined),
      radioPress('p3', undefined),
      radioPress('p4', undefined),
      radioPress('p5', undefined),
      radioPress('p6', 'k6'),
      {
        id: 'k6',
        instruction: 'Ahora el 6 una vez, igual que el 5.',
        observe: 'el color de las tiras.',
        question: '¿Volvió al color anterior?',
        answers: [
          { id: 'back', label: 'Sí, al anterior' },
          { id: 'other', label: 'Cambió a otro' },
          { id: 'same', label: 'No cambió' },
        ],
      },
      {
        id: 'k4',
        instruction: 'Ahora el 4 una vez.',
        observe: 'si cambia el modo (por ejemplo, empieza a cambiar de color solo o a respirar).',
        question: '¿Qué pasó con el 4?',
        answers: [
          { id: 'mode', label: 'Cambió el modo' },
          { id: 'color', label: 'Cambió el color' },
          { id: 'none', label: 'Nada' },
        ],
      },
      {
        id: 'k7',
        instruction: 'Ahora el 7 una vez.',
        observe: 'el brillo de las tiras.',
        question: '¿Qué hizo el brillo?',
        answers: [
          { id: 'up', label: 'Subió' },
          { id: 'down', label: 'Bajó' },
          { id: 'none', label: 'Nada' },
        ],
      },
      {
        id: 'k8',
        instruction: 'Ahora el 8 una vez.',
        observe: 'el brillo de las tiras.',
        question: '¿Qué hizo el brillo?',
        answers: [
          { id: 'up', label: 'Subió' },
          { id: 'down', label: 'Bajó' },
          { id: 'none', label: 'Nada' },
        ],
      },
    ],
  },
  {
    id: 'pdc',
    title: 'Radar sin marcha atrás (botón PDC)',
    why: 'El radar ya funciona en marcha atrás. Si tu coche tiene botón PDC (sensores de aparcamiento) junto a la palanca, al pulsarlo se encienden los sensores sin meter la marcha atrás: quizá las tiras muestren también los colores del radar.',
    stages: [
      {
        id: 'a',
        prepare: [{ kind: 'event', key: 'radar', on: true }],
        instruction: `${GARAGE} Arranca y pon el freno de mano, en P. Con una pared o un objeto a menos de un metro, delante o detrás (nunca una persona), pulsa el botón PDC (el del coche con ondas, junto a la palanca).`,
        observe: 'las tiras de luz, no la pantalla del coche.',
        question: '¿Cambiaron las tiras de color al pulsar el PDC?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Con el botón PDC las tiras muestran el radar sin marcha atrás.', offers: KEEP_RADAR },
          { id: 'no', label: 'No', conclusion: 'El radar solo sale con la marcha atrás.', offers: KEEP_RADAR },
          { id: 'noButton', label: 'No tengo ese botón', offers: KEEP_RADAR },
        ],
      },
    ],
  },
  {
    id: 'speed',
    title: 'Aviso de velocidad (conduciendo, con acompañante)',
    why: 'El módulo tiene un «aviso de exceso de velocidad» que nunca hemos probado. Nadie sabe a qué velocidad salta: si salta a una velocidad normal, sería un cambio automático al conducir.',
    note: 'La segunda parte es conduciendo: hace falta un acompañante que mire las tiras y conteste. El conductor no mira el móvil ni las tiras, y nunca se pasa un límite para provocarlo.',
    stages: [
      {
        id: 'modes',
        prepare: [{ kind: 'event', key: 'speed', on: true }],
        instruction: `${GARAGE} Arranca y, en P, cambia entre ECO PRO, COMFORT y SPORT con el botón de modos junto a la palanca.`,
        observe: 'las tiras.',
        question: '¿Cambiaron las tiras con el modo de conducción?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Las tiras reaccionan al modo de conducción.' },
          { id: 'no', label: 'No', conclusion: 'El modo de conducción no cambia las tiras.' },
        ],
      },
      {
        id: 'drive',
        instruction:
          'Conduce con normalidad, sin pasar ningún límite. Tu acompañante (nunca el conductor) mira las tiras y la velocidad, y contesta. Si el aviso molesta al conducir, pulsad «Saltar esta prueba»: se apaga enseguida.',
        observe: 'si las tiras cambian o parpadean, y a qué velocidad.',
        question: '¿Cambiaron las tiras al ir más rápido?',
        answers: [
          { id: 'low', label: 'Sí, por debajo de 50 km/h', conclusion: 'El aviso de velocidad salta por debajo de 50 km/h.', offers: ['keepSpeedOn'] },
          { id: 'mid', label: 'Sí, entre 50 y 100 km/h', conclusion: 'El aviso de velocidad salta entre 50 y 100 km/h.', offers: ['keepSpeedOn'] },
          { id: 'high', label: 'Sí, por encima de 100 km/h', conclusion: 'El aviso de velocidad salta por encima de 100 km/h.', offers: ['keepSpeedOn'] },
          { id: 'no', label: 'No cambió nada', conclusion: 'El aviso de velocidad no se vio a las velocidades a las que fuisteis.' },
        ],
      },
    ],
  },
  {
    id: 'night',
    title: 'De noche: que baje solo el salpicadero',
    why: 'Al arrancar de noche baja el brillo. Con las zonas «Delante / detrás» quizá baje solo el salpicadero y las puertas sigan igual: un cambio más visible al conducir de noche. De paso se confirma que la bajada viene de la opción «consola a mitad de brillo».',
    note: `Hazla de noche (o en un garaje oscuro) con el mando de luces en AUTO. ${GARAGE}`,
    stages: [
      {
        id: 'base',
        instruction: `${GARAGE} Si el motor está en marcha, apágalo. Pon el contacto (START sin pisar el freno), mira las tiras y arranca (freno + START).`,
        observe: 'el salpicadero y las puertas justo al arrancar.',
        question: '¿Qué bajó al arrancar (con tus zonas de siempre)?',
        answers: [
          {
            id: 'dash',
            label: 'Solo el salpicadero',
            next: 'b',
            conclusion: 'Con tus zonas de siempre ya baja solo el salpicadero: no hace falta cambiarlas.',
          },
          { id: 'all', label: 'Bajó todo', next: 'a' },
          { id: 'none', label: 'No bajó nada', next: 'end', conclusion: 'No bajó nada: quizá para el coche todavía no era de noche.' },
        ],
      },
      {
        id: 'a',
        prepare: [{ kind: 'zoning', value: 1 }],
        instruction: 'Apaga el motor. Pon el contacto (START sin pisar el freno), espera 5 segundos y vuelve a arrancar.',
        observe: 'el salpicadero y las puertas justo al arrancar.',
        question: '¿Y ahora qué bajó?',
        answers: [
          {
            id: 'dash',
            label: 'Solo el salpicadero',
            conclusion: 'Con las zonas «Delante / detrás», de noche solo baja el salpicadero.',
            offers: ['keepFrontRearZones'],
          },
          { id: 'all', label: 'Bajó todo', conclusion: 'Con las zonas «Delante / detrás» baja todo igual: no aportan nada.' },
        ],
      },
      {
        id: 'b',
        prepare: [{ kind: 'nightHalf', on: false }],
        instruction: 'Apaga el motor. Pon el contacto (START sin pisar el freno), espera 5 segundos y vuelve a arrancar. Cuando contestes, apaga el motor.',
        observe: 'el brillo de las tiras justo al arrancar.',
        question: '¿Sigue bajando al arrancar?',
        answers: [
          {
            id: 'no',
            label: 'No',
            conclusion: 'Era la opción «consola a mitad de brillo de noche». Puedes dejarla desactivada.',
            offers: ['keepNightHalfOff'],
          },
          { id: 'yes', label: 'Sí', conclusion: 'Baja aunque esa opción esté apagada: lo hace el coche (brillo del iDrive o de los instrumentos).' },
        ],
      },
    ],
  },
  {
    id: 'doorTurnNight',
    title: 'De noche: puerta e intermitentes, último intento',
    why: 'El aviso de puerta y los intermitentes no se vieron con el contacto puesto. Falta probarlos de noche, con el motor en marcha y con un color base que contraste.',
    note: 'De noche, con el motor en marcha, en P y con el freno de mano. Si estás en un garaje, abre su puerta antes de arrancar.',
    stages: [
      {
        id: 'a',
        prepare: [
          { kind: 'color', zone: 0, hex: '#00ff00' },
          { kind: 'event', key: 'door', on: true },
          { kind: 'doorColor', index: 3 },
          { kind: 'event', key: 'turn', on: true },
          { kind: 'turnColor', index: 1 },
        ],
        instruction:
          'Si estás en un garaje, abre su puerta antes de arrancar. Arranca y pon el freno de mano, en P. Abre la puerta del conductor 5 segundos y ciérrala. Luego la del acompañante.',
        observe: 'un destello azul en cualquier tira (están en verde para que se note).',
        question: '¿Viste azul?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Con el motor en marcha el aviso de puerta funciona.', offers: ['keepDoorWarning'] },
          {
            id: 'no',
            label: 'No',
            conclusion: 'Ni con el motor en marcha se vio el aviso de puerta (con la depuración de la app activada, que casi seguro no influye).',
          },
        ],
      },
      {
        id: 'b',
        // Blue: yellow shows better on blue than on green.
        prepare: [{ kind: 'color', zone: 0, hex: '#0000ff' }],
        instruction:
          'Con el motor todavía en marcha, pon el intermitente izquierdo 5 segundos, luego el derecho, y luego las luces de emergencia. Cuando contestes, apaga el motor.',
        observe: 'amarillo en alguna tira (ahora están en azul para que se note).',
        question: '¿Viste amarillo?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Con el motor en marcha los intermitentes se ven en las tiras.', offers: ['keepTurnWarning'] },
          {
            id: 'no',
            label: 'No',
            conclusion: 'Ni con el motor en marcha se vieron los intermitentes (con la depuración de la app activada, que casi seguro no influye).',
          },
        ],
      },
    ],
  },
  {
    id: 'music',
    title: 'Ritmo con la música (opcional)',
    why: 'El módulo tiene modos que laten con la música. No es un aviso, pero es otra forma de que las tiras reaccionen a algo que haces.',
    stages: [
      {
        id: 'a',
        prepare: [{ kind: 'rgbMode', mode: 15 }],
        instruction: 'Con el contacto puesto, pon música bastante alta 20 segundos y luego párala 10 segundos.',
        observe: 'si las tiras laten al ritmo y se paran al quitar la música.',
        question: '¿Laten con la música y se paran sin ella?',
        answers: [
          { id: 'yes', label: 'Sí', conclusion: 'Los modos de ritmo funcionan: los tienes en la pestaña Color, «Modos RGB».' },
          {
            id: 'no',
            label: 'No',
            conclusion:
              'Con la fuente de sonido sin elegir, los modos de ritmo no reaccionan. Falta probar «micrófono interno» y «altavoces del coche», que la app no puede devolver luego a como estaban.',
          },
        ],
      },
    ],
  },
  {
    id: 'followLights',
    title: 'Que las tiras sigan las luces del coche (de día)',
    why: 'El módulo puede encender el ambiente solo cuando las luces del coche están encendidas. Con el mando en AUTO cambiaría solo según la luz: apagado de día, encendido al anochecer, en túneles y en garajes.',
    note: 'Mejor de día. Si las tiras se quedan apagadas, no pasa nada: al terminar la prueba la app las vuelve a encender, salvo que elijas dejarlo así.',
    stages: [
      {
        id: 'a',
        prepare: [{ kind: 'power', mode: 2 }],
        instruction: 'Con el contacto puesto, pon las luces de cruce y espera 3 segundos.',
        observe: 'si las tiras están encendidas.',
        question: '¿Cómo están las tiras con las luces de cruce?',
        answers: [
          { id: 'on', label: 'Encendidas' },
          {
            id: 'off',
            label: 'Apagadas',
            next: 'end',
            conclusion: 'Con las luces encendidas las tiras se apagan: el módulo no detecta las luces de tu coche.',
          },
        ],
      },
      {
        id: 'b',
        instruction: 'Ahora gira el mando de luces a 0 y espera 3 segundos (si el mando vuelve solo a AUTO, es normal: las luces se apagan igual).',
        observe: 'si las tiras se apagan.',
        question: '¿Y con las luces apagadas?',
        answers: [
          {
            id: 'off',
            label: 'Apagadas',
            conclusion: 'Las tiras siguen las luces del coche: con el mando en AUTO se encenderán y apagarán solas. De día, en AUTO, se quedarán apagadas.',
            offers: ['keepFollowLights'],
          },
          {
            id: 'on',
            label: 'Encendidas',
            next: 'end',
            conclusion: 'Con las luces apagadas las tiras siguen encendidas: el módulo no sigue las luces de tu coche.',
          },
        ],
      },
      {
        id: 'c',
        instruction: 'Deja el mando de luces en AUTO.',
        observe: 'las tiras.',
        question: '¿Y en AUTO, ahora?',
        answers: [
          { id: 'on', label: 'Encendidas', conclusion: 'En AUTO, ahora mismo el coche lleva las luces encendidas, y las tiras también.' },
          { id: 'off', label: 'Apagadas', conclusion: 'En AUTO y con luz de día se quedan apagadas: se encenderán al anochecer.' },
        ],
      },
    ],
  },
];

const ROUND1_NOTE = 'De la primera ronda (7–9/11). Si quieres repetirla, pulsa «Hacerla ahora».';

/** The session: the second round in order, then the first round on demand. */
export const CAR_TESTS: readonly CarTest[] = [...CAR_TESTS_ROUND2, ...CAR_TESTS_ROUND1.map((t) => ({ ...t, archived: ROUND1_NOTE }))];

// ---------------------------------------------------------------------------
// Preparation (pure)

export interface PreparePlan {
  /** Usage-settings commands, in order (the dial is handled separately). */
  commands: string[];
  touched: SnapshotField[];
  unreadable: UnreadableField[];
  /** Target of feature switch 8, or null when the stage does not touch it. */
  feature8: boolean | null;
  /** Actions left out (e.g. an event the car does not support). */
  skipped: string[];
}

const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...new Set([...a, ...b])];

/** Commands and touched fields of a list of actions, built with the encoders of commands.ts. */
export function preparePlan(actions: readonly PrepareAction[], snapshot?: SnapshotValues | null): PreparePlan {
  const plan: PreparePlan = { commands: [], touched: [], unreadable: [], feature8: null, skipped: [] };
  const touch = (...fields: SnapshotField[]) => (plan.touched = union(plan.touched, fields));
  for (const action of actions) {
    switch (action.kind) {
      case 'event':
        if (snapshot?.events[action.key] === UNSUPPORTED) {
          plan.skipped.push(`${action.key}: no admitido por el coche`);
          break;
        }
        plan.commands.push(cmd.carEvent(action.key, action.on));
        touch(`events.${action.key}`);
        break;
      case 'turnColor':
        plan.commands.push(cmd.turnColor(action.index));
        plan.unreadable = union(plan.unreadable, ['turnColor']);
        break;
      case 'doorColor':
        plan.commands.push(cmd.doorColor(action.index));
        plan.unreadable = union(plan.unreadable, ['doorColor']);
        break;
      case 'power':
        plan.commands.push(cmd.power(action.mode));
        plan.unreadable = union(plan.unreadable, ['power']);
        break;
      case 'zoning': {
        plan.commands.push(cmd.zoning(action.value));
        touch('zoning');
        // The sliders change meaning with the zoning: the same values are sent again.
        const b = snapshot?.brightness;
        if (b?.b1 != null) plan.commands.push(cmd.brightness(1, b.b1));
        if (b?.b2 != null) plan.commands.push(cmd.brightness(2, b.b2));
        if (b?.b3 != null) plan.commands.push(cmd.brightness(3, b.b3));
        touch('brightness.b1', 'brightness.b2', 'brightness.b3');
        break;
      }
      case 'color':
        plan.commands.push(cmd.color(action.zone, action.hex));
        // A zone colour is put back by the whole-car colour.
        touch('color');
        break;
      case 'rgbMode':
        plan.commands.push(cmd.rgbMode(action.mode));
        // The colour is sent again after the mode when restoring (a mode can replace it).
        touch('rgbMode', 'color');
        break;
      case 'effect':
        plan.commands.push(cmd.effect(action.id));
        // [1E] also switches the custom effect sequence off.
        touch('effect', 'effectCustomEnabled');
        break;
      case 'nightHalf':
        plan.commands.push(cmd.nightHalf(action.on));
        touch('nightHalf');
        break;
      case 'controlMethod':
        plan.commands.push(cmd.controlMethod(action.value));
        touch('controlMethod');
        break;
      case 'welcome':
        if (action.enabled !== undefined) {
          plan.commands.push(cmd.welcomeEnabled(action.enabled));
          touch('welcomeEnabled');
        }
        if (action.mode !== undefined) {
          plan.commands.push(cmd.welcomeMode(action.mode));
          touch('welcomeMode');
        }
        if (action.color !== undefined) {
          plan.commands.push(cmd.welcomeColor(action.color));
          touch('welcomeColor');
        }
        break;
      case 'dialFeature8':
        plan.feature8 = action.on;
        touch('factory.dial');
        break;
      default:
        break;
    }
  }
  return plan;
}

/** `values` as they are after the actions (what a stage leaves on the module). */
export function applyActions(values: SnapshotValues, actions: readonly PrepareAction[]): SnapshotValues {
  const out = cloneValues(values);
  for (const action of actions) {
    switch (action.kind) {
      case 'event':
        if (out.events[action.key] !== UNSUPPORTED) out.events[action.key] = action.on ? 1 : 0;
        break;
      case 'effect':
        out.effect = action.id;
        out.effectCustomEnabled = false;
        break;
      case 'zoning':
        out.zoning = action.value;
        break;
      case 'color':
        // A single zone is not modelled: the module reports one colour.
        if (action.zone === 0) out.color = `#${cmd.normalizeHexColor(action.hex)}`;
        break;
      case 'rgbMode':
        out.rgbMode = action.mode;
        break;
      case 'nightHalf':
        out.nightHalf = action.on;
        break;
      case 'controlMethod':
        out.controlMethod = action.value;
        break;
      case 'welcome':
        if (action.enabled !== undefined) out.welcomeEnabled = action.enabled;
        if (action.mode !== undefined) out.welcomeMode = action.mode;
        if (action.color !== undefined) {
          out.welcomeColor = action.color;
          out.welcomeSync = false;
        }
        break;
      case 'dialFeature8':
        if (out.factory.featureBits) out.factory.featureBits = withFeatureSwitch(out.factory.featureBits, 8, action.on);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Command of each unreadable value. */
const UNREADABLE_ENCODERS: Readonly<Record<UnreadableField, (value: number) => string>> = {
  turnColor: (n) => cmd.turnColor(n),
  doorColor: (n) => cmd.doorColor(n),
  power: (n) => cmd.power(n as cmd.PowerMode),
};

/** Default of each unreadable value (the vendor app's first option; the lights on for [07]). */
const UNREADABLE_DEFAULT_VALUES: Readonly<Record<UnreadableField, number>> = { turnColor: 0, doorColor: 0, power: 1 };

export const UNREADABLE_DEFAULTS: Readonly<Record<UnreadableField, () => string>> = {
  turnColor: () => UNREADABLE_ENCODERS.turnColor(UNREADABLE_DEFAULT_VALUES.turnColor),
  doorColor: () => UNREADABLE_ENCODERS.doorColor(UNREADABLE_DEFAULT_VALUES.doorColor),
  power: () => UNREADABLE_ENCODERS.power(UNREADABLE_DEFAULT_VALUES.power),
};

export const UNREADABLE_NOTES: Readonly<Record<UnreadableField, string>> = {
  turnColor: 'El color del intermitente no se puede leer del módulo: se ha dejado en rojo, el valor por defecto.',
  doorColor: 'El color de puerta abierta no se puede leer del módulo: se ha dejado en rojo, el valor por defecto.',
  power: 'El encendido de las tiras no se puede leer del módulo: se ha dejado en «Encendido».',
};

const UNREADABLE_KNOWN_NOTES: Readonly<Record<UnreadableField, string>> = {
  turnColor: 'El color del intermitente se deja como estaba (lo elegiste en una sesión anterior).',
  doorColor: 'El color de puerta abierta se deja como estaba (lo elegiste en una sesión anterior).',
  power: 'Las tiras se dejan siguiendo las luces del coche, como estaban (lo elegiste en una sesión anterior).',
};

const UNREADABLE_KEPT_NOTES: Readonly<Record<UnreadableField, string>> = {
  turnColor: 'El color del intermitente se deja como elegiste.',
  doorColor: 'El color de puerta abierta se deja como elegiste.',
  power: 'Las tiras se dejan siguiendo las luces del coche, como elegiste.',
};

/** What the user chose to keep instead of restoring (applied on top of the snapshot). */
export interface KeptChanges {
  nightHalf?: boolean;
  feature8?: boolean;
  welcomeEnabled?: boolean;
  welcomeMode?: number;
  welcomeColor?: number;
  zoning?: BinaryValue;
  events?: Partial<Record<CarEventKey, 0 | 1>>;
  /** Values the module never reports, restored to these instead of their default. */
  unreadable?: Partial<Record<UnreadableField, number>>;
}

/** Offers that keep fixed values (the welcome ones depend on the stage and are handled apart). */
const FIXED_KEEPS: Partial<Record<Offer, { changes: KeptChanges; note: string }>> = {
  keepFollowLights: {
    changes: { unreadable: { power: 2 } },
    note: 'A petición tuya, las tiras siguen las luces del coche ([0702]).',
  },
  keepFrontRearZones: {
    changes: { zoning: 1 },
    note: 'A petición tuya se dejan las zonas de brillo «Delante / detrás» ([1401]).',
  },
  keepSpeedOn: { changes: { events: { speed: 1 } }, note: 'A petición tuya se deja activado el aviso de velocidad ([3301]).' },
  keepRadarOn: { changes: { events: { radar: 1 } }, note: 'A petición tuya se deja activado el radar ([3201]).' },
  keepDoorWarning: {
    changes: { events: { door: 1 }, unreadable: { doorColor: 3 } },
    note: 'A petición tuya se deja activado el aviso de puerta, en azul ([3101] [4603]).',
  },
  keepTurnWarning: {
    changes: { events: { turn: 1 }, unreadable: { turnColor: 1 } },
    note: 'A petición tuya se deja activado el aviso de intermitentes, en amarillo ([3401] [4501]).',
  },
};

function mergeKept(a: KeptChanges, b: KeptChanges): KeptChanges {
  return {
    ...a,
    ...b,
    ...(a.events || b.events ? { events: { ...a.events, ...b.events } } : {}),
    ...(a.unreadable || b.unreadable ? { unreadable: { ...a.unreadable, ...b.unreadable } } : {}),
  };
}

/** Unreadable values the user chose to keep, over all tests (in test order). */
export function keptUnreadable(records: Record<string, TestRecord>, tests: readonly CarTest[] = CAR_TESTS): Partial<Record<UnreadableField, number>> {
  const out: Partial<Record<UnreadableField, number>> = {};
  for (const test of tests) Object.assign(out, records[test.id]?.keptChanges?.unreadable);
  return out;
}

/**
 * The command that puts an unreadable value back: what the user kept in this
 * session, else what an earlier session left (`known`), else its default.
 */
export function unreadableRestore(
  u: UnreadableField,
  kept: Partial<Record<UnreadableField, number>>,
  known: Partial<Record<UnreadableField, number>> = {},
): { command: string; note: string } {
  if (kept[u] !== undefined) return { command: UNREADABLE_ENCODERS[u](kept[u] as number), note: UNREADABLE_KEPT_NOTES[u] };
  if (known[u] !== undefined) return { command: UNREADABLE_ENCODERS[u](known[u] as number), note: UNREADABLE_KNOWN_NOTES[u] };
  return { command: UNREADABLE_DEFAULTS[u](), note: UNREADABLE_NOTES[u] };
}

/** The copy's raw frames with the unreadable values the user kept, for comparing positions nobody decodes. */
function framesWithKept(frames: Record<string, string>, kept: Partial<Record<UnreadableField, number>>): Record<string, string> {
  const out = { ...frames };
  const put = (code: string, at: number, value: number) => {
    const f = out[code];
    if (f && f.length > at + 1) out[code] = f.slice(0, at) + value.toString(16).padStart(2, '0').toUpperCase() + f.slice(at + 2);
  };
  // backup.ts UNKNOWN_SPANS: 4E/1F 7–8 «¿encendido?», 26 25–26 «¿color de puerta?».
  if (kept.power !== undefined) for (const code of ['4E', '1F']) put(code, 7, kept.power);
  if (kept.doorColor !== undefined) put('26', 25, kept.doorColor);
  return out;
}

function applyKept(values: SnapshotValues, kept: KeptChanges): void {
  if (kept.zoning !== undefined) values.zoning = kept.zoning;
  for (const [key, on] of Object.entries(kept.events ?? {}) as [CarEventKey, 0 | 1][]) {
    if (values.events[key] !== UNSUPPORTED) values.events[key] = on;
  }
  if (kept.nightHalf !== undefined) values.nightHalf = kept.nightHalf;
  if (kept.feature8 !== undefined && values.factory.featureBits) {
    values.factory.featureBits = withFeatureSwitch(values.factory.featureBits, 8, kept.feature8);
  }
  if (kept.welcomeEnabled !== undefined) values.welcomeEnabled = kept.welcomeEnabled;
  if (kept.welcomeMode !== undefined) values.welcomeMode = kept.welcomeMode;
  if (kept.welcomeColor !== undefined) {
    values.welcomeColor = kept.welcomeColor;
    values.welcomeSync = false;
  }
}

/** What restores aim for: the snapshot plus every change the user chose to keep (in test order). */
export function targetFrom(snapshot: SnapshotValues, records: Record<string, TestRecord>, tests: readonly CarTest[] = CAR_TESTS): SnapshotValues {
  const target = cloneValues(snapshot);
  for (const test of tests) {
    const kept = records[test.id]?.keptChanges;
    if (kept) applyKept(target, kept);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Runner state

export type TestStatus = 'pending' | 'running' | 'deciding' | 'waiting' | 'done' | 'skipped' | 'interrupted' | 'aborted' | 'notOffered';

export interface EvidenceChange {
  field: SnapshotField;
  label: string;
  before: string;
  after: string;
  /** Changed by this test's own preparation. */
  byTest: boolean;
}

export interface StageRecord {
  stageId: string;
  question: string;
  startedAt: string;
  answeredAt: string;
  answerId: string;
  answer: string;
  conclusion?: string;
  offers?: Offer[];
  withdraws?: Offer[];
  /** Commands the stage's preparation sent. */
  prepared: string[];
  /** Fresh [0A01] state versus the target (the snapshot plus kept changes). */
  changes: EvidenceChange[];
  /** The state could not be read (link down, no answer): no diff. */
  stateUnknown: boolean;
  /** Frame groups that did not arrive in the fresh read: their settings were not compared. */
  stateMissing?: string[];
  /** Raw positions nobody decodes (4E 7–8, 15–20; 26 25–26) that differ from the snapshot. */
  unknownChanges?: RawChange[];
  /** Notifications not explained by an app command (FFE1 and FFE2). */
  unsolicited: LogEntry[];
  /** Notifications that answered app commands. */
  responses: number;
  /** Times the link dropped while the stage was shown. */
  linkDrops?: number;
  /** The link was down when the answer was given. */
  linkDown?: boolean;
  /** FFE2 listening when the answer was given. */
  ffe2?: Ffe2Status | null;
  /** "late": answered after «Terminar» (nothing was listened to; only the test's own settings compared). */
  evidence?: 'live' | 'late';
}

export interface RestoreOutcome {
  at: string;
  /** Not applied yet: waiting for the link. */
  pending: boolean;
  sent: string[];
  checks: FieldCheck[];
  ok: boolean;
  notes: string[];
}

export interface TestRecord {
  testId: string;
  status: TestStatus;
  startedAt: string | null;
  stages: StageRecord[];
  conclusions: string[];
  offers: Offer[];
  kept: Offer[];
  /** The values behind `kept` (part of the restore target). */
  keptChanges: KeptChanges;
  /** Every field this test's preparations changed (restored at the end). */
  touched: SnapshotField[];
  unreadable: UnreadableField[];
  /** The dial codes were (or may have been) changed. */
  dialChanged: boolean;
  notes: string[];
  restore: RestoreOutcome | null;
}

export interface Cursor {
  testId: string;
  /** null: the test's intro (or its decision, when the record is "deciding"). */
  stageId: string | null;
  stageStartedAt: string;
  /** The stage's preparation was applied. */
  prepared: boolean;
  /** When the answers became available (min-tap guard). */
  readyAt: string | null;
  countdownUntil: string | null;
  /** «Ya lo he hecho»: the user acted without the countdown. */
  countdownSkipped: boolean;
  sent: string[];
  /** Link drops while this stage was shown. */
  drops: number;
}

/** A field restored only if the module still has the value the test put there (answered days later). */
export interface StillValue {
  field: SnapshotField;
  value: string | null;
}

export interface RestoreRequest {
  /** Test ids (or "finish", "manual") that asked for it. */
  reasons: string[];
  fields: SnapshotField[];
  unreadable: UnreadableField[];
  dial: boolean;
  /** Restore every usage setting, not only what differs. */
  full: boolean;
  /** Send [3700] first (if nobody else uses debug). */
  debugOff: boolean;
  /** Also restore every usage setting that differs from the target. */
  sweep: boolean;
  ifStill: StillValue[];
}

export interface PendingRestore extends RestoreRequest {
  since: string;
  /** Failed attempts with the link up (automatic retries stop after MAX_AUTO_ATTEMPTS). */
  attempts: number;
  lastError: string | null;
}

export interface StatusLine {
  text: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  at: string;
}

export type CarTestsPhase = 'idle' | 'starting' | 'active' | 'finishing' | 'finished';

export interface CarTestsState {
  version: 1;
  phase: CarTestsPhase;
  /** Recorded with the demo module (kept apart from the real one). */
  demo: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  device: { name: string | null } | null;
  /** The backup taken at the start ("Antes de las pruebas"). */
  snapshot: Snapshot | null;
  snapshotMissing: string[];
  /** What restores aim for: the snapshot, plus what the user chose to keep. */
  target: SnapshotValues | null;
  records: Record<string, TestRecord>;
  cursor: Cursor | null;
  /** A deferred test left waiting for its answer. */
  waiting: { testId: string; stageId: string } | null;
  pendingRestore: PendingRestore | null;
  /** Unreadable values changed and not yet set back. */
  unreadableDirty: UnreadableField[];
  /** Unreadable values the module had when this session started, as far as the app knows (kept in an earlier session). */
  knownUnreadable?: Partial<Record<UnreadableField, number>>;
  busy: string | null;
  status: StatusLine | null;
  sound: boolean;
  /** Loaded from storage after a reload. */
  restored?: boolean;
}

export const MAX_AUTO_ATTEMPTS = 3;
/** Taps sooner than this after the buttons appear are ignored (a double tap on the previous screen). */
export const DEFAULT_MIN_TAP_MS = 700;

export function emptyRecord(testId: string): TestRecord {
  return {
    testId,
    status: 'pending',
    startedAt: null,
    stages: [],
    conclusions: [],
    offers: [],
    kept: [],
    keptChanges: {},
    touched: [],
    unreadable: [],
    dialChanged: false,
    notes: [],
    restore: null,
  };
}

export function initialCarTestsState(demo: boolean): CarTestsState {
  return {
    version: 1,
    phase: 'idle',
    demo,
    startedAt: null,
    finishedAt: null,
    device: null,
    snapshot: null,
    snapshotMissing: [],
    target: null,
    records: {},
    cursor: null,
    waiting: null,
    pendingRestore: null,
    unreadableDirty: [],
    busy: null,
    status: null,
    sound: true,
  };
}

const EMPTY_REQUEST: RestoreRequest = {
  reasons: [],
  fields: [],
  unreadable: [],
  dial: false,
  full: false,
  debugOff: false,
  sweep: false,
  ifStill: [],
};

function mergePending(a: PendingRestore | null, b: RestoreRequest): PendingRestore {
  if (!a) return { ...b, since: new Date().toISOString(), attempts: 0, lastError: null };
  return {
    reasons: union(a.reasons, b.reasons),
    fields: union(a.fields, b.fields),
    unreadable: union(a.unreadable, b.unreadable),
    dial: a.dial || b.dial,
    full: a.full || b.full,
    debugOff: a.debugOff || b.debugOff,
    sweep: a.sweep || b.sweep,
    ifStill: [...a.ifStill.filter((x) => !b.ifStill.some((y) => y.field === x.field)), ...b.ifStill],
    since: a.since,
    attempts: a.attempts,
    lastError: a.lastError,
  };
}

function newCursor(testId: string, stageId: string | null, prepared: boolean): Cursor {
  const at = nowIso();
  return {
    testId,
    stageId,
    stageStartedAt: at,
    prepared,
    readyAt: prepared || stageId === null ? at : null,
    countdownUntil: null,
    countdownSkipped: false,
    sent: [],
    drops: 0,
  };
}

/** The countdown of a stage ran out (or the user said they had already acted). */
export function countdownDone(cursor: Cursor, stage: Stage, now = Date.now()): boolean {
  if (!stage.countdownSec || cursor.countdownSkipped) return true;
  return cursor.countdownUntil !== null && now >= Date.parse(cursor.countdownUntil);
}

// ---------------------------------------------------------------------------
// Persistence helpers

const MAX_STORED_ENTRIES = 30;

function charLabel(char: string | undefined): string | undefined {
  if (!char) return undefined;
  const m = /^0000(ff[0-9a-f]{2})-/i.exec(char);
  return m ? m[1].toUpperCase() : char;
}

/** Keeps a notification small for the report and localStorage. */
function slimEntry(entry: LogEntry): LogEntry {
  const out: LogEntry = { id: entry.id, t: entry.t, kind: entry.kind };
  const char = charLabel(entry.char);
  if (char) out.char = char;
  if (entry.text !== undefined) out.text = entry.text;
  else if (entry.hex !== undefined) out.hex = entry.hex;
  if (entry.meanings?.length) out.meanings = entry.meanings;
  return out;
}

export function compactCarTests(state: CarTestsState): CarTestsState {
  const records: Record<string, TestRecord> = {};
  for (const [id, record] of Object.entries(state.records)) {
    records[id] = {
      ...record,
      stages: record.stages.map((s) => ({ ...s, unsolicited: s.unsolicited.slice(0, MAX_STORED_ENTRIES) })),
    };
  }
  return { ...state, records, busy: null };
}

/** Last resort when storage is full: only what a reload needs to restore safely (the evidence is dropped). */
export function minimalCarTests(state: CarTestsState): CarTestsState {
  const records: Record<string, TestRecord> = {};
  for (const [id, record] of Object.entries(state.records)) records[id] = { ...record, stages: [], notes: [] };
  const snapshot = state.snapshot ? { ...state.snapshot, frames: {} } : null;
  return { ...state, snapshot, records, busy: null, status: null };
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const PHASES: readonly CarTestsPhase[] = ['idle', 'starting', 'active', 'finishing', 'finished'];

/** Accepts a stored session if it can be rendered; null otherwise. */
function normalizeSaved(saved: unknown, demo: boolean, tests: readonly CarTest[]): CarTestsState | null {
  if (!isRecord(saved) || saved.version !== 1 || saved.demo !== demo) return null;
  const s = saved as unknown as CarTestsState;
  if (!PHASES.includes(s.phase) || !isRecord(s.records)) return null;
  if (s.phase !== 'idle' && (!isRecord(s.snapshot) || !isRecord(s.target))) return null;
  const records: Record<string, TestRecord> = {};
  for (const test of tests) {
    const r = s.records[test.id] as TestRecord | undefined;
    if (r && isRecord(r) && Array.isArray(r.stages)) records[test.id] = { ...emptyRecord(test.id), ...r };
    // A test added after this session was saved was not part of it.
    else if (s.phase !== 'idle') records[test.id] = { ...emptyRecord(test.id), status: 'notOffered', notes: ['No existía en esta sesión.'] };
    else records[test.id] = emptyRecord(test.id);
  }
  // A reload cannot resume an operation half-way: a session being started is
  // dropped (nothing was changed yet; an owed [2100] is sent by the factory
  // guard), one being finished counts as finished (its restore was recorded
  // as pending before anything else).
  const phase: CarTestsPhase = s.phase === 'starting' ? 'idle' : s.phase === 'finishing' ? 'finished' : s.phase;
  const savedCursor = s.cursor && isRecord(s.cursor) && tests.some((t) => t.id === s.cursor?.testId) ? s.cursor : null;
  // Fields added later get their defaults (a session saved by an older version).
  const cursor: Cursor | null = savedCursor ? { ...{ countdownSkipped: false, drops: 0 }, ...(savedCursor as Partial<Cursor>) } as Cursor : null;
  const pending = s.pendingRestore && isRecord(s.pendingRestore) ? (s.pendingRestore as Partial<PendingRestore>) : null;
  return {
    ...initialCarTestsState(demo),
    ...s,
    phase,
    records,
    cursor: phase === 'idle' ? null : cursor,
    snapshot: phase === 'idle' && s.phase === 'starting' ? null : s.snapshot,
    // Restores recorded by an older version always swept every difference.
    pendingRestore: pending ? ({ ...EMPTY_REQUEST, sweep: true, attempts: 0, lastError: null, since: nowIso(), ...pending } as PendingRestore) : null,
    unreadableDirty: Array.isArray(s.unreadableDirty) ? s.unreadableDirty : [],
    busy: null,
    restored: true,
  };
}

// ---------------------------------------------------------------------------
// Runner

export interface CarTestsDeps {
  controller: AppController;
  /** Where the mandatory backup is saved. */
  backups?: BackupStore | null;
  persist?: { load(): unknown; save(state: CarTestsState): void };
  tests?: readonly CarTest[];
  /** Pause between commands (default: the driver's, 150 ms). */
  pacingMs?: number;
  /** Wait for frames. */
  timeoutMs?: number;
  /** Silence before each state request. */
  quietMs?: number;
  /** Taps sooner than this after the buttons appear are ignored (double taps). */
  minTapMs?: number;
}

export const FFE2_OWNER = 'carTests';
export const DEBUG_OWNER = 'carTests';
const LOCK_OWNER = 'Pruebas del coche';
const nowIso = () => new Date().toISOString();

const OFFLINE_PENDING = 'Sin conexión: hay ajustes por restaurar. Cuando vuelvas al coche, pulsa «Conectar» arriba: se restaurarán solos al conectar.';

function errorText(error: unknown): string {
  if (error instanceof DialGuardError || error instanceof UnsafeCommandError || error instanceof BackupError) return error.message;
  if (error instanceof Error && error.name === 'Error' && error.message) return error.message;
  return bleErrorMessage(error, 'operation');
}

export class CarTestsRunner {
  readonly state: Store<CarTestsState>;
  readonly tests: readonly CarTest[];
  private readonly c: AppController;
  private chain: Promise<void> = Promise.resolve();
  /** Bumped by start/reset so an operation still in flight cannot write over them. */
  private run = 0;
  private buffer: LogEntry[] = [];
  private lastSeenId = 0;
  private unwatchLog: (() => void) | null = null;
  private readonly offSession: () => void;
  private disposed = false;
  /** Pages showing the tests (attach()). */
  private attached = 0;
  /** Debug, FFE2 and the log window are running for the active session (false after a reload until the page opens). */
  private resumed = true;

  constructor(private readonly deps: CarTestsDeps) {
    this.c = deps.controller;
    this.tests = deps.tests ?? CAR_TESTS;
    this.state = createStore(initialCarTestsState(this.c.demo));
    this.restoreSaved();
    if (deps.persist) this.state.subscribe(() => deps.persist?.save(compactCarTests(this.state.get())));
    let previous = this.c.session.status;
    this.offSession = this.c.session.state.subscribe(() => {
      const status = this.c.session.status;
      if (status === 'ready' && previous !== 'ready') this.onReady();
      if (previous === 'ready' && status !== 'ready') this.onDrop();
      previous = status;
    });
    if (this.isReady()) this.onReady();
  }

  /** Stops reacting to the link and the log (the controller was replaced). */
  dispose(): void {
    this.disposed = true;
    this.offSession();
    this.stopWatching();
  }

  // -------------------------------------------------------------------------
  // Helpers

  private restoreSaved(): void {
    let saved: unknown = null;
    try {
      saved = this.deps.persist?.load();
    } catch {
      saved = null;
    }
    const state = normalizeSaved(saved, this.c.demo, this.tests);
    if (!state) return;
    this.state.set(state);
    // Resumed (debug, FFE2) only when the user opens the tests page again.
    if (state.phase === 'active') this.resumed = false;
  }

  private isReady(): boolean {
    return this.c.session.status === 'ready';
  }

  private pacing(): number {
    return this.deps.pacingMs ?? this.c.driver.pacingMs;
  }

  private timeouts(): { timeoutMs: number; quietMs: number } {
    return { timeoutMs: this.deps.timeoutMs ?? 3000, quietMs: this.deps.quietMs ?? 250 };
  }

  private patch(partial: Partial<CarTestsState>): void {
    this.state.update((s) => ({ ...s, ...partial }));
  }

  private setStatus(text: string, kind: StatusLine['kind'] = 'info', toast = false): void {
    this.patch({ status: { text, kind, at: nowIso() } });
    if (toast) this.c.toast(text, kind);
  }

  private updateRecord(testId: string, fn: (r: TestRecord) => TestRecord): void {
    this.state.update((s) => ({ ...s, records: { ...s.records, [testId]: fn(s.records[testId] ?? emptyRecord(testId)) } }));
  }

  test(id: string): CarTest | undefined {
    return this.tests.find((t) => t.id === id);
  }

  /** The tests page is showing (and the session was resumed). */
  get isAttended(): boolean {
    return this.attached > 0;
  }

  /**
   * Serializes every operation; errors end up in the status line (and a
   * toast). Operations hold the module lock, so a backup or restore from
   * another page never interleaves with them.
   */
  private enqueue(busy: string | null, fn: () => Promise<void>, options: { lock?: boolean } = {}): Promise<void> {
    const next = this.chain.then(async () => {
      if (this.disposed) return;
      if (busy) this.patch({ busy });
      const release = options.lock === false ? null : await acquireLock(this.c, 'module', LOCK_OWNER);
      try {
        await fn();
      } catch (error) {
        this.setStatus(errorText(error), 'error', true);
      } finally {
        release?.();
        if (busy) this.patch({ busy: null });
      }
    });
    this.chain = next;
    return next;
  }

  private async busyWhile(text: string, fn: () => Promise<unknown>): Promise<void> {
    this.patch({ busy: text });
    try {
      await fn();
    } finally {
      this.patch({ busy: null });
    }
  }

  private tooSoon(cursor: Cursor): boolean {
    const min = this.deps.minTapMs ?? DEFAULT_MIN_TAP_MS;
    const since = cursor.readyAt ?? cursor.stageStartedAt;
    return min > 0 && Date.now() - Date.parse(since) < min;
  }

  // Log window of the current stage (the shared log is capped and can be cleared).

  private watchLog(): void {
    this.unwatchLog?.();
    const list = this.c.log.get();
    this.lastSeenId = list.length ? list[list.length - 1].id : 0;
    this.buffer = [];
    this.unwatchLog = this.c.log.subscribe(() => this.collect());
  }

  private collect(): void {
    const list = this.c.log.get();
    let first = list.length;
    while (first > 0 && list[first - 1].id > this.lastSeenId) first--;
    for (let i = first; i < list.length; i++) this.buffer.push(list[i]);
    if (first < list.length) this.lastSeenId = list[list.length - 1].id;
    if (this.buffer.length > 2000) this.buffer.splice(0, this.buffer.length - 2000);
  }

  private resetBuffer(): void {
    this.collect();
    this.buffer = [];
  }

  private stopWatching(): void {
    this.unwatchLog?.();
    this.unwatchLog = null;
    this.buffer = [];
  }

  /** Fields, unreadable values and dial held by a test still in progress (restored when it ends). */
  private held(): { fields: Set<SnapshotField>; unreadable: Set<UnreadableField>; dial: boolean } {
    const out = { fields: new Set<SnapshotField>(), unreadable: new Set<UnreadableField>(), dial: false };
    for (const r of Object.values(this.state.get().records)) {
      if (r.status !== 'running' && r.status !== 'deciding' && r.status !== 'waiting') continue;
      r.touched.forEach((f) => out.fields.add(f));
      r.unreadable.forEach((u) => out.unreadable.add(u));
      if (r.dialChanged) out.dial = true;
    }
    return out;
  }

  private onDrop(): void {
    const s = this.state.get();
    if (s.phase === 'active' && s.cursor?.stageId) this.patch({ cursor: { ...s.cursor, drops: (s.cursor.drops ?? 0) + 1 } });
  }

  private onReady(): void {
    // Order matters: debug, then any pending restore, then a preparation interrupted by the drop.
    this.enqueue(null, async () => {
      if (!this.isReady()) return;
      if (this.state.get().phase === 'active' && this.resumed) await this.c.startDebugFor(DEBUG_OWNER).catch(() => undefined);

      const pending = this.state.get().pendingRestore;
      if (pending && this.isReady()) {
        if (pending.attempts >= MAX_AUTO_ATTEMPTS) {
          this.setStatus('Los ajustes pendientes no se pudieron restaurar varias veces: pulsa «Restaurar ahora» o descártalos.', 'warning');
        } else {
          await this.busyWhile('Restaurando ajustes pendientes…', () => this.applyRestore(EMPTY_REQUEST));
        }
      }

      // Only while the tests page is open, and never the installation change.
      const s = this.state.get();
      const cursor = s.cursor;
      if (s.phase !== 'active' || !this.resumed || this.attached === 0 || !cursor?.stageId || cursor.prepared || !this.isReady()) return;
      const test = this.test(cursor.testId);
      const stage = test?.stages.find((st) => st.id === cursor.stageId);
      if (!test || !stage || s.records[test.id]?.status !== 'running') return;
      if (stage.prepare?.some((a) => a.kind === 'dialFeature8')) return;
      await this.busyWhile('Preparando la prueba…', () => this.prepareStage(test, stage));
    });
  }

  /**
   * The tests page is open. After a reload this is when an active session
   * resumes (log window, FFE2, debug). Returns the function to call when the
   * page closes.
   */
  attach(): () => void {
    this.attached++;
    const s = this.state.get();
    if (s.phase === 'active' && !this.resumed) {
      this.resumed = true;
      this.watchLog();
      this.c.addMarker('Pruebas del coche: sesión retomada');
      void this.c.session.startSecondaryNotifications(FFE2_OWNER);
      this.enqueue(
        null,
        async () => {
          if (this.isReady() && this.state.get().phase === 'active') await this.c.startDebugFor(DEBUG_OWNER).catch(() => undefined);
        },
        { lock: false },
      );
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.attached--;
    };
  }

  // -------------------------------------------------------------------------
  // Session

  setSound(sound: boolean): void {
    this.patch({ sound });
  }

  /** Mandatory backup (installation included), debug [3702] and FFE2 on, first test. */
  start(): Promise<void> {
    return this.enqueue(
      'Guardando la copia de seguridad…',
      async () => {
        const s = this.state.get();
        if (s.phase !== 'idle' && s.phase !== 'finished') return;
        if (s.waiting) {
          this.setStatus('Hay una prueba esperando respuesta: contéstala o descártala antes de empezar otra sesión.', 'warning');
          return;
        }
        if (s.pendingRestore) {
          this.setStatus('Primero hay que restaurar (o descartar) los ajustes pendientes.', 'warning');
          return;
        }
        if (!this.isReady()) {
          this.setStatus('Conéctate primero al módulo.', 'warning');
          return;
        }
        const run = ++this.run;
        const startedAt = nowIso();
        this.state.set({
          ...initialCarTestsState(this.c.demo),
          sound: s.sound,
          knownUnreadable: this.unreadableValues(s),
          phase: 'starting',
          startedAt,
          device: { name: this.c.session.state.get().device?.name ?? null },
        });
        let taken: Awaited<ReturnType<typeof takeSnapshot>>;
        try {
          taken = await takeSnapshot(this.c, {
            factory: true,
            ...this.timeouts(),
            auto: true,
            owner: LOCK_OWNER,
            label: `Antes de las pruebas · ${new Date(startedAt).toLocaleString('es')}${this.c.demo ? ' · demo' : ''}`,
          });
        } catch (error) {
          if (run === this.run) this.patch({ phase: 'idle' });
          throw error;
        }
        if (run !== this.run) return;
        const essentials = missingEssentials(taken.missing);
        if (essentials.length) {
          this.patch({ phase: 'idle' });
          this.setStatus(`No se pudo leer el estado del módulo (faltan las tramas ${essentials.join(', ')}). No se ha cambiado nada.`, 'error', true);
          return;
        }
        const snapshot = this.deps.backups?.add(taken.snapshot) ?? taken.snapshot;
        this.patch({
          phase: 'active',
          snapshot,
          snapshotMissing: taken.missing,
          target: cloneValues(snapshot.values),
          records: Object.fromEntries(this.tests.map((t) => [t.id, emptyRecord(t.id)])),
        });
        this.resumed = true;
        this.watchLog();
        this.c.addMarker('Pruebas del coche: inicio');
        await this.c.startDebugFor(DEBUG_OWNER).catch(() => this.c.addMarker('Pruebas: no se pudo activar la depuración [3702]'));
        await this.c.session.startSecondaryNotifications(FFE2_OWNER);
        this.gotoNext();
        const f = snapshot.values.factory;
        this.setStatus(
          `Copia guardada: ${countKnown(snapshot.values)} ajustes` +
            (f.carBits && f.featureBits ? `, instalación ${f.carBits}/${f.featureBits}` : ', sin la instalación') +
            '.',
          'success',
          true,
        );
      },
      // takeSnapshot takes the module lock itself.
      { lock: false },
    );
  }

  private offeredNow(records: Record<string, TestRecord>, test: CarTest): boolean {
    const when = test.offeredWhen;
    if (!when) return true;
    const r = records[when.test];
    return !!r && r.status === 'done' && r.stages.some((st) => st.stageId === when.stage && when.answers.includes(st.answerId));
  }

  /** Moves the cursor to the intro of the first test still pending, or to the end. */
  private gotoNext(): void {
    const records = { ...this.state.get().records };
    let next: string | null = null;
    // Tests of an earlier round are never offered in order: shown as such from the start.
    for (const test of this.tests) {
      const r = records[test.id] ?? emptyRecord(test.id);
      if (test.archived && r.status === 'pending') records[test.id] = { ...r, status: 'notOffered', notes: union(r.notes, [test.archived]) };
    }
    for (const test of this.tests) {
      const r = records[test.id] ?? emptyRecord(test.id);
      if (r.status !== 'pending') continue;
      if (!this.offeredNow(records, test)) {
        records[test.id] = { ...r, status: 'notOffered', notes: test.offeredWhen ? union(r.notes, [test.offeredWhen.reason]) : r.notes };
        continue;
      }
      next = test.id;
      break;
    }
    this.patch({ records, cursor: next ? newCursor(next, null, false) : null });
  }

  /** Starts the test shown in the intro. */
  beginTest(options: { acknowledged?: boolean } = {}): Promise<void> {
    return this.enqueue(null, async () => {
      const s = this.state.get();
      const cursor = s.cursor;
      if (s.phase !== 'active' || !cursor || cursor.stageId !== null) return;
      const test = this.test(cursor.testId);
      if (!test || s.records[test.id]?.status !== 'pending') return;
      if (this.tooSoon(cursor)) return;
      if (test.acknowledge && !options.acknowledged) {
        this.setStatus('Marca la casilla para empezar esta prueba.', 'warning');
        return;
      }
      if (!this.isReady()) {
        this.setStatus('Conéctate primero al módulo.', 'warning');
        return;
      }
      if (test.needsFactory) {
        const f = s.snapshot?.values.factory;
        if (!f?.carBits || !f.featureBits) {
          this.updateRecord(test.id, (r) => ({
            ...r,
            status: 'aborted',
            notes: [...r.notes, 'La copia no tiene los códigos de modelo (trama 23): esta prueba no se puede hacer sin riesgo.'],
          }));
          this.gotoNext();
          return;
        }
      }
      this.updateRecord(test.id, (r) => ({ ...r, status: 'running', startedAt: nowIso() }));
      this.c.addMarker(`Prueba: ${test.title}`);
      await this.enterStage(test, test.stages[0]);
    });
  }

  private async enterStage(test: CarTest, stage: Stage): Promise<void> {
    const prepared = !stage.prepare?.length;
    this.patch({ cursor: newCursor(test.id, stage.id, prepared) });
    this.resetBuffer();
    if (!prepared) await this.prepareStage(test, stage);
  }

  private async prepareStage(test: CarTest, stage: Stage): Promise<void> {
    const s = this.state.get();
    if (!s.snapshot || !s.target) return;
    if (!this.isReady()) {
      this.setStatus('Sin conexión. Cuando vuelvas al coche, pulsa «Conectar» arriba y luego «Continuar la prueba».', 'warning');
      return;
    }
    const run = this.run;
    const plan = preparePlan(stage.prepare ?? [], s.snapshot.values);
    // Intent first: whatever happens next, these get restored.
    this.updateRecord(test.id, (r) => ({
      ...r,
      touched: union(r.touched, plan.touched),
      unreadable: union(r.unreadable, plan.unreadable),
      notes: plan.skipped.length ? union(r.notes, plan.skipped) : r.notes,
    }));
    this.patch({ unreadableDirty: union(this.state.get().unreadableDirty, plan.unreadable) });
    this.setStatus(`Preparando: ${plan.commands.map(describeCommand).join(' · ') || 'interruptor 8'}`, 'info');
    const sent: string[] = [];

    if (plan.feature8 !== null) {
      const car = s.snapshot.values.factory.carBits;
      const features = s.target.factory.featureBits ?? s.snapshot.values.factory.featureBits;
      if (!car || !features) {
        await this.abortTest(test, 'La copia no tiene los códigos de modelo (trama 23).');
        return;
      }
      const target = { carBits: car, featureBits: withFeatureSwitch(features, 8, plan.feature8) };
      // An earlier attempt of this stage («Continuar la prueba») may already have changed the dial.
      const dialBefore = this.state.get().records[test.id]?.dialChanged ?? false;
      this.updateRecord(test.id, (r) => ({ ...r, dialChanged: true }));
      let result: DialResult;
      try {
        result = await changeDialGuarded(this.c, target, { carBits: car }, this.timeouts().timeoutMs, LOCK_OWNER);
      } catch (error) {
        // A guard refusal happens before [20…] is sent: this attempt changed nothing.
        if (error instanceof DialGuardError) this.updateRecord(test.id, (r) => ({ ...r, dialChanged: dialBefore }));
        if (run !== this.run) return;
        await this.abortTest(test, errorText(error));
        return;
      }
      if (run !== this.run) return;
      if (result.command) sent.push('[2101]', result.command, '[2100]');
      if (!result.verified) {
        await this.abortTest(test, 'Los códigos de modelo leídos después del cambio no coinciden: se deja como estaba.');
        return;
      }
      this.updateRecord(test.id, (r) => ({
        ...r,
        notes: [...r.notes, `Interruptor 8: ${result.before.featureBits} → ${result.after.featureBits ?? '?'} (leído de nuevo, correcto).`],
      }));
    }

    await sendPaced(this.c, plan.commands, { pacingMs: this.pacing() });
    sent.push(...plan.commands);
    if (run !== this.run) return;
    const cursor = this.state.get().cursor;
    if (!cursor || cursor.testId !== test.id || cursor.stageId !== stage.id) return;
    this.patch({ cursor: { ...cursor, prepared: true, readyAt: nowIso(), sent } });
    this.setStatus('Listo: haz lo que dice la prueba.', 'success');
  }

  /** «Continuar la prueba»: applies the current stage's preparation (after an error, a drop or a reload). */
  retryPrepare(): Promise<void> {
    return this.enqueue('Preparando la prueba…', async () => {
      const s = this.state.get();
      const cursor = s.cursor;
      if (s.phase !== 'active' || !cursor?.stageId || cursor.prepared) return;
      const test = this.test(cursor.testId);
      const stage = test?.stages.find((st) => st.id === cursor.stageId);
      if (test && stage && s.records[test.id]?.status === 'running') await this.prepareStage(test, stage);
    });
  }

  startCountdown(): void {
    const s = this.state.get();
    const cursor = s.cursor;
    const stage = cursor?.stageId ? this.test(cursor.testId)?.stages.find((st) => st.id === cursor.stageId) : undefined;
    if (!cursor || !stage?.countdownSec) return;
    this.patch({ cursor: { ...cursor, countdownUntil: new Date(Date.now() + stage.countdownSec * 1000).toISOString() } });
  }

  /** «Ya lo he hecho»: the answers no longer wait for the countdown. */
  skipCountdown(): void {
    const cursor = this.state.get().cursor;
    if (cursor?.stageId) this.patch({ cursor: { ...cursor, countdownSkipped: true } });
  }

  /** Records the answer to the current stage (with its evidence) and moves on. */
  answer(answerId: string): Promise<void> {
    return this.enqueue(null, async () => {
      const s = this.state.get();
      const cursor = s.cursor;
      if (!cursor?.stageId || !cursor.prepared || !s.snapshot || !s.target) return;
      const waitingAnswer = s.phase === 'finished' && s.waiting?.testId === cursor.testId && s.waiting.stageId === cursor.stageId;
      if (s.phase !== 'active' && !waitingAnswer) return;
      if (this.tooSoon(cursor)) return;
      const test = this.test(cursor.testId);
      const stage = test?.stages.find((st) => st.id === cursor.stageId);
      const answer = stage?.answers.find((a) => a.id === answerId);
      if (!test || !stage || !answer) return;
      if (!countdownDone(cursor, stage)) return;
      const run = this.run;
      const answeredAt = nowIso();
      const linkDown = !this.isReady();
      const ffe2 = this.c.session.state.get().ffe2;
      this.patch({ busy: 'Comprobando el estado del módulo…' });
      let read: Awaited<ReturnType<typeof readModuleValues>> = null;
      try {
        read = await readModuleValues(this.c, this.timeouts());
      } catch {
        read = null;
      } finally {
        this.patch({ busy: null });
      }
      if (run !== this.run) return;
      const record = this.state.get().records[test.id];
      const target = this.state.get().target ?? s.target;
      const fresh = read?.values ?? null;
      // Answered after «Terminar» (maybe days later): only this test's own settings say anything.
      const compareOnly = waitingAnswer ? record.touched : undefined;
      const changes: EvidenceChange[] = fresh
        ? diffValues(target, fresh, { include: 'settings', only: compareOnly })
            .filter((c) => c.status === 'differs')
            .map((c) => ({ field: c.field, label: c.label, before: c.expected, after: c.actual, byTest: record.touched.includes(c.field) }))
        : [];
      let unsolicited: LogEntry[] = [];
      let responses = 0;
      if (!waitingAnswer) {
        this.collect();
        const buckets = classifyEntries(this.buffer);
        unsolicited = buckets.spontaneous.map(slimEntry);
        responses = buckets.response.length;
      }
      this.buffer = [];
      const stageRecord: StageRecord = {
        stageId: stage.id,
        question: stage.question,
        startedAt: cursor.stageStartedAt,
        answeredAt,
        answerId: answer.id,
        answer: answer.label,
        ...(answer.conclusion ? { conclusion: answer.conclusion } : {}),
        ...(answer.offers?.length ? { offers: [...answer.offers] } : {}),
        ...(answer.withdraws?.length ? { withdraws: [...answer.withdraws] } : {}),
        prepared: cursor.sent,
        changes,
        stateUnknown: read === null,
        stateMissing: read ? [...read.collected.missing] : [],
        unknownChanges: read && !waitingAnswer ? unknownPositionChanges(s.snapshot.frames, read.collected.frames) : [],
        unsolicited,
        responses,
        linkDrops: cursor.drops ?? 0,
        linkDown,
        ffe2,
        evidence: waitingAnswer ? 'late' : 'live',
      };
      this.updateRecord(test.id, (r) => ({ ...r, stages: [...r.stages, stageRecord] }));
      this.c.addMarker(`${test.title} · ${stage.question} → ${answer.label}`);
      const index = test.stages.indexOf(stage);
      const next =
        answer.next === 'end' ? undefined : answer.next ? test.stages.find((st) => st.id === answer.next) : test.stages[index + 1];
      if (next && !waitingAnswer) await this.enterStage(test, next);
      else await this.endTest(test);
    });
  }

  private async endTest(test: CarTest): Promise<void> {
    const record = this.state.get().records[test.id];
    const conclusions = record.stages.map((st) => st.conclusion).filter((c): c is string => !!c);
    const withdrawn = new Set(record.stages.flatMap((st) => st.withdraws ?? []));
    const offers = [...new Set(record.stages.flatMap((st) => st.offers ?? []))].filter((o) => !withdrawn.has(o));
    // Switch 8 kept on by an earlier run of this test: decide again (the default turns it off).
    if (record.keptChanges.feature8 !== undefined && record.touched.includes('factory.dial') && !offers.includes('keepFeature8')) {
      offers.unshift('keepFeature8');
    }
    // So is anything else an earlier run kept: never kept silently.
    for (const o of record.kept) {
      if (!offers.includes(o) && (FIXED_KEEPS[o] || o === 'keepNightHalfOff')) offers.push(o);
    }
    this.updateRecord(test.id, (r) => ({ ...r, conclusions: union(r.conclusions, conclusions), offers }));
    const s = this.state.get();
    const waiting = s.phase === 'finished' && s.waiting?.testId === test.id;
    if (offers.length && (s.phase === 'active' || waiting)) {
      this.updateRecord(test.id, (r) => ({ ...r, status: 'deciding' }));
      this.patch({ cursor: newCursor(test.id, null, false) });
      return;
    }
    await this.closeTest(test, 'done');
  }

  /** Final status, combined conclusions, restore, next test. */
  private async closeTest(test: CarTest, status: TestStatus, note?: string): Promise<void> {
    const wasWaiting = this.state.get().waiting?.testId === test.id;
    this.updateRecord(test.id, (r) => ({ ...r, status, notes: note ? [...r.notes, note] : r.notes }));
    if (wasWaiting) this.patch({ waiting: null, cursor: null });
    this.applyCombinedConclusions();
    await this.restoreTest(test, wasWaiting);
    if (this.state.get().phase === 'active') this.gotoNext();
  }

  private applyCombinedConclusions(): void {
    const records = this.state.get().records;
    const answered = (testId: string, stageId: string) => records[testId]?.stages.find((st) => st.stageId === stageId)?.answerId;
    for (const test of this.tests) {
      const r = records[test.id];
      if (!r || r.status !== 'done') continue;
      for (const rule of test.conclusions ?? []) {
        const met = rule.when.every((w) => {
          const a = answered(w.test, w.stage);
          return a !== undefined && w.answers.includes(a);
        });
        if (met && !r.conclusions.includes(rule.text)) this.updateRecord(test.id, (x) => ({ ...x, conclusions: [...x.conclusions, rule.text] }));
      }
    }
  }

  /** The prepare actions of the stages this test went through (in order). */
  private pathActions(test: CarTest, record: TestRecord, upTo = record.stages.length): PrepareAction[] {
    return record.stages
      .slice(0, upTo)
      .flatMap((st) => test.stages.find((x) => x.id === st.stageId)?.prepare ?? []);
  }

  /**
   * @param late the test waited for its answer after «Terminar»: only its own
   * settings are put back, and only where the module still has the value the
   * test set (anything changed since then is the user's).
   */
  private async restoreTest(test: CarTest, late = false): Promise<void> {
    const record = this.state.get().records[test.id];
    const target = this.state.get().target;
    if (late && target) {
      const left = applyActions(target, this.pathActions(test, record));
      await this.applyRestore({
        ...EMPTY_REQUEST,
        reasons: [test.id],
        ifStill: record.touched.filter((f) => !isFactoryField(f)).map((field) => ({ field, value: readField(field, left) })),
        unreadable: record.unreadable,
        dial: record.dialChanged,
      });
      return;
    }
    await this.applyRestore({
      ...EMPTY_REQUEST,
      reasons: [test.id],
      fields: record.touched.filter((f) => !isFactoryField(f)),
      unreadable: record.unreadable,
      dial: record.dialChanged,
      // Anything else that differs from the copy is put back too.
      sweep: true,
    });
  }

  private async abortTest(test: CarTest, reason: string): Promise<void> {
    this.setStatus(reason, 'error', true);
    this.updateRecord(test.id, (r) => ({ ...r, conclusions: [...r.conclusions, `No se hizo: ${reason}`] }));
    await this.closeTest(test, 'aborted', reason);
  }

  /** The changes behind the offers the user ticked, with a note for each. */
  private keptChangesFor(test: CarTest, record: TestRecord, kept: readonly Offer[]): { changes: KeptChanges; notes: string[] } {
    let changes: KeptChanges = {};
    const notes: string[] = [];
    const s = this.state.get();
    for (const offer of kept) {
      const fixed = FIXED_KEEPS[offer];
      if (!fixed) continue;
      changes = mergeKept(changes, fixed.changes);
      notes.push(fixed.note);
    }
    if (kept.includes('keepNightHalfOff')) {
      changes.nightHalf = false;
      notes.push('A petición tuya se deja desactivada la «consola a mitad de brillo de noche» ([1A00]).');
    }
    const features = s.snapshot?.values.factory.featureBits;
    if (kept.includes('keepFeature8') && features) {
      changes.feature8 = true;
      notes.push(
        `A petición tuya se deja encendido el interruptor de funciones nº 8 (${withFeatureSwitch(features, 8, true)}). ` +
          'Los avisos de puerta, intermitentes, aire y radar vuelven a como estaban: actívalos en la pestaña Coche si los quieres.',
      );
    }
    if (kept.includes('keepWelcome') || kept.includes('keepWelcomeWhite')) {
      // The welcome settings in place when the answer that offered this was given.
      const at = record.stages.findIndex((st) => st.offers?.some((o) => KEEP_WELCOME.includes(o)));
      const tried = applyActions(s.snapshot?.values ?? BUILTIN_SNAPSHOT.values, this.pathActions(test, record, at < 0 ? record.stages.length : at + 1));
      if (tried.welcomeMode !== null) {
        changes.welcomeEnabled = true;
        changes.welcomeMode = tried.welcomeMode;
        const white = kept.includes('keepWelcomeWhite') && tried.welcomeColor !== null;
        if (white) changes.welcomeColor = tried.welcomeColor as number;
        const mode = WELCOME_MODES.find((m) => m.id === tried.welcomeMode)?.name ?? String(tried.welcomeMode);
        notes.push(
          `A petición tuya se deja la bienvenida activada en el modo «${mode}» (${cmd.welcomeMode(tried.welcomeMode)})` +
            (white ? ' y en blanco.' : ', con tu color de siempre.'),
        );
      }
    }
    return { changes, notes };
  }

  /** After an answer with offers: keep the ticked changes (none by default) and restore the rest. */
  decide(keep: readonly Offer[]): Promise<void> {
    return this.enqueue('Restaurando…', async () => {
      const s = this.state.get();
      const cursor = s.cursor;
      if (!cursor || !s.snapshot) return;
      const record = s.records[cursor.testId];
      const test = this.test(cursor.testId);
      if (!test || record?.status !== 'deciding') return;
      const waitingDecision = s.phase === 'finished' && s.waiting?.testId === test.id;
      if (s.phase !== 'active' && !waitingDecision) return;
      if (this.tooSoon(cursor)) return;
      const kept = keep.filter((o) => record.offers.includes(o));
      const { changes, notes } = this.keptChangesFor(test, record, kept);
      this.updateRecord(test.id, (r) => ({ ...r, kept, keptChanges: changes, notes: [...r.notes, ...notes] }));
      const now = this.state.get();
      this.patch({ target: targetFrom(s.snapshot.values, now.records, this.tests) });
      await this.closeTest(test, 'done');
    });
  }

  /** Skips the test in the intro, or stops the one in progress (and restores it). */
  skipTest(): Promise<void> {
    return this.enqueue('Restaurando…', async () => {
      const s = this.state.get();
      const cursor = s.cursor;
      if (s.phase !== 'active' || !cursor) return;
      if (this.tooSoon(cursor)) return;
      const test = this.test(cursor.testId);
      const record = s.records[cursor.testId];
      if (!test || !record) return;
      if (record.status === 'pending') {
        this.updateRecord(test.id, (r) => ({ ...r, status: 'skipped' }));
        this.gotoNext();
      } else if (record.status === 'running' || record.status === 'deciding') {
        await this.closeTest(test, record.status === 'deciding' ? 'done' : 'skipped', record.status === 'running' ? 'Saltada a medias.' : undefined);
      }
    });
  }

  /** «Me equivoqué»: back to the previous question of this test, undoing the current stage's preparation. */
  undo(): Promise<void> {
    return this.enqueue('Deshaciendo…', async () => {
      const s = this.state.get();
      const cursor = s.cursor;
      if (s.phase !== 'active' || !cursor?.stageId || !s.target) return;
      const test = this.test(cursor.testId);
      const record = s.records[cursor.testId];
      if (!test || record?.status !== 'running' || record.stages.length === 0) return;
      const current = test.stages.find((st) => st.id === cursor.stageId);
      const last = record.stages[record.stages.length - 1];
      const back = test.stages.find((st) => st.id === last.stageId);
      if (!current || !back) return;
      if (current.prepare?.length) {
        if (!this.isReady()) {
          this.setStatus('Sin conexión: no se puede deshacer ahora.', 'warning');
          return;
        }
        // Not ready any more until the undo completes: a failure, a drop or a
        // reload in between prepares this stage again instead of showing it as ready.
        this.patch({ cursor: { ...cursor, prepared: false, readyAt: null } });
        // Put back what the current stage changed, then re-apply the stages up to the repeated one.
        const own = preparePlan(current.prepare.filter((a) => a.kind !== 'dialFeature8'));
        const path = [...record.stages.slice(0, -1).map((st) => st.stageId), back.id];
        const reapply = preparePlan(
          path.flatMap((id) => test.stages.find((st) => st.id === id)?.prepare ?? []).filter((a) => a.kind !== 'dialFeature8'),
        );
        const commands = [
          ...restoreCommands(s.target, { only: own.touched }).settings,
          ...own.unreadable
            .filter((u) => !reapply.unreadable.includes(u))
            .map((u) => unreadableRestore(u, keptUnreadable(s.records, this.tests), s.knownUnreadable).command),
          ...reapply.commands,
        ];
        await sendPaced(this.c, commands, { pacingMs: this.pacing() });
      }
      this.updateRecord(test.id, (r) => ({ ...r, stages: r.stages.slice(0, -1) }));
      this.c.addMarker(`${test.title}: deshecho, se repite «${back.question}»`);
      this.patch({ cursor: newCursor(test.id, back.id, true) });
      this.resetBuffer();
      this.setStatus('Pregunta anterior: vuelve a probarlo.', 'info');
    });
  }

  /** Runs a test again, or one that was not offered («on demand»). What you chose to keep stays until you decide again. */
  redoTest(testId: string): Promise<void> {
    return this.enqueue(null, async () => {
      const s = this.state.get();
      const record = s.records[testId];
      if (s.phase !== 'active' || !record || !this.test(testId)) return;
      if (Object.values(s.records).some((r) => r.status === 'running' || r.status === 'deciding')) return;
      if (record.status === 'running' || record.status === 'deciding' || record.status === 'waiting') return;
      // dialChanged stays: a kept switch 8 must still be put back by «Restaurar todo ahora» and «Terminar».
      this.updateRecord(testId, (r) => ({ ...emptyRecord(testId), kept: r.kept, keptChanges: r.keptChanges, dialChanged: r.dialChanged }));
      this.patch({ cursor: newCursor(testId, null, false) });
    });
  }

  /**
   * Back to the copy itself, now: stops the test in progress and also undoes
   * what you chose to keep. Offline it is recorded as pending.
   */
  restoreAll(): Promise<void> {
    return this.enqueue('Restaurando todo…', async () => {
      const s = this.state.get();
      if ((s.phase !== 'active' && s.phase !== 'finished') || !s.snapshot) return;
      const interrupted: string[] = [];
      // Before the kept changes are cleared: a kept switch 8 has to go back too,
      // and so do kept values the module never reports (e.g. «seguir las luces»).
      const dial = Object.values(s.records).some((r) => r.dialChanged || r.keptChanges.feature8 !== undefined);
      const keptUnread = Object.keys(keptUnreadable(s.records, this.tests)) as UnreadableField[];
      for (const r of Object.values(s.records)) {
        if (r.status === 'running' || r.status === 'deciding' || r.status === 'waiting') {
          interrupted.push(r.testId);
          this.updateRecord(r.testId, (x) => ({ ...x, status: 'interrupted', notes: [...x.notes, 'Interrumpida por «Restaurar todo ahora».'] }));
        }
        if (r.kept.length) {
          this.updateRecord(r.testId, (x) => ({
            ...x,
            kept: [],
            keptChanges: {},
            notes: [...x.notes, 'Lo que elegiste dejar se ha deshecho con «Restaurar todo ahora».'],
          }));
        }
      }
      this.patch({ waiting: null, target: cloneValues(s.snapshot.values) });
      await this.applyRestore({
        ...EMPTY_REQUEST,
        reasons: union(['manual'], interrupted),
        fields: [...SETTINGS_FIELDS],
        unreadable: union(this.state.get().unreadableDirty, keptUnread),
        dial,
        full: true,
        sweep: true,
      });
      if (this.state.get().phase === 'active') this.gotoNext();
      else this.patch({ cursor: null });
    });
  }

  /** [3700], FFE2 off, restore everything that differs. A deferred test already prepared stays waiting. */
  finish(): Promise<void> {
    return this.enqueue('Terminando…', async () => {
      const s = this.state.get();
      if (s.phase !== 'active') return;
      const cursor = s.cursor;
      let waiting: CarTestsState['waiting'] = null;
      if (cursor?.stageId) {
        const test = this.test(cursor.testId);
        const stage = test?.stages.find((st) => st.id === cursor.stageId);
        const record = s.records[cursor.testId];
        if (stage?.deferred && cursor.prepared && record?.status === 'running') {
          waiting = { testId: cursor.testId, stageId: cursor.stageId };
          this.updateRecord(cursor.testId, (r) => ({ ...r, status: 'waiting' }));
        }
      }
      const interrupted: string[] = [];
      // What an interrupted test changed goes back like at the end of a test (not only by the sweep).
      let interruptedFields: SnapshotField[] = [];
      for (const r of Object.values(this.state.get().records)) {
        if (r.status === 'running' || r.status === 'deciding') {
          interrupted.push(r.testId);
          interruptedFields = union(interruptedFields, r.touched.filter((f) => !isFactoryField(f)));
          this.updateRecord(r.testId, (x) => ({ ...x, status: 'interrupted', notes: [...x.notes, 'Sin terminar al pulsar «Terminar».'] }));
        }
      }
      const records = Object.values(this.state.get().records);
      // Only a dial whose restore did not complete (a verified one needs no second factory-mode visit).
      const dialOpen = records.filter((r) => r.dialChanged && r.status !== 'waiting' && !(r.restore && !r.restore.pending && r.restore.ok));
      const request: RestoreRequest = {
        ...EMPTY_REQUEST,
        // The interrupted tests get the outcome (and its notes) on their result row.
        reasons: union(['finish'], union(interrupted, dialOpen.map((r) => r.testId))),
        fields: interruptedFields,
        unreadable: this.state.get().unreadableDirty,
        dial: dialOpen.length > 0,
        debugOff: true,
        sweep: true,
      };
      // Recorded before anything is awaited: a reload from here on still restores.
      this.patch({ phase: 'finishing', waiting, pendingRestore: mergePending(this.state.get().pendingRestore, request) });
      this.stopWatching();
      this.c.addMarker('Pruebas del coche: fin');
      await this.c.session.stopSecondaryNotifications(FFE2_OWNER);
      await this.applyRestore(EMPTY_REQUEST);
      this.patch({ phase: 'finished', finishedAt: nowIso(), cursor: waiting ? this.state.get().cursor : null });
    });
  }

  /** Gives up on the waiting test and restores its settings. */
  discardWaiting(): Promise<void> {
    return this.enqueue('Restaurando…', async () => {
      const s = this.state.get();
      const test = s.waiting ? this.test(s.waiting.testId) : undefined;
      if (!test) return;
      const deciding = s.records[test.id]?.status === 'deciding';
      await this.closeTest(test, deciding ? 'done' : 'skipped', deciding ? undefined : 'Descartada sin respuesta.');
    });
  }

  /** Applies the pending restore now (the banner's button; also after automatic retries stopped). */
  restorePending(): Promise<void> {
    return this.enqueue('Restaurando ajustes pendientes…', async () => {
      if (this.state.get().pendingRestore) await this.applyRestore(EMPTY_REQUEST);
    });
  }

  /**
   * «Descartar ajustes pendientes»: forgets a restore that cannot be applied
   * (the module stays as it is). The UI asks for confirmation first.
   */
  discardPending(): Promise<void> {
    return this.enqueue(
      null,
      async () => {
        const s = this.state.get();
        const pending = s.pendingRestore;
        if (!pending) return;
        for (const reason of pending.reasons) {
          if (!s.records[reason]) continue;
          this.updateRecord(reason, (r) => ({
            ...r,
            restore: { at: nowIso(), pending: false, sent: r.restore?.sent ?? [], checks: [], ok: false, notes: ['Restauración descartada: no se comprobó.'] },
          }));
        }
        if (pending.debugOff) this.c.releaseDebug(DEBUG_OWNER);
        this.patch({ pendingRestore: null, unreadableDirty: [] });
        this.c.addMarker('Pruebas del coche: ajustes pendientes descartados');
        this.setStatus('Ajustes pendientes descartados: el módulo se queda como esté. Puedes volver a tu copia en «Copia de seguridad».', 'warning', true);
      },
      { lock: false },
    );
  }

  /** «Nueva sesión»: only when nothing is pending or waiting. */
  reset(): void {
    const s = this.state.get();
    if (s.phase !== 'idle' && s.phase !== 'finished') return;
    if (s.pendingRestore || s.waiting) return;
    this.run++;
    this.resumed = true;
    this.stopWatching();
    this.state.set({ ...initialCarTestsState(this.c.demo), sound: s.sound, knownUnreadable: this.unreadableValues(s) });
  }

  /** What the module has for each unreadable value, as far as the app knows: earlier sessions, then this one's keeps. */
  private unreadableValues(s: CarTestsState = this.state.get()): Partial<Record<UnreadableField, number>> {
    return { ...s.knownUnreadable, ...keptUnreadable(s.records, this.tests) };
  }

  // -------------------------------------------------------------------------
  // Restore

  /**
   * Restores `request` merged with any pending restore: the requested fields,
   * plus every usage setting that differs from the target when it sweeps,
   * except what a test in progress still holds. Recorded as pending before
   * anything is sent, so a drop or a reload in the middle re-applies it on the
   * next connection. Runs inside an operation (the module lock is held).
   */
  private async applyRestore(request: RestoreRequest): Promise<RestoreOutcome | null> {
    const merged = mergePending(this.state.get().pendingRestore, request);
    this.patch({ pendingRestore: merged });
    const { snapshot, target } = this.state.get();
    if (!target) {
      this.patch({ pendingRestore: null });
      return null;
    }
    const markTests = (outcome: RestoreOutcome) => {
      for (const reason of merged.reasons) {
        if (this.state.get().records[reason]) this.updateRecord(reason, (r) => ({ ...r, restore: outcome }));
      }
    };
    if (!this.isReady()) {
      markTests({ at: nowIso(), pending: true, sent: [], checks: [], ok: false, notes: [] });
      this.setStatus(OFFLINE_PENDING, 'warning', true);
      return null;
    }
    const { timeoutMs, quietMs } = this.timeouts();
    const sent: string[] = [];
    const notes: string[] = [];
    try {
      if (lockHolder(this.c, 'factory')) {
        // The Instalación page holds factory mode: nothing goes out until it closes.
        this.setStatus('Esperando a que cierres «Instalación» para restaurar…', 'info');
        await waitLockFree(this.c, 'factory');
        if (!this.isReady()) throw new Error('Se perdió la conexión.');
      }
      const held = this.held();
      this.setStatus('Restaurando…', 'info');
      if (merged.debugOff) {
        if (await this.c.stopDebugFor(DEBUG_OWNER)) sent.push(cmd.debugMode(false));
        else notes.push('La depuración sigue activa porque la usa el experimento.');
      }
      const before = await readModuleValues(this.c, { timeoutMs, quietMs });
      if (!before) throw new Error('No se pudo leer el estado del módulo.');
      const differing = merged.sweep ? changedFields(target, before.values, { include: 'settings' }) : [];
      const still: SnapshotField[] = [];
      for (const x of merged.ifStill) {
        const now = readField(x.field, before.values);
        if (now === readField(x.field, target)) continue;
        if (now === x.value) still.push(x.field);
        else notes.push(`${fieldLabel(x.field)}: se cambió después de la prueba (ahora ${formatField(x.field, before.values)}); no se toca.`);
      }
      let fields = union(merged.full ? SETTINGS_FIELDS : [], union(union(merged.fields, differing), still)).filter(
        (f) => !isFactoryField(f) && !held.fields.has(f),
      );
      // The sliders change meaning with the zoning: the brightness goes again after it.
      if (fields.includes('zoning')) fields = union(fields, ['brightness.b1', 'brightness.b2', 'brightness.b3'] as SnapshotField[]).filter((f) => !held.fields.has(f));
      const commands = fields.length ? restoreCommands(target, { only: fields }).settings : [];
      const unreadable = merged.unreadable.filter((u) => !held.unreadable.has(u));
      const keptValues = keptUnreadable(this.state.get().records, this.tests);
      const known = this.state.get().knownUnreadable;
      const extra = unreadable.map((u) => unreadableRestore(u, keptValues, known).command);
      await sendPaced(this.c, [...commands, ...extra], { pacingMs: this.pacing() });
      sent.push(...commands, ...extra);
      for (const u of unreadable) notes.push(unreadableRestore(u, keptValues, known).note);
      // The usage part is done: a later failure (the dial) does not send it again.
      const remaining = this.state.get().pendingRestore;
      if (remaining) {
        this.patch({
          pendingRestore: { ...remaining, fields: [], unreadable: [], full: false, sweep: false, ifStill: [], debugOff: false },
          unreadableDirty: this.state.get().unreadableDirty.filter((u) => !unreadable.includes(u)),
        });
      }

      let dialOk = true;
      if (merged.dial && !held.dial) {
        const car = target.factory.carBits;
        const features = target.factory.featureBits;
        if (car && features) {
          try {
            const result = await changeDialGuarded(this.c, { carBits: car, featureBits: features }, { carBits: car }, timeoutMs, LOCK_OWNER);
            if (result.command) sent.push('[2101]', result.command, '[2100]');
            if (!result.verified) throw new Error('Los códigos de modelo no coinciden después de restaurarlos.');
            notes.push(
              result.changed ? `Códigos de modelo devueltos a ${car}/${features} (leídos de nuevo, correctos).` : `Códigos de modelo: ya estaban en ${car}/${features}.`,
            );
          } catch (error) {
            // The module's car code is not the copy's: retrying cannot help, and nothing was sent.
            if (!(error instanceof DialGuardError && error.reason === 'mismatch')) throw error;
            dialOk = false;
            notes.push(`Códigos de modelo sin tocar: ${error.message} Revísalos en «Instalación».`);
          }
        }
      }

      const after = fields.length ? await readModuleValues(this.c, { timeoutMs, quietMs }) : null;
      const checks = fields.length
        ? diffValues(target, after?.values ?? before.values, { only: fields, include: 'settings' }).map((c) =>
            after ? c : { ...c, status: 'unknown' as const },
          )
        : [];
      if (fields.length && !after) notes.push('No se pudo leer el estado después de restaurar.');
      // Positions nobody decodes cannot be restored: they must at least be as in the copy.
      // What the user kept on purpose is not a difference.
      const raw =
        merged.sweep && snapshot ? unknownPositionChanges(framesWithKept(snapshot.frames, keptValues), (after ?? before).collected.frames) : [];
      if (raw.length) {
        notes.push(`Posiciones desconocidas distintas de la copia (no se pueden restaurar): ${raw.map((r) => `${r.label} ${r.before} → ${r.after}`).join('; ')}.`);
      }
      const ok = dialOk && raw.length === 0 && checks.every((c) => c.status === 'match');
      const outcome: RestoreOutcome = { at: nowIso(), pending: false, sent, checks, ok, notes };
      this.patch({ pendingRestore: null });
      markTests(outcome);
      const differs = checks.filter((c) => c.status === 'differs').length;
      if (ok) this.setStatus(sent.length ? 'Ajustes restaurados y comprobados.' : 'Todo estaba ya como en la copia.', 'success', true);
      else if (!dialOk) this.setStatus('Restaurado, pero los códigos de modelo no se tocaron: revisa la nota.', 'warning', true);
      else if (raw.length) this.setStatus('Restaurado, pero hay posiciones desconocidas distintas de la copia: revisa el informe.', 'warning', true);
      else if (differs) this.setStatus(`Restaurado, pero ${differs} ajustes no coinciden al leerlos.`, 'warning', true);
      else this.setStatus('Restaurado, pero no se pudo comprobar (el módulo no respondió).', 'warning', true);
      return outcome;
    } catch (error) {
      const message = errorText(error);
      const pending = this.state.get().pendingRestore;
      // A dropped link is not the restore's fault: it does not count against the automatic retries.
      if (pending) this.patch({ pendingRestore: { ...pending, attempts: pending.attempts + (this.isReady() ? 1 : 0), lastError: message } });
      markTests({ at: nowIso(), pending: true, sent, checks: [], ok: false, notes: [...notes, message] });
      this.setStatus(`No se pudo restaurar: ${message} Queda pendiente.`, 'error', true);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Report

function clock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const STATUS_TEXT: Record<TestStatus, string> = {
  pending: 'sin hacer',
  running: 'a medias',
  deciding: 'esperando tu decisión',
  waiting: 'esperando respuesta (otro día)',
  done: 'hecha',
  skipped: 'saltada',
  interrupted: 'interrumpida',
  aborted: 'no se pudo hacer',
  notOffered: 'no ofrecida',
};

export function testStatusText(status: TestStatus): string {
  return STATUS_TEXT[status];
}

/** Differences of a snapshot with the built-in copy of the user's configuration (both sides known). */
export function differencesWithBuiltin(snapshot: Snapshot): FieldCheck[] {
  return diffValues(BUILTIN_SNAPSHOT.values, snapshot.values, { include: 'all' }).filter((c) => c.status === 'differs');
}

/** What the evidence of a stage could and could not capture, in plain words. */
export function evidenceNotes(st: StageRecord): string[] {
  const out: string[] = [];
  if (st.evidence === 'late') {
    out.push('Contestada después de «Terminar»: no se escucharon notificaciones y solo se comparan los ajustes de esta prueba.');
    return out;
  }
  const drops = st.linkDrops ?? 0;
  if (st.linkDown) out.push('Sin conexión al contestar: no se pudo escuchar al módulo.');
  else if (drops > 0) out.push(`La conexión se cortó ${drops === 1 ? '1 vez' : `${drops} veces`} durante la prueba: puede faltar algo.`);
  if (st.ffe2 && st.ffe2 !== 'on') out.push(`FFE2 no se estaba escuchando (${st.ffe2}): solo se escuchó FFE1.`);
  return out;
}

/** Plain-text report to paste in a chat. */
export function carTestsReport(state: CarTestsState, tests: readonly CarTest[] = CAR_TESTS): string {
  const firmware = state.snapshot?.firmware ?? '?';
  const lines: string[] = [
    `Pruebas del coche · Ambiente F32 · ${state.startedAt ? new Date(state.startedAt).toLocaleString('es') : ''}`,
    `Módulo: ${state.device?.name ?? '?'} · firmware ${firmware}${state.demo ? ' · MODO DEMO' : ''}`,
  ];
  if (state.snapshot) {
    const f = state.snapshot.values.factory;
    lines.push(
      `Copia antes de las pruebas: ${countKnown(state.snapshot.values)} ajustes · instalación ${f.carBits ?? '?'}/${f.featureBits ?? '?'}` +
        (state.snapshotMissing.length ? ` · faltaron: ${state.snapshotMissing.join(', ')}` : ''),
    );
    const diffs = differencesWithBuiltin(state.snapshot);
    lines.push(
      diffs.length
        ? `Diferencias con tu configuración guardada: ${diffs.map((d) => `${d.label} ${d.expected} → ${d.actual}`).join('; ')}`
        : 'Igual que tu configuración guardada (6/11/2026).',
    );
    const frames = ['4E', '1F', '26', '27', '23'].filter((code) => state.snapshot?.frames[code]).map((code) => state.snapshot?.frames[code]);
    if (frames.length) lines.push(`Tramas de la copia: ${frames.join(' ')}`);
  }
  lines.push('');
  let n = 0;
  tests.forEach((test) => {
    const r = state.records[test.id];
    // A test not offered and never run (an earlier round, or one that did not exist then) says nothing.
    if (!r || (r.status === 'notOffered' && r.stages.length === 0)) return;
    lines.push(`${++n}. ${test.title}: ${STATUS_TEXT[r.status]}`);
    for (const st of r.stages) {
      lines.push(`   ${st.question} → ${st.answer}  (${clock(st.answeredAt)})`);
      if (st.prepared.length) lines.push(`     Preparado: ${st.prepared.join(' ')}`);
      if (st.stateUnknown) lines.push('     Estado: no se pudo leer (sin conexión o sin respuesta)');
      else {
        if (st.changes.length) {
          lines.push(
            `     Cambios de estado: ${st.changes.map((c) => `${c.label} ${c.before} → ${c.after}${c.byTest ? ' (lo puso la prueba)' : ''}`).join('; ')}`,
          );
        } else lines.push(`     Cambios de estado: ninguno${st.stateMissing?.length ? ' en lo que se pudo leer' : ''}`);
        if (st.stateMissing?.length) lines.push(`     No llegaron las tramas ${st.stateMissing.join(', ')}: sus ajustes no se compararon`);
      }
      if (st.unknownChanges?.length) {
        lines.push(`     Posiciones desconocidas cambiadas: ${st.unknownChanges.map((c) => `${c.label} ${c.before} → ${c.after}`).join('; ')}`);
      }
      const notes = evidenceNotes(st);
      if (st.evidence !== 'late') {
        const channels = !st.ffe2 || st.ffe2 === 'on' ? 'FFE1 ni FFE2' : 'en FFE1';
        if (st.unsolicited.length) {
          lines.push(`     Notificaciones no pedidas: ${st.unsolicited.length}`);
          for (const e of st.unsolicited.slice(0, 10)) lines.push(`       ${e.char ?? ''} ${clock(e.t)} ${e.text ?? e.hex ?? ''}`);
        } else if (st.linkDown) lines.push('     Notificaciones no pedidas: no se pudo escuchar (sin conexión)');
        else lines.push(`     Notificaciones no pedidas: ninguna (${channels})${(st.linkDrops ?? 0) > 0 ? ' mientras hubo conexión' : ''}`);
      }
      for (const n of notes) lines.push(`     ${n}`);
    }
    for (const c of r.conclusions) lines.push(`   Conclusión: ${c}`);
    for (const n of r.notes) lines.push(`   Nota: ${n}`);
    if (r.restore) {
      const bad = r.restore.checks.filter((c) => c.status !== 'match');
      lines.push(
        r.restore.pending
          ? '   Restaurar: PENDIENTE (se aplicará al conectar)'
          : `   Restaurado: ${r.restore.sent.length ? r.restore.sent.join(' ') : 'nada que cambiar'}` +
              (bad.length
                ? ` · NO coincide: ${bad.map((c) => `${c.label} (esperado ${c.expected}, leído ${c.actual})`).join('; ')}`
                : r.restore.ok
                  ? ' · comprobado'
                  : ' · sin comprobar del todo'),
      );
      for (const n of r.restore.notes) lines.push(`   ${n}`);
    }
  });
  if (state.pendingRestore) lines.push('', 'Hay ajustes pendientes de restaurar (se aplicarán al conectar).');
  if (state.waiting) lines.push('', `Esperando respuesta: ${tests.find((t) => t.id === state.waiting?.testId)?.title ?? state.waiting.testId}`);
  return lines.join('\n');
}
