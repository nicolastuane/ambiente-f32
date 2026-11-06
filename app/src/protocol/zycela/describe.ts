/** Human-readable (Spanish) descriptions of commands and frames, for the lab log. */
import {
  CAR_EVENTS,
  DIRECTIONS,
  FLASH_RESULT,
  KEY_FUNCTIONS,
  KEY_LEARN_RESULT,
  LED_STRIPS,
  POWER_MODES,
  SETTING_RESULT,
  SOUND_SOURCES,
  WELCOME_MODES,
  WIRING,
  effectName,
  paletteColor,
  rgbModeName,
} from './catalog';
import type { Option } from './catalog';
import { CAR_EVENT_CODES } from './commands';
import type { Slot } from './commands';
import type { ParsedFrame } from './parser';

const v = (n: number | undefined | null): string => (n === undefined || n === null ? '?' : String(n));
const onOff = (n: number | undefined): string => (n === undefined ? '?' : n === 1 ? 'sí' : n === 0 ? 'no' : n === 255 ? 'no admitido' : String(n));
const optName = (list: readonly Option[], id: number | undefined): string =>
  id === undefined ? '?' : (list.find((o) => o.id === id)?.name ?? String(id));

function slotsText(slots: Slot[] | undefined): string {
  if (!slots) return '?';
  return slots.map((s) => (s === null ? '–' : s.toString(16))).join('');
}

export function describeFrame(frame: ParsedFrame): string {
  switch (frame.kind) {
    case 'state':
      return (
        `Estado ${frame.code}: RGB ${rgbModeName(frame.rgbMode) ?? v(frame.rgbMode)} (vel. ${v(frame.rgbSpeed)}), ` +
        `efecto ${effectName(frame.effect, frame.code) ?? v(frame.effect)} (vel. ${v(frame.effectSpeed)}, ` +
        `${optName(DIRECTIONS, frame.effectDirection).toLowerCase()}), color ${frame.color ?? '?'}, ` +
        `brillo ${v(frame.brightness1)}/${v(frame.brightness2)}/${v(frame.brightness3)}, sonido ${v(frame.soundSensitivity)}` +
        (frame.extended ? `, control ${frame.controlMethod === 1 ? 'solo móvil' : frame.controlMethod === 0 ? 'coche + móvil' : '?'}` : '')
      );
    case 'settings':
      return (
        `Ajustes: bienvenida ${onOff(frame.welcomeEnabled)} (${optName(WELCOME_MODES, frame.welcomeMode)}, ` +
        `${frame.welcomeSync ? 'sincronizada con RGB' : `color ${paletteColor(frame.welcomeColor)?.name ?? v(frame.welcomeColor)}`}` +
        `${frame.welcomeSyncAvailable === false ? ', sin opción de sincronizar' : ''}), ` +
        `puerta ${onOff(frame.door)}, radar ${onOff(frame.radar)}, velocidad ${onOff(frame.speed)}, ` +
        `intermitentes ${onOff(frame.turn)}, aire ${onOff(frame.ac)}, ángulo muerto ${onOff(frame.blindSpot)}, ` +
        `mitad de noche ${onOff(frame.nightHalf)}, zonas ${frame.zoning === 1 ? 'delante/detrás' : frame.zoning === 0 ? 'arriba/abajo' : '?'}, ` +
        `sonido ${optName(SOUND_SOURCES, frame.soundSource).toLowerCase()}`
      );
    case 'sequences':
      return (
        `Secuencias: RGB ${slotsText(frame.rgbSequence)} (${onOff(frame.rgbCustomEnabled)}), ` +
        `efectos ${slotsText(frame.effectSequence)} (${onOff(frame.effectCustomEnabled)}), ` +
        `longitud ${v(frame.effectCustomLength)}, separación ${v(frame.effectCustomGap)}, vel. RGB ${v(frame.rgbSpeed)}`
      );
    case 'version':
      return frame.text === undefined
        ? 'Versión (no se pudo decodificar)'
        : `Versión: hardware ${frame.hardware}, coche ${frame.carModel}, firmware ${frame.firmware}`;
    case 'settingResult':
      return `Resultado: ${SETTING_RESULT[frame.result ?? -1] ?? v(frame.result)}`;
    case 'keyLearnResult':
      return `Aprendizaje: ${KEY_LEARN_RESULT[frame.result ?? -1] ?? v(frame.result)}`;
    case 'flashResult':
      return `Menú original: ${FLASH_RESULT[frame.result ?? -1] ?? v(frame.result)}`;
    case 'dialCodes':
      return `Códigos: coche ${frame.carBits ?? '?'}, funciones ${frame.featureBits ?? '?'}`;
    case 'factoryParams':
      return `Parámetros: tira ${v(frame.stripParam)}, código de cliente ${v(frame.customerCode)}`;
    case 'strips':
      return (
        `Tiras${frame.thirdRow ? ' (con tercera fila)' : ''}: LEDs ${v(frame.leds.driver)}/${v(frame.leds.passenger)}/` +
        `${v(frame.leds.frontDoors)}/${v(frame.leds.rearDoors)}` +
        (frame.thirdRow ? `/${v(frame.leds.thirdRow)}` : '')
      );
    default:
      return frame.code ? `Trama desconocida ${frame.code}` : 'Texto sin formato de trama';
  }
}

const EVENT_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  CAR_EVENTS.map((e) => [CAR_EVENT_CODES[e.key], e.name]),
);
const LED_NAME_BY_CODE: Record<string, string> = Object.fromEntries(LED_STRIPS.map((s) => [s.code, s.name]));
const WIRING_BY_CODE: Record<string, (typeof WIRING)[number]> = Object.fromEntries(WIRING.map((w) => [w.code, w]));

/** Spanish meaning of a command string, e.g. "[0701]" -> "Encendido: Encendido". */
export function describeCommand(cmd: string): string {
  const m = /^\[([0-9A-Fa-f]{2})([^\]]*)\]$/.exec(cmd);
  if (!m) return 'Texto libre';
  const code = m[1].toUpperCase();
  const data = m[2];
  const h = /^[0-9a-fA-F]{2}$/.test(data) ? parseInt(data, 16) : undefined;
  const sub = /^[0-9a-fA-F]{4}$/.test(data) ? parseInt(data.substr(2, 2), 16) : undefined;
  const yes = (n: number | undefined) => (n === 1 ? 'activar' : n === 0 ? 'desactivar' : v(n));

  if (EVENT_NAME_BY_CODE[code]) return `Aviso ${EVENT_NAME_BY_CODE[code].toLowerCase()}: ${yes(h)}`;
  if (LED_NAME_BY_CODE[code] && /^[0-9]{4}$/.test(data)) return `${LED_NAME_BY_CODE[code]}: ${parseInt(data, 10)}`;
  if (WIRING_BY_CODE[code] && h !== undefined) {
    const w = WIRING_BY_CODE[code];
    return `${w.name}: ${optName(w.options, h)}`;
  }

  switch (code) {
    case '0A':
      return 'Pedir estado';
    case '42':
      return 'Restaurar ajustes de fábrica';
    case '21':
      return h === 1 ? 'Entrar en modo fábrica' : 'Salir del modo fábrica';
    case '37':
      return h === 2 ? 'Iniciar depuración' : 'Parar depuración';
    case '41':
      return 'Activar el menú de ambiente original (peligroso)';
    case '07':
      return `Encendido: ${optName(POWER_MODES, h)}`;
    case '51':
      return `Control: ${h === 1 ? 'solo móvil' : 'coche + móvil'}`;
    case '02':
      return `Brillo deslizador 1: ${v(sub)}`;
    case '01':
      return `Brillo deslizador ${data.startsWith('02') ? 3 : 2}: ${v(sub)}`;
    case '14':
      return `Zonas de brillo: ${h === 1 ? 'delante/detrás' : 'arriba/abajo'}`;
    case '1A':
      return `Consola a mitad de noche: ${yes(h)}`;
    case '06':
      return `Color todo el coche #${data.toLowerCase()}`;
    case '10':
      return `Color zona 1 #${data.toLowerCase()}`;
    case '09':
      return `Color zona 2 #${data.toLowerCase()}`;
    case '04':
      return `Modo RGB: ${rgbModeName(h) ?? v(h)}`;
    case '3E':
      return `Velocidad RGB: ${v(h)}`;
    case '2B':
      return `Secuencia RGB personalizada: ${yes(h)}`;
    case '2A':
      return `Secuencia RGB: ${data}`;
    case '1E':
      return `Efecto: ${effectName(h, '4E') ?? v(h)}`;
    case '29':
      return `Variante del efecto: ${v(h)}`;
    case '0B':
      return `Velocidad del efecto: ${v(h)}`;
    case '0C':
      return `Dirección: ${optName(DIRECTIONS, h).toLowerCase()}`;
    case '3B':
      return `Secuencia de efectos personalizada: ${yes(h)}`;
    case '3A':
      return `Secuencia de efectos: ${data}`;
    case '3C':
      return `Longitud del segmento: ${v(h)}`;
    case '3D':
      return `Separación del segmento: ${v(h)}`;
    case '03':
      return `Sensibilidad al sonido: ${v(sub)}`;
    case '1B':
      return `Fuente de sonido: ${optName(SOUND_SOURCES, h).toLowerCase()}`;
    case '30':
      return `Bienvenida: ${yes(h)}`;
    case '39':
      return `Modo de bienvenida: ${optName(WELCOME_MODES, h)}`;
    case '38':
      return h === 15 ? 'Color de bienvenida: sincronizar con RGB' : `Color de bienvenida: ${paletteColor(h)?.name ?? v(h)}`;
    case '46':
      return `Color de puerta: ${v(h)}`;
    case '45':
      return `Color de intermitente: ${v(h)}`;
    case '47':
      return `Color de ángulo muerto: ${v(h)}`;
    case '20':
      return `Códigos de modelo: coche ${data.slice(0, 8)}, funciones ${data.slice(8)}`;
    case '43':
      return `Código de cliente: ${data}`;
    case '22':
      return `Aprender botón: ${optName(KEY_FUNCTIONS, h)}`;
    default:
      return `Comando ${code}`;
  }
}
