# Ambiente F32

App web (PWA) para controlar por Bluetooth el módulo de luz ambiente **ZYCELA / 中雅车联** («caja de control principal» que se anuncia como `ZYCL-FWD…`). Sustituye al mini-programa de WeChat «氛围灯控制程序» y habla exactamente el mismo protocolo, documentado en [`../docs/protocolo-zycela.md`](../docs/protocolo-zycela.md).

Pensada para usarla en el coche, de noche: tema oscuro, botones grandes, una mano.

- En el **iPhone** funciona dentro del navegador gratuito **Bluefy** (Safari y Chrome para iOS no tienen Bluetooth web).
- En el **ordenador** funciona en Chrome o Edge (Windows, macOS, Linux, Android).
- Tiene un **modo demo** que simula el módulo, para probarla sin el coche.

## Funciones

| Pestaña | Qué hace |
|---|---|
| **Color** | Conectar/desconectar · Encendido / Apagado / Seguir luces del coche · zona (Todo, Zona 1, Zona 2) · rueda de color táctil con envío en vivo (como máximo un envío cada 120 ms, siempre llega el último color) · los 15 colores del módulo · favoritos · los 21 modos RGB agrupados · velocidad 1–10 · secuencia personalizada de 8 casillas |
| **Efectos** | Efectos dinámicos de las tiras de efectos (lista básica o ampliada según el firmware 1F/4E) · variante 1–6 · velocidad 1–5 · dirección · secuencia personalizada, longitud y separación |
| **Brillo** | Tres deslizadores 0–9 (sus nombres cambian según el tipo de zonas) · tipo de zonas · consola a mitad de brillo de noche · control «Coche + móvil» / «Solo móvil» |
| **Coche** | Bienvenida (sí/no, 6 animaciones, color o «Sincronizar con RGB») · avisos (puerta, radar, velocidad, intermitentes, aire acondicionado, ángulo muerto; si el coche no lo admite aparece desactivado) · colores de puerta, intermitente y ángulo muerto · música (sensibilidad y fuente) · aprendizaje de botones del volante |
| **Más** | Escenas (guardar, aplicar, renombrar, ordenar, borrar, exportar/importar JSON; incluye 4 de ejemplo como «Naranja BMW») · información del módulo · Instalación (modo fábrica) · restaurar ajustes de fábrica · Laboratorio (consola y registro) · ajustes de la app · acerca de |

Todos los controles muestran el último estado que ha enviado el módulo. Al tocar algo, la app lo marca al momento y lo corrige si después el módulo informa de otra cosa. Algunos valores no los devuelve nunca el módulo (encendido, variante del efecto, colores de aviso): en esos casos se marca el último que has elegido.

### Botones del volante

Puedes asignar un botón del volante (o de la radio) a una de estas 5 funciones: despertar, modo principal de efectos, submodo de efectos, modo/color + y modo/color −. **El botón no guarda un color concreto**: ejecuta la función (por ejemplo, «Modo / color +» pasa al siguiente color). Pulsa «Aprender», y cuando la app diga «Pulsa ahora el botón del volante» tienes 20 segundos para pulsarlo.

## Puesta en marcha (ordenador)

Necesitas Node.js 20.19 o superior (probado con Node 24).

```bash
cd app
npm install
npm run dev
```

Abre `http://localhost:5173` en Chrome o Edge. `localhost` cuenta como página segura, así que el Bluetooth funciona sin certificado (el ordenador tiene que estar cerca del coche).

**Modo demo:** si el navegador no tiene Bluetooth, la app ofrece «Probar modo demo». También puedes activarlo en *Más › Ajustes de la app*. Simula un módulo `ZYCL-FWD-DEMO` con firmware 4E, responde a todos los comandos y tiene el aviso del aire acondicionado como «no admitido» para ver ese caso.

Otros comandos:

```bash
npm run typecheck   # comprobación de tipos (tsc --noEmit)
npm test            # pruebas (vitest)
npm run build       # versión final en app/dist
npm run preview     # sirve app/dist en local
```

## Usarla en el iPhone con Bluefy

El Bluetooth web exige **HTTPS**, así que la app tiene que estar publicada en una dirección `https://`. Todas estas opciones son gratuitas:

### Opción A: GitHub Pages (recomendada)

1. Crea un repositorio en GitHub (puede ser público) y sube el proyecto.
2. En el repositorio: *Settings › Pages › Build and deployment › Source: GitHub Actions*.
3. Crea el archivo `.github/workflows/pages.yml` en la raíz del repositorio con este contenido (si `app/` es la raíz del repositorio, quita `app/` y `working-directory`):

   ```yaml
   name: Publicar en GitHub Pages
   on:
     push:
       branches: [main]
   permissions:
     contents: read
     pages: write
     id-token: write
   jobs:
     build:
       runs-on: ubuntu-latest
       defaults:
         run:
           working-directory: app
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
         - run: npm ci
         - run: npm test
         - run: npm run build
         - uses: actions/upload-pages-artifact@v3
           with:
             path: app/dist
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

4. Haz `git push`. En un par de minutos la app estará en `https://TU-USUARIO.github.io/TU-REPOSITORIO/`. Funciona en una subcarpeta porque la app usa rutas relativas (`base: './'`).

### Opción B: Netlify

Ejecuta `npm run build` y arrastra la carpeta `app/dist` a [app.netlify.com/drop](https://app.netlify.com/drop). Te da una dirección `https://….netlify.app`. Para actualizar, vuelve a arrastrar la carpeta (o conecta el repositorio con comando `npm run build` y carpeta `dist`).

### Opción C: Cloudflare

Crea un proyecto de Cloudflare Pages (o Workers con archivos estáticos) conectado al repositorio, con comando de compilación `npm run build`, directorio raíz `app` y carpeta de salida `dist`.

### En el iPhone

1. Instala **Bluefy – Web BLE Browser** desde la App Store (gratis).
2. Abre Bluefy y escribe la dirección `https://…` de tu app.
3. Guárdala en los **favoritos de Bluefy** y, si quieres, activa su modo de pantalla completa en los ajustes de Bluefy.
4. **No uses «Añadir a pantalla de inicio»**: ese icono abre la app fuera de Bluefy y entonces no hay Bluetooth.

### Probar en el iPhone mientras desarrollas

La forma más rápida es un túnel temporal de Cloudflare (no necesita cuenta): instala `cloudflared` (por ejemplo con `winget install Cloudflare.cloudflared`), deja `npm run dev` en marcha y ejecuta:

```bash
cloudflared tunnel --url http://localhost:5173
```

Abre en Bluefy la dirección `https://….trycloudflare.com` que aparece (cambia cada vez). La configuración de Vite ya acepta esos dominios. Una dirección `http://192.168.x.x` de la red local **no** sirve: no es HTTPS.

## Conectar con el módulo

1. **Cierra el mini-programa de WeChat** en el móvil y en el PC. El módulo solo acepta una conexión a la vez: si WeChat está conectado, esta app no lo encontrará.
2. Pon el contacto o arranca el coche para que el módulo tenga corriente.
3. Pulsa **Conectar** y elige el dispositivo **ZYCL-FWD…** de la lista.
4. Si no aparece, prueba **«Mostrar todos los dispositivos»** (lista todo lo que haya cerca).

Al conectar, la app activa las notificaciones del módulo y le pide el estado (`[0A01]`). Si la conexión se corta sola, reintenta hasta 5 veces (se puede desactivar en *Ajustes de la app*); si se conecta y se vuelve a cortar más de 5 veces seguidas, deja de intentarlo y avisa. Si pulsas «Desconectar» no reintenta, ni siquiera al volver a la app. Si bloqueas el iPhone, iOS pausa la página: al volver, la app comprueba la conexión y reconecta si hace falta. El módulo sigue reaccionando a las puertas, intermitentes, etc. por su cuenta aunque el móvil no esté conectado.

Si la conexión falla una y otra vez, apaga y enciende el Bluetooth del iPhone.

## Instalación (modo fábrica): avisos de seguridad

La sección *Más › Instalación* equivale a la pantalla «工厂设置» del mini-programa (la de la contraseña 1689; aquí no hace falta contraseña, pero hay una pantalla de aviso).

- Al entrar se envía `[2101]` (modo fábrica) y al salir `[2100]`. La pantalla muestra los valores actuales del módulo: **apúntalos antes de cambiar nada**.
- **Códigos de modelo**: 8 + 8 interruptores. No se envía nada hasta pulsar «Enviar códigos» y confirmar. Un código equivocado hace que el módulo no entienda las señales del coche. Consulta el manual del kit para tu modelo.
- **Tiras de LED y cableado**: cada cambio se envía al momento.
- **Opciones peligrosas**: la orden `[4100]` («activar el menú de ambiente original del coche», «刷机») puede reprogramar algo del coche. Está oculta por defecto (se muestra desde *Ajustes de la app*), dentro de una sección plegada y detrás de dos confirmaciones con casilla de aceptación. **No la uses si no sabes exactamente qué hace en tu coche.**
- La app ya no tiene página de *Restaurar ajustes de fábrica*: `[4200]` borra también la instalación (códigos de modelo, LEDs y cableado). Para volver a dejarlo como estaba, usa *Copia de seguridad*.

## Copia de seguridad

*Más › Copia de seguridad* lee los ajustes del módulo (y, si se marca, la instalación en modo fábrica, solo lectura) y los guarda en este navegador. Trae incluida la copia «Tu configuración (6/11/2026)». Al restaurar, primero guarda una copia automática de cómo está el módulo, luego envía los ajustes con pausa entre órdenes y vuelve a leer el módulo para comprobarlos. La instalación solo se restaura si se marca aparte, dentro de `[2101]`…`[2100]`, y un código de coche distinto pide su propia confirmación. `[41…]` y `[42…]` nunca se envían desde aquí.

## Pruebas del coche

*Más › Pruebas del coche* es un asistente para averiguar qué lee el módulo del coche. Empieza por el interruptor de funciones nº 8 (avanzada, en modo fábrica, con lectura de comprobación): con él encendido comprueba puerta, intermitentes, aire, radar y bienvenida. Después vienen los botones de la radio, las tiras animadas, los intermitentes, las puertas, la bajada de brillo al arrancar, el menú del iDrive y la bienvenida (con cuenta atrás). Antes de empezar guarda una copia; cada prueba cambia lo justo y, al terminarla, restaura y comprueba. Si se corta la conexión, la restauración queda pendiente y se aplica al volver a conectar. Mientras haya una sesión abierta, un aviso en todas las pestañas permite continuar o terminar y restaurar. «Copiar informe» deja el resultado listo para pegar en el chat.

## Laboratorio

Consola para enviar comandos tal cual: `0A01` (se envuelve en corchetes, como la consola de depuración original), `[0A01]` o bytes en hexadecimal. Registra cada envío (TX) y cada notificación (RX) con hora al milisegundo, texto ASCII y su significado. «Exportar JSON» genera el formato de laboratorio compartido con `../tools/` (`"app": "ambiente-f32-lab"`); si el navegador no descarga el archivo (puede pasar en Bluefy), «Copiar JSON» lo deja en el portapapeles. Las órdenes delicadas también piden confirmación aquí: `[4200]` y `[20…]` una vez, y `[4100]` solo se envía con «Mostrar opciones peligrosas» activado y tras dos confirmaciones. Los botones `[3702]`/`[3700]` inician y paran el modo de depuración del módulo.

## Estructura

```
app/
  public/             manifest, service worker (sw.js), iconos
  src/
    ble/              adaptadores BLE (Web Bluetooth, demo, esqueleto Capacitor), cola GATT, sesión
    mock/             módulo ZYCL-FWD simulado
    protocol/zycela/  comandos, catálogo, analizador de tramas, estado, driver, escenas
    state/            controlador de la app, almacenamiento, laboratorio
    ui/               componentes y pestañas
  test/               pruebas (vitest)
```

Todo el acceso al Bluetooth pasa por la interfaz `BleAdapter` (`src/ble/adapter.ts`). El service worker es opcional: si Bluefy no lo admite, la app funciona igual (solo pierde el uso sin conexión a internet).

## Hacer una app nativa para iOS más adelante (Capacitor)

La app está preparada para envolverse con [Capacitor](https://capacitorjs.com/) sin tocar la interfaz:

1. Instala Capacitor y el plugin `@capacitor-community/bluetooth-le`.
2. Implementa `src/ble/capacitorAdapter.ts`: el archivo ya explica cómo se corresponde cada método con el plugin.
3. Elige ese adaptador cuando la app se ejecute dentro de Capacitor.
4. En el proyecto de Xcode, añade a `Info.plist` la clave `NSBluetoothAlwaysUsageDescription` con un texto en español.
5. Para instalarla en tu iPhone hace falta un Mac con Xcode (y una cuenta de desarrollador de Apple para que no caduque a los 7 días).

## Limitaciones conocidas

- Bluefy no publica la lista exacta de funciones que admite: hay que probar en el iPhone que la conexión, las notificaciones y la escritura funcionan.
- La app no puede saber la MTU con Bluetooth web; los comandos ocupan como máximo 20 bytes (el de códigos de modelo `[20…]` ocupa exactamente 20), así que caben en una escritura con la MTU mínima.
- Encendido, variante del efecto y colores de aviso no los devuelve el módulo: la app muestra el último valor elegido.
- La reconexión sin elegir de nuevo el dispositivo («Reconectar a …») solo aparece si el navegador admite `getDevices()` (Bluefy lo incluye desde su versión 3.0; en Chrome hace falta activar una opción experimental).
- Algunos detalles del protocolo están marcados como «no confirmado» en el documento del protocolo. En concreto, la correspondencia de los comandos de montaje de puertas (`48`, `49`, `4A`, `4B`) sigue al código del mini-programa y conviene comprobarla en el coche.

---

App no oficial, sin relación con ZYCELA, WeChat ni BMW. Úsala bajo tu responsabilidad.
