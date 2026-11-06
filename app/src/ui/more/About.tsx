import { Card } from '../controls';

export function About() {
  return (
    <Card title="Ambiente F32" icon="info" subtitle={`Versión ${__APP_VERSION__} · compilación ${__BUILD_ID__}`}>
      <div className="prose">
        <p>
          App independiente para controlar el módulo de luz ambiente ZYCELA (中雅车联) por Bluetooth, pensada para un
          BMW Serie 4 (F32). Sustituye al mini-programa de WeChat «氛围灯控制程序» y usa el mismo protocolo.
        </p>
        <p>
          El protocolo está documentado en <code>docs/protocolo-zycela.md</code> (en el repositorio del proyecto). Se
          reconstruyó a partir del mini-programa; algunos detalles están marcados como «no confirmado» y conviene
          comprobarlos en el coche.
        </p>
        <p>
          Esta app no está afiliada a ZYCELA, a WeChat ni a BMW. Úsala bajo tu responsabilidad, sobre todo la sección
          «Instalación».
        </p>
        <p>
          Funciona en Chrome o Edge de escritorio y en iPhone dentro del navegador Bluefy. La configuración se guarda
          solo en este navegador.
        </p>
      </div>
    </Card>
  );
}
