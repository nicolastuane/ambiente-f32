# Mi configuración de instalación (BMW F32 420)

Copia de la pantalla "工厂设置" (ajustes de fábrica) del mini-programa, tomada el 2026-11-06. Con esta configuración el módulo reconoce bien el coche. Si algún día se restaura de fábrica (`[4200]`) o hay que cambiar el módulo, estos son los valores y los comandos para volver a dejarlo igual.

| Ajuste (chino) | Qué es | Valor | Comando |
|---|---|---|---|
| 车型编码 | Código de modelo de coche (8 interruptores) | 2 y 7 encendidos → `01000010` | — |
| 功能拨码 | Interruptores de funciones extra | todos apagados → `00000000` | — |
| 确定 | Enviar ambos códigos | — | `[200100001000000000]` |
| 主驾 | Tira del lado del conductor: nº de LEDs | 50 | `[1C0050]` |
| 主驾 · 左边出线 | Conductor: el cable sale por la izquierda | izquierda | `[2C00]` |
| 副驾 | Tira del lado del acompañante: nº de LEDs | 50 | `[0F0050]` |
| 副驾 · 左边出线 | Acompañante: el cable sale por la izquierda | izquierda | `[2F00]` |
| 左前门/右前门 | Tiras de las puertas delanteras: nº de LEDs | 50 | `[130050]` |
| 左前安装方向 · 前面出线 | Puerta delantera izquierda: cable por delante | delante | `[4801]` |
| 右前安装方向 · 前面出线 | Puerta delantera derecha: cable por delante | delante | `[4901]` |
| 左后门/右后门 | Tiras de las puertas traseras: nº de LEDs | 50 | `[1D0050]` |
| 左后安装方向 · 前面出线 | Puerta trasera izquierda: cable por delante | delante | `[4A01]` |
| 右后安装方向 · 前面出线 | Puerta trasera derecha: cable por delante | delante | `[4B01]` |
| 灯条参数导入 · 编号 | Parámetro de la tira | 123 | `[400123]` |
| 客户编码导入 · 编号 | Código de cliente (del vendedor) | 0 | `[430000]` |

## Qué significa el código 2 + 7

En la tabla oficial del fabricante ("中雅车联 三代控制拨码车型表"), cada interruptor está 上 (arriba, apagado) o 下 (abajo, encendido; en la app sale en rojo). Tu combinación es 上 下 上 上 上 上 下 上 y corresponde a:

> **BMW 老款F18/x1/x3/x4/x5/x6**: BMW de la serie F de primera generación. Control: 屏控, es decir, desde la pantalla del coche (iDrive).

Es el código genérico de los BMW de la serie F, y el F32 es serie F: por eso reconoce bien el coche. Según la tabla, con este código funcionan:

| Función | ¿Funciona? |
|---|---|
| 跟随车灯: encender y apagar con las luces del coche | Sí |
| 开门警示: aviso de puerta abierta | Sí |
| 雷达警示: aviso del radar de aparcamiento | Sí |
| 超速警示: aviso de exceso de velocidad | Sí |
| 转向提醒: intermitentes | Sí |
| 空调关联: vinculado al aire acondicionado | Sí |
| 盲点关联: ángulo muerto | No |

Los otros códigos BMW de la tabla, por si alguna vez hiciera falta probar otro (`0` = 上, `1` = 下, interruptores 1→8):

| Código | Modelo según la tabla | Control |
|---|---|---|
| `01000001` | F18, menú de solo brillo, sin colores | pantalla |
| `01000010` | **F18 antiguo / X1 / X3 / X4 / X5 / X6 (el tuyo)** | pantalla |
| `01000011` | G38 / G28, nuevos X1 / X2 / X3 / X4 | pantalla |
| `01000100` | CIC (iDrive antiguo) | botones |
| `01000101` | Serie 3 2023–25 (pantalla curva iD8) | pantalla |

La tabla no explica los 8 interruptores de **功能拨码** (funciones). Todos apagados es lo normal.

## Antes de enviar comandos

Antes de enviar cualquiera de estos comandos hay que entrar en el modo fábrica con `[2101]`, y al terminar salir con `[2100]`. La app nueva lo hace sola en su pantalla "Instalación".

## Lo que no hay que tocar en esa pantalla del mini-programa

- **原车氛围灯界面开通 → 开始刷机** ("activar el menú de ambiente original → empezar a flashear"). Al tocarlo envía `[4100]` sin pedir confirmación. Parece reprogramar algo del coche. **No tocar.**
- **方控按键学习** (aprender botones del volante). Tocar cualquiera de los 5 botones **empieza a aprender en ese momento**: el módulo espera a que pulses un botón del volante. Que "唤醒按键" salga en azul solo es la selección por defecto de la pantalla, no significa que haya algo aprendido.
- Los botones **− / +**, **izquierda/derecha** y **delante/detrás** se envían al módulo en cuanto se tocan. Los interruptores 1–8 solo se envían al pulsar **确定**.
