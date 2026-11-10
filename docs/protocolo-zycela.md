# Protocolo BLE del módulo ZYCELA (ZYCL-FWD)

Reconstruido a partir del mini-programa de WeChat 氛围灯控制程序 (appid `wx4354b0b9d0c999a0`, paquete versión 8, extraído el 2026-11-06). Todo lo de este documento sale del código de ese mini-programa. Lo marcado como **(no confirmado)** es interpretación nuestra y hay que comprobarlo con el coche.

## 1. Conexión

| Dato | Valor |
|---|---|
| Nombre anunciado | empieza por `ZYCL-FWD` (el mini-programa acepta `name.startsWith("ZYCL-FWD")` o `localName == "ZYCL-FWD"`) |
| Servicio | `0000ffe0-0000-1000-8000-00805f9b34fb` |
| Característica de escritura | `0000ffe2-0000-1000-8000-00805f9b34fb` (el mini-programa exige la propiedad `write`) |
| Característica de notificación | `0000ffe1-0000-1000-8000-00805f9b34fb` (propiedad `notify`) |
| MTU | En Android el mini-programa pide MTU 120. En iOS el sistema la negocia solo |

Secuencia al conectar:
1. Conectar el GATT y descubrir el servicio `ffe0`.
2. Activar las notificaciones en `ffe1`.
3. Escribir `[0A01]` en `ffe2`. El módulo responde con sus tramas de estado (`1F`/`4E`, `13`, `26`, `27`).

## 2. Formato de las tramas

Todo es **texto ASCII**: cada carácter se envía como un byte (`charCodeAt`). Ejemplo: `[0A01]` → bytes `5B 30 41 30 31 5D`.

- Comando: `[` + código (2 caracteres hex) + datos + `]`.
- Respuesta: igual, `[` + código + datos + `]`. El mini-programa lee los campos por posición dentro del texto. El índice 0 es `[` y el código está en los índices 1–2.
- `XX` = número en hexadecimal de 2 dígitos **en minúsculas** (`n.toString(16).padStart(2, "0")`), que es lo que envía el mini-programa. La excepción son las direcciones de cableado, que van en mayúsculas.
- `RRGGBB` = color en hexadecimal (el mini-programa lo envía en minúsculas).
- `nnnn` = número **decimal** de 4 dígitos con ceros a la izquierda (`String(n).padStart(4, "0")`).
- Ningún comando pasa de 20 bytes (el más largo, el de códigos de modelo `[20…]`, ocupa exactamente 20), así que todos caben en una sola escritura.
- El mini-programa trata cada notificación como una trama completa (no reensambla). Por seguridad, nuestra app acumula en un búfer hasta encontrar `]`.

## 3. Comandos (app → módulo, característica `ffe2`)

### 3.1 Sistema

| Comando | Significado |
|---|---|
| `[0A01]` | Pedir el estado (se envía nada más conectar) |
| `[4200]` | Restaurar ajustes de fábrica |
| `[2101]` | Entrar en el modo fábrica (el mini-programa lo envía al abrir la pantalla "Ajustes de fábrica"; el módulo responde `23`, `25`, `4F`/`58`) |
| `[2100]` | Salir del modo fábrica (al cerrar esa pantalla) |
| `[3702]` / `[3700]` | Empezar / parar el modo de depuración (pantalla oculta, contraseña 6666; muestra lo que llega por notificación) |

### 3.2 Encendido y control (pantalla "Brillo")

| Comando | Significado |
|---|---|
| `[0701]` | Encender |
| `[0700]` | Apagar |
| `[0702]` | Seguir las luces del coche (跟随车灯) |
| `[5100]` | Control: coche + móvil (原车 + 手机) |
| `[5101]` | Control: solo móvil (强制手机) |

### 3.3 Brillo

| Comando | Rango | Significado |
|---|---|---|
| `[0200XX]` | 0–9 | Brillo deslizador 1. Etiqueta: "Global" con zonas arriba/abajo, "Consola central" con zonas delante/detrás |
| `[0101XX]` | 0–9 | Brillo deslizador 2. Etiqueta: "Contorno" con zonas arriba/abajo, "Puertas" con zonas delante/detrás |
| `[0102XX]` | 0–9 | Brillo deslizador 3: "Pies" (脚窝) |
| `[1400]` / `[1401]` | — | Tipo de zonas de brillo: arriba/abajo (上下分区) / delante/detrás (前后分区) |
| `[1A01]` / `[1A00]` | — | De noche, la consola central a mitad de brillo: sí / no |

### 3.4 Color fijo y modos RGB (pantalla "全彩 / RGB")

| Comando | Significado |
|---|---|
| `[06RRGGBB]` | Color para todo el coche (统一) |
| `[10RRGGBB]` | Color para la zona 1 (分区一) |
| `[09RRGGBB]` | Color para la zona 2 (分区二) |
| `[04XX]` | Modo RGB, `XX` = 0–20 (tabla abajo) |
| `[3EXX]` | Velocidad del modo RGB, 1–10 |
| `[2B01]` / `[2B00]` | Secuencia de colores personalizada RGB: activar / desactivar |
| `[2A` + 8 caracteres + `]` | Secuencia personalizada RGB: 8 casillas, cada una un dígito hex `0`–`e` (índice de la paleta) o `f` (vacía). Ej.: `[2A0123ffff]` |

Modos RGB (`[04XX]`):

| Grupo | IDs |
|---|---|
| Fijo (单色) | 0 un color · 1 siete colores · 2 aleatorio |
| Respiración (呼吸) | 3 un color · 4 siete colores · 5 aleatorio |
| Degradado (渐变) | 6 siete colores · 7 cian-amarillo-morado · 8 rojo-amarillo-rosa · 9 rojo-azul · 10 verde-azul · 11 aleatorio |
| Estroboscópico (爆闪) | 12 siete colores · 13 rojo-verde-azul · 14 cian-amarillo-morado |
| Ritmo musical (律动) | 15 siete colores · 16 rojo-amarillo-rosa · 17 cian-amarillo-morado |
| Movimiento (运动) | 18 azul-rojo · 19 rojo-verde · 20 rojo-cian |

Paleta del módulo (índices 0–14, la usan las secuencias personalizadas y el color de bienvenida):

| # | Color | # | Color | # | Color |
|---|---|---|---|---|---|
| 0 | `#ff0000` | 5 | `#0601fb` | 10 | `#00fe78` |
| 1 | `#fc3700` | 6 | `#a100fc` | 11 | `#3afeaa` |
| 2 | `#f7fc02` | 7 | `#ff021e` | 12 | `#fe243c` |
| 3 | `#00fe00` | 8 | `#ff01ff` | 13 | `#b7ff8f` |
| 4 | `#32feff` | 9 | `#ffffff` | 14 | `#5970fc` |

Los "colores habituales" del mini-programa son esta misma paleta. Al tocar uno envía `[06RRGGBB]` (o `10`/`09` según la zona).

### 3.5 Efectos dinámicos de las tiras "流水" (pantalla "幻彩")

| Comando | Rango | Significado |
|---|---|---|
| `[1EXX]` | 0–27 | Efecto dinámico (tabla abajo) |
| `[29XX]` | 1–6 | Variante del efecto (效果切换) |
| `[0BXX]` | 1–5 | Velocidad |
| `[0C00]` / `[0C01]` | — | Dirección: hacia delante / hacia atrás |
| `[3B01]` / `[3B00]` | — | Secuencia personalizada de los efectos: activar / desactivar |
| `[3A` + 8 caracteres + `]` | — | Secuencia personalizada de los efectos (mismo formato que `2A`) |
| `[3CXX]` | 1–9 | Longitud del segmento personalizado |
| `[3DXX]` | 1–9 | Separación del segmento personalizado |

Efectos (`[1EXX]`). El mini-programa tiene dos listas: la básica y la ampliada, que usa cuando el estado llega como `4E` (firmware más nuevo).

| Grupo | Lista básica (`1F`) | Lista ampliada (`4E`) |
|---|---|---|
| Fantasma (幻影) | 0 multicolor · 1 luz y sombra · 2 respiración | igual |
| Flujo (流光) | 3 flujo · 4 abrir-cerrar · 5 onda · 6 telón abre · 7 telón cierra · 8 acumulación · 9 persecución · 10 mágico · 11 meteoro | 3 · 4 · 5 · 6 · 7 · **25 ping-pong** · 9 · 10 · 11 |
| Acumulación (堆积) | — | 8 acumulación · 26 apilado · 27 convergencia |
| Estela (拖尾) | 12 siete colores · 13 multicolor · 14 un color | igual |
| Ritmo (律动) | 15 espectro · 16 estirar · 17 onda · 18 contraer · 19 columnas · 20 un color | igual |
| Movimiento (运动) | 21 estirar · 22 contraer · 23 rojo-azul | igual |
| Un color (单色) | 24 sincronizar con RGB | igual |

### 3.6 Música

| Comando | Rango | Significado |
|---|---|---|
| `[0300XX]` | 0–9 | Sensibilidad al sonido |
| `[1B00]` / `[1B01]` | — | Fuente de sonido: micrófono interno / altavoces del coche |

### 3.7 Bienvenida y eventos del coche (pantalla "设置")

| Comando | Significado |
|---|---|
| `[3001]` / `[3000]` | Bienvenida activada / desactivada |
| `[39XX]` | Modo de bienvenida: 0 envolvente consola · 1 envolvente puertas · 2 puertas + retorno · 3/4/5 las 4 puertas a la vez ①②③ |
| `[38XX]` | Color de bienvenida: índice de paleta 0–14. `[380f]` = sincronizar con RGB |
| `[31XX]` | Aviso de puerta abierta (开门警示): `01` sí / `00` no |
| `[32XX]` | Vinculado al radar de aparcamiento (雷达联动): `01`/`00` |
| `[33XX]` | Vinculado a la velocidad (车速联动): `01`/`00` |
| `[34XX]` | Vinculado a los intermitentes (转向联动): `01`/`00` |
| `[35XX]` | Aviso del aire acondicionado (空调警示): `01`/`00` |
| `[44XX]` | Vinculado al detector de ángulo muerto (盲点检测关联): `01`/`00` |
| `[46XX]` | Color de puerta: 0 rojo · 1 amarillo · 2 magenta · 3 azul |
| `[45XX]` | Color de intermitente: 0 rojo · 1 amarillo · 2 magenta · 3 azul |
| `[47XX]` | Color de ángulo muerto: 0 rojo · 1 amarillo |

Si en la trama `26` una de estas funciones vale `ff` (255), el coche no la admite: el mini-programa muestra "该项不支持" y no envía nada.

### 3.8 Instalación (pantalla "工厂设置", contraseña 1689)

**Todo esto cambia cómo el módulo interpreta el coche y las tiras. No hay que tocarlo sin saber qué se hace.**

| Comando | Significado |
|---|---|
| `[20` + 16 caracteres `0`/`1` + `]` | Códigos de modelo: 8 bits de "código de coche" (车型编码) + 8 bits de "funciones" (功能拨码). Ej.: `[201000000000000000]`. Ojo: aquí no se usa hexadecimal, son literalmente 16 caracteres `0`/`1` |
| `[1Cnnnn]` | LEDs de la tira del conductor, 30–200 |
| `[0Fnnnn]` | LEDs del acompañante, 30–200 |
| `[13nnnn]` | LEDs de las puertas delanteras, 30–200 |
| `[1Dnnnn]` | LEDs de las puertas traseras, 30–200 |
| `[40nnnn]` | Parámetro de la tira (灯条参数导入), 0–200 |
| `[52nnnn]` | LEDs de la tercera fila (solo monovolúmenes), 0–200 |
| `[2CXX]` | Salida del cable, conductor: `00` izquierda / `01` derecha |
| `[2FXX]` | Salida del cable, acompañante: `00` izquierda / `01` derecha |
| `[48XX]` | Montaje, delantera izquierda (tipo 3): `01` cable sale por delante (前面出线) / `00` por detrás (后面出线) |
| `[49XX]` | Montaje, delantera derecha (tipo 5): `01` por delante / `00` por detrás |
| `[4AXX]` | Montaje, trasera izquierda (tipo 4): `01` por delante / `00` por detrás |
| `[4BXX]` | Montaje, trasera derecha (tipo 6): `01` por delante / `00` por detrás |
| `[53XX]` / `[54XX]` | Salida del cable, tercera fila izquierda / derecha (tipos 7 y 8): `01` por delante / `00` por detrás |
| `[43nnnn]` | Código de cliente, 0–9999 |
| `[22XX]` | Aprender un botón del volante (方控按键学习): 1 despertar · 2 modo principal de efectos · 3 submodo de efectos · 4 modo/color + · 5 modo/color − |
| `[4100]` | "Activar el menú de ambiente original del coche" (原车氛围灯界面开通 → 开始刷机). **Peligroso: puede reprogramar algo del coche. No usar** |

La asignación de cada tipo a su puerta sale de la plantilla de la pantalla de fábrica. El mini-programa envía `[` + código del tipo + valor en hex mayúsculas + `]`: tipo 1 → `2C`, 2 → `2F`, 3 → `48`, 4 → `4A`, 5 → `49`, 6 → `4B`, 7 → `53`, 8 → `54`. Ojo: en las puertas, "por delante" vale `01` y "por detrás" `00`. En conductor y acompañante, "izquierda" vale `00` y "derecha" `01`.

Aprender un botón: el mini-programa solo lo ofrece dentro del modo fábrica (después de `[2101]`). Se toca la función, se pulsa el botón del volante y el módulo responde con la trama `17`. No hay forma de asignar un color concreto a un botón: el botón ejecuta una de esas 5 funciones (por ejemplo, "siguiente color").

## 4. Respuestas (módulo → app, notificaciones en `ffe1`)

`s.substr(i, n)` = `n` caracteres desde el índice `i` de la trama de texto (índice 0 = `[`). `hex(i)` = `parseInt(s.substr(i, 2), 16)`.

### `1F` / `4E` — estado general
`4E` es la variante del firmware nuevo: activa la lista ampliada de efectos y añade el campo de control.

| Posición | Campo |
|---|---|
| `hex(3)` | Modo RGB (`04`) |
| `hex(5)` | Efecto dinámico (`1E`) |
| `substr(9, 6)` | Color actual `RRGGBB` |
| `hex(21)` | Brillo deslizador 2 (`0101`) |
| `hex(23)` | Brillo deslizador 3 (`0102`) |
| `hex(25)` | Sensibilidad al sonido (`0300`) |
| `hex(27)` | Velocidad de efectos (`0B`) |
| `hex(29)` | Dirección de efectos (`0C`) |
| `hex(31)` | Brillo deslizador 1 (`0200`) |
| `hex(33)` | Velocidad RGB (`3E`) |
| `hex(35)` | Control coche/móvil (`51`), solo en `4E` |

Las posiciones 7–8 y 15–20 el mini-programa no las usa (probablemente encendido y zona, **no confirmado**).

Qué lee cada pantalla del mini-programa: la de color (modo RGB, color y velocidad RGB) y la de ajustes (sensibilidad) solo leen tramas `1F`. La de brillo y la de efectos leen `1F` y `4E`. Así que con `4E` no está confirmado que el modo RGB, el color, la sensibilidad y la velocidad RGB estén en esas mismas posiciones.

### `26` — ajustes

| Posición | Campo |
|---|---|
| `hex(3)` | Bienvenida activada (`30`) |
| `hex(5)`, `hex(7)`, `hex(9)`, `hex(11)`, `hex(13)` | Puerta abierta, radar, velocidad, intermitentes, aire acondicionado (`31`–`35`); `ff` = no admitido |
| `hex(15)` | Consola a mitad de noche (`1A`) |
| `hex(17)` | Tipo de zonas de brillo (`14`) |
| `hex(19)` | Modo de bienvenida (`39`) |
| `substr(21, 1)` | `1` = el módulo admite "sincronizar con RGB" (el mini-programa solo muestra ese botón si vale `1`) |
| `substr(22, 1)` | Color de bienvenida: índice de paleta (1 dígito hex). `f` = sincronizado con RGB |
| `hex(23)` | Fuente de sonido (`1B`) |
| `hex(27)` | Ángulo muerto (`44`), solo si la trama tiene más de 28 caracteres |

Los colores de puerta, intermitente y ángulo muerto (`45`/`46`/`47`) no vienen en ninguna respuesta.

### `27` — secuencias personalizadas

| Posición | Campo |
|---|---|
| `substr(3, 8)` | Secuencia RGB (8 dígitos hex, `f` = vacía) |
| `hex(11)` | Secuencia RGB activada (`2B`) |
| `substr(13, 8)` | Secuencia de efectos |
| `hex(21)` | Secuencia de efectos activada (`3B`) |
| `hex(23)` | Longitud (`3C`) |
| `hex(25)` | Separación (`3D`) |
| `hex(27)` | Casilla seleccionada (RGB, solo interfaz) |
| `hex(29)` | Velocidad RGB |
| `hex(31)` | Casilla seleccionada (efectos, solo interfaz) |

### `13` — versión
`s.substr(3, s.length - 4)` es texto ASCII codificado en hex (2 caracteres por letra). Una vez decodificado: caracteres 0–4 = versión de hardware, 5–12 = modelo de coche, 13–22 = versión de firmware.

### Resultados

| Código | Significado de `hex(3)` |
|---|---|
| `2E` | Resultado de un ajuste: 0 no admitido · 1 hecho · 2 fallo |
| `17` | Aprendizaje de botón: 0 aprendido · 1 fallo · 2 no admitido |
| `18` | Activación del menú original (`4100`): 0 no admitido · 1 hecho · 2 fallo |

### Modo fábrica (después de `[2101]`)

| Código | Campos |
|---|---|
| `23` | `substr(3, 8)` = bits del código de coche, `substr(11, 8)` = bits de funciones (caracteres `0`/`1`) |
| `25` | `parseInt(substr(9, 4))` = parámetro de la tira (`40`), `parseInt(substr(15, 4))` = código de cliente (`43`). Decimal |
| `4F` | LEDs: conductor `substr(9,4)`, acompañante `substr(15,4)`, delanteras `substr(21,4)`, traseras `substr(27,4)`. Direcciones (decimal, 2 dígitos): conductor (tipo 1) `substr(13,2)`, acompañante (2) `substr(19,2)`, delantera izquierda (3) `substr(25,2)`, trasera izquierda (4) `substr(31,2)`, delantera derecha (5) `substr(33,2)`, trasera derecha (6) `substr(35,2)` |
| `58` | Igual que `4F` más tercera fila: LEDs `substr(37,4)`, direcciones 7 `substr(41,2)` y 8 `substr(43,2)` |

## 5. Códigos de modelo y cableado (documentación del fabricante)

Fuentes: el PDF "中雅车联 三代控制拨码车型表" y la imagen "专用控制盒连接示意图", ambos enlazados desde el QR del manual. Se descargaron el 2026-11-06.

**Códigos de modelo.** La tabla marca cada interruptor como 上 (arriba) o 下 (abajo). 下 es el interruptor encendido (rojo en la app) y corresponde a `1` en el comando `[20…]`. Los códigos BMW (interruptores 1→8):

| Bits | Modelo | Control | Seguir luces / puerta / radar / velocidad / intermitente / A/C / ángulo muerto |
|---|---|---|---|
| `01000001` | F18, menú de solo brillo | pantalla | ✓ ✓ ✓ ✓ ✓ ✓ ✗ |
| `01000010` | F18 antiguo / X1 / X3 / X4 / X5 / X6 | pantalla | ✓ ✓ ✓ ✓ ✓ ✓ ✗ |
| `01000011` | G38 / G28 / nuevos X1–X4 | pantalla | ✓ ✓ ✓ ✓ ✓ ✓ ✗ |
| `01000100` | CIC | botones | ✓ ✓ ✓ ✓ ✓ ✓ ✗ |
| `01000101` | Serie 3 2023–25 (iD8) | pantalla | ✓ ✓ ✓ ✓ ✓ ✓ ✗ |

El "flasheo OBD" (`[4100]`) solo aparece en la tabla para Audi, Volkswagen y Mercedes, con códigos de modelo propios. En la de Volkswagen se avisa de que, después de flashear, hay que volver a poner el código normal. Para BMW no hay fila de flasheo.

**Cableado y zonas.** Esta caja de control se usa tanto para los kits "全彩" (color fijo) como para los "幻彩" (tiras animadas).

- **Caja principal:** HC1 = lado izquierdo del volante (tira corta), HC2/HC3 = lado derecho del volante (tira larga), LED1 = salpicadero izquierdo, LED2 = salpicadero derecho, LED3 = pies. El puerto DAT está "reservado (control por sonido)".
- **Cajas de puerta:** HC1 = tira animada, LED1 = tirador de la puerta, LED2 = contorno de la puerta, LED3 = hueco portaobjetos.
- **Zona 1 (分区一, comando `[10…]`):** HC1–HC3 y LED1–LED2 de la caja principal, más LED1–LED2 de cada puerta. Es decir: salpicadero, volante, tiradores y contornos.
- **Zona 2 (分区二, comando `[09…]`):** LED3 de la caja principal y de cada puerta. Es decir: pies y portaobjetos.

## 6. Pruebas en el coche (BMW F32, 2026-11-06)

Módulo `ZYCL-FWD-41A0`: hardware V7.10, código ZY45542, firmware 251121-023, trama de estado `4E`. Las características `ffe1` y `ffe2` declaran ambas `write`, `writeWithoutResponse` y `notify`.

Hicimos un experimento guiado de 10 pasos con la app: punto de partida, abrir y cerrar la puerta, contacto, arrancar, luces de cruce, intermitente, marcha atrás, apagar, bajar y bloquear, desbloquear. La depuración `[3702]` estuvo activada y después de cada paso la app pedía el estado con `[0A01]`. Resultado:

- **El módulo no envía nada por su cuenta.** En ningún paso hubo notificaciones espontáneas, ni siquiera con `[3702]`, que tampoco tuvo ninguna respuesta. Solo contesta cuando se le pregunta.
- **Su estado no cambia con el coche.** Las tramas `4E`, `26`, `27` y `13` fueron idénticas en los 10 pasos, también al arrancar con las luces encendidas. Lo que haga por dentro (la consola a mitad de brillo de noche, la bienvenida, el aviso de puerta) no se refleja en lo que informa.
- **La conexión no se cortó al bloquear** el coche. Siguió conectada al menos 20 segundos después. Se perdió unos 30 minutos más tarde.
- Conclusión: el móvil no puede saber por el módulo si el coche está con contacto o en marcha. Las reacciones a eventos del coche solo existen dentro del módulo, con las opciones de la sección 3.7.

Trama de estado real: `[4E001801FF1000FF11010904010300090800]`. Modo RGB 0, efecto 24, color `#FF1000`, brillos 9/9/4, sensibilidad 1, velocidad de efectos 3, control coche + móvil. Las posiciones 7–8 valen `01`; quizá sea el encendido (**no confirmado**).

En la trama `26` la fuente de sonido vale `FF`. El mini-programa no trata ese valor de forma especial: simplemente no marca ninguna de las dos opciones.

### Observado al conducir (2026-11-07)

- **Radar de aparcamiento:** con marcha atrás, las tiras parpadean en un color que va de verde a rojo según la distancia. Solo funciona con `[3201]`: con `[3200]` no hay efecto. Coincide con el mini-programa, que muestra `1` como "开启" (activado) y `0` como "关闭" (desactivado). En la copia del 6/11 estaba en `00`, y el usuario lo activó desde la app.
- **Consola a mitad de brillo de noche (`[1A01]`):** funciona.
- **Conclusión:** el módulo sí lee la red del coche, porque la distancia del radar y el estado de las luces solo pueden venir de ahí.

### Pruebas guiadas de la app (7–9/11/2026)

Informe completo pegado por el usuario. Copia de partida (7/11):
- tramas `[4E001801FF0D00FF0D000904010300090800]`, `[2601010000010101000104FF00FF]`, `[250055AA0123FF000000]` y `[4F0055AA0050000050000050010050010101]`;
- respecto al 6/11 cambiaron el color (`#ff0d00`), el aviso de intermitentes (ahora activado) y el modo de bienvenida (1, «envolvente puertas»).

**Funciona:**

| Prueba | Resultado |
|---|---|
| Interruptor de funciones nº 8 | Se encendió (`[200100001000000001]` dentro de `[2101]`…`[2100]`, leído de nuevo, correcto). El usuario lo **dejó encendido**: el módulo queda en `01000010/00000001`. |
| Climatizador (`[3501]`) | Las tiras cambian de color al cambiar la temperatura. El día anterior, con el interruptor 8 apagado, el usuario no lo vio funcionar: quizá el interruptor 8 activa esta señal (**no confirmado**). |
| Radar (`[3201]`) | Funciona. |
| Botones de favoritos de la radio | Cambian el color del kit: color `#ff0d00` → `#ff0000` y brillo 3 de 4 a 9. Las posiciones 15–20 de la trama `4E` cambiaron a la vez, de `FF0D00` a `FF0000` (probablemente el color de la zona 2). |
| Menú de luz ambiente del iDrive | Existe, y el módulo lo sigue: al cambiarlo, los tres brillos pasaron de 9/9/4 a 6/6/6. El menú solo tiene brillo, sin colores (comprobado por el usuario). |
| Bloqueo | Las tiras se apagan nada más bloquear. |

**No funciona** (todo con el interruptor 8 encendido):

| Prueba | Resultado |
|---|---|
| Aviso de puerta (`[3101]` y color azul `[4603]`) | Nada. |
| Intermitentes y luces de emergencia (`[3401]` y amarillo `[4501]`) | Nada. |
| Bienvenida, modo 0 en blanco y modo 1 | No aparece. |
| Efecto «Flujo» (`[1E03]`) | **No se mueve nada**: no hay tiras animadas (HC / 幻彩) visibles. |

Ninguna notificación no pedida en ningún paso, ni por FFE1 ni por FFE2. Se saltaron la prueba de la bajada de brillo al arrancar y la de la bienvenida tras dormir el coche. El cable de protocolo y el código de coche `01000010` están bien. Lo que no funcione (bienvenida, puertas, intermitentes) es cuestión de esas funciones o de sus ajustes, no del cableado.

## 7. Otras vías de control (documentación del fabricante)

Detalles y fuentes en [investigacion-eventos.md](investigacion-eventos.md).

- **Botones de favoritos de la radio (CD按键控制).** Según el manual del fabricante para BMW F30–F36, el 4 (o 1+4) cambia el modo, el 5 y el 6 (o 1+5 y 1+6) el color, y el 7 y el 8 (o 1+7 y 1+8) el brillo. El manual del G38 lo describe "tocando" los botones. Falta comprobarlo en el F32.
- **Menú del iDrive (屏控).** Iluminación interior → luz ambiente: color, brillo y "atenuar en conducción nocturna". Solo existe si el iDrive tiene ese menú, de fábrica o activado por codificación.
- **Botón del volante aprendido (`[22XX]`).** Hace una de cinco funciones (despertar, modo de efectos, submodo, modo/color + y −). No se conoce otra forma de desaprenderlo que restaurar de fábrica y reconfigurar.
- **Interruptor de funciones nº 8.** En los manuales del fabricante para F30–F36 y G38 aparece **encendido** (`00000001`), con la nota 功能拨码不动 ("no toques el dial de funciones"). En este coche está apagado. No se sabe qué hace.
- **La bienvenida (迎宾)** la llama el manual de la app "幻彩迎宾开关": funciona sobre las tiras animadas (HC). No hay ningún comando para elegir qué la dispara.
- **Alimentación.** El fabricante conecta el kit en el conector de 4 pines del mando del iDrive. En los foros, el pin 1 de ese conector se describe como 30B: corriente solo mientras el coche está despierto. Eso encaja con que la conexión se cortara unos 30 minutos después de bloquear.

## 8. Contraseñas del mini-programa
- `1689`: ajustes de fábrica.
- `6666`: modo de depuración (consola de comandos).

Las contraseñas solo existen en el mini-programa; el módulo no las pide.
