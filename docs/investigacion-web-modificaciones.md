> Búsqueda en internet del 2026-11-10 (cinco búsquedas en paralelo, en chino y en inglés, más una revisión que volvió a abrir las fuentes principales). Pregunta: ¿alguien más ha modificado estas cajas de luz ambiente, y cómo?

# ¿Alguien más ha modificado estas cajas de luz ambiente? Lo que hay en internet

Cinco búsquedas paralelas en chino y en inglés, hechas el 10/11/2026, y una revisión posterior que volvió a abrir las páginas principales: fabricante, proyectos parecidos, herramientas para chips y CAN de BMW. Donde una fuente decía otra cosa, este texto ya está corregido. Cada fuente lleva una de estas dos marcas:
- **[visto]**: alguien abrió la página.
- **[solo resultado de búsqueda]**: solo se vio el resumen que da el buscador.

**Términos que aparecen mucho:**
- *Firmware*: el programa interno de la caja.
- *Volcar*: copiar ese programa a un ordenador.
- *ESP32*: placa programable de pocos euros, con Bluetooth y Wi-Fi.
- *CAN / K-CAN*: la red de datos por la que hablan entre sí los módulos del coche.
- *ESPHome / Home Assistant*: programas libres de domótica con los que mucha gente controla luces Bluetooth.

## 1. Resumen

- **Sobre tu caja (ZYCELA / 中雅车联 / ZYCL-FWD) nadie ha publicado nada.** No hay desmontajes, volcados, reprogramaciones ni descripción de su protocolo. Solo existen páginas del propio fabricante: web, YouTube, página de descarga de la app y anuncios de AliExpress. Si publicas tu documento del protocolo, por lo que se ha podido ver sería lo primero público sobre esta caja.
- **Con cajas de coche parecidas, la gente hace lo mismo que tú.** Sacan el protocolo Bluetooth de la app del fabricante, descompilándola o capturando el tráfico, y escriben una app propia. Hay tres ejemplos:
  - open-cardi, con kits Cardi.
  - led-ble-car, con kits LEDCAR. Su autor dice además que hizo un ESP32 que sustituye a la app, aunque no publica ese código.
  - Un artículo chino en CSDN que sacó el protocolo de un mini-programa de WeChat. Solo se vio el resumen.

  Ninguno toca el firmware.
- **No se encontró a nadie que haya reprogramado el firmware de una caja china de luz ambiente de coche.** Reprogramar solo es habitual en controladores LED Wi-Fi de casa con chips abiertos (ESP8266). Con unas chapas LED con chip WCH CH582, el firmware original estaba protegido contra lectura y la comunidad escribió uno nuevo desde cero. Existen herramientas para copiar la memoria de varios chips Bluetooth chinos, pero todas exigen abrir la caja y conectarse a la placa.
- **Hay una pista sobre el chip.** Tu caja anuncia el servicio AF30 pero no lo tiene. Lo mismo hace el ejemplo de «puente Bluetooth–puerto serie» del kit de programación oficial de JieLi (杰理), que anuncia AF30 pero sirve AE30. También lo hacen productos reales hechos con ese kit. Es un indicio, no una prueba, de que el chip Bluetooth es un JieLi. Que ese chip solo pase los mensajes a otro chip que lee el coche es otra suposición, sin ninguna fuente que lo muestre.
- **En lugar de reprogramar, la gente hace una de dos cosas:**
  - **Quitar la caja** y poner un ESP32 que lee el CAN del coche y mueve las tiras. Hay proyectos en Tesla, Seat y Renault.
  - **Dejar la caja** y ponerle al lado un ESP32 que le manda órdenes por Bluetooth como si fuera el móvil. Se ha hecho con tiras de casa (ESPHome) y, según su autor, con un kit de coche LEDCAR.

  Nadie ha publicado todavía la segunda opción combinada con el CAN del coche, aunque las dos piezas existen.
- **Para el BMW F30/F32 no se encontró nada hecho.** No apareció ningún proyecto casero de luz ambiente que lea el K-CAN ni una lista pública de mensajes (puertas, cierre, velocidad). Es un resultado negativo débil: BimmerPost, Reddit y Bimmerfest no se pudieron leer.
  - Según resúmenes de foros sin confirmar, el conector del mando iDrive lleva K-CAN2 a 500 kbps.
  - En la serie F muchos mensajes llevan un código de comprobación (CRC) y un contador. Está confirmado en mensajes del tren motriz de un F20 y en los del cuadro de un F30. Escuchar el bus es fácil, pero imitar mensajes no.

## 2. Lo que hizo la gente

### A. El mismo módulo o la misma marca

Nadie ha modificado esta caja. Lo que hay es del propio fabricante o de otros vendedores con cajas del mismo tipo.

1. **Web oficial de ZYCELA**: https://zycela.com/ [visto]
   - **Qué dice:**
     - Fabricante de Shenzhen con sede en Guanlan (Longhua).
     - Certificación IATF16949.
     - «Más de 12 años» en luz ambiente y «una de las tres primeras marcas de China».
     - Servicio OEM/ODM. Su artículo sobre OEM/ODM dice: «Both control boxes and wiring systems can be tailored». https://zycela.com/2025/07/09/from-concept-to-customization-inside-zycelas-oem-odm-process/ [visto]
   - **Página de soporte:** sin firmware, manuales ni descargas. Solo tiene los enlaces a las dos apps y contactos (correo zhongyachelian@gmail.com, teléfono/WhatsApp y LINE): https://zycela.com/support/ [visto]
   - **Lo técnico:** nada. No nombra chips, no menciona el CAN ni ofrece actualizaciones.
   - Parecido: misma marca. Dificultad: no aplica.
   - Para ti: la única vía oficial para cambiar el programa sería pedírselo al fabricante.

2. **Ficha ZYCELA del BMW X3/X4 (2018–21)**: https://zycela.com/product/bmw-x3-x4-18-21/ [visto]
   - **Qué explica:** el significado de los códigos de modelo.
     - ZYCL-BM03M: kit «RGB».
     - ZYCL-HC-BM03M-WX: kit «Ambient Light». Los nombres de archivo de sus fotos dicen «幻彩», es decir, tiras animadas.
     - ZYCL-BM11M: kit RGB para 2022–23.
   - La categoría BMW (https://zycela.com/product-category/bmw/) solo tiene esta ficha y la de un F18. No hay F30/F32 ni Serie 3/4.
   - Parecido: misma marca.
   - Para ti: «HC-» parece indicar la versión animada; mira la etiqueta del kit o de las tiras. Ojo con estas suposiciones:
     - Quizá «HC» sea la abreviatura en pinyin de 幻彩 (HuanCai).
     - La ficha es de X3/X4 y no está confirmado que los códigos signifiquen lo mismo en el F32.
     - Que «WX» signifique WeChat también es una suposición.

3. **Página de descarga de la app del fabricante**: http://www.qrtransfer.com/ZhongYa.html [visto]
   - El botón de Android lleva, a través de una redirección de WeChat, a un APK llamado «DistributorApp.apk» en mobile.xinlianwang.com. Ese dominio redirige ahora a hugedomains.com: está aparcado o en venta. La otra app de la marca («多彩智能灯») usa el mismo enlace.
   - Parecido: misma marca.
   - Para ti: **no instales APKs desde ese enlace.** Si alguien compra el dominio, podría servir un APK malicioso con el mismo nombre. El nombre sugiere una app genérica de distribuidor (suposición).

4. **Canal de YouTube del fabricante**: https://www.youtube.com/@ShenzhenZYCELA [visto; se vio la lista de títulos y la descripción, no los vídeos]
   - Son vídeos publicitarios sin nada técnico. Uno es «BMW 3 & 4 Series Ambient Lighting Upgrade | Smart Control & Phantom Effects» (https://www.youtube.com/watch?v=CO4PkN445_M). Puede servir para ver cómo luce la versión 幻彩 y compararla con la tuya.
   - La descripción del canal llama a la empresa «SV (Company Name: Shenzhen ZYCELA Technology CO., LTD.)», dice que se fundó en 2019 y que tiene más de 150 personas. La web habla de «más de 12 años».

5. **ZYCELA en AliExpress**: https://es.aliexpress.com/item/1005012335351691.html [visto]
   - La tienda «ZLFZ Car Upgrade Store» vende kits ZYCELA para Audi, Porsche, VW, Toyota y Lexus. No aparece ningún kit ZYCELA para BMW y no hay datos técnicos.
   - Parece una misma plataforma de caja para muchos coches, con un código por vehículo (suposición).

6. **Kits del mismo tipo de otros vendedores, sin modificar.** Muestran que tu caja funciona como otras de su tipo.
   - **Kit F30/F32/F33/F36 de incarpassion**: https://www.incarpassion.com/bmw-3-series-f30-oem-design-8-colors-ambient-light [visto]. La dirección dice «8 colors», pero el texto dice «11 colors available». La dirección https://incarpassion.com/?p=6208 lleva a esta misma página; no es otra variante.
     - Los botones 5–8 de la radio cambian el color (5 y 6) y el brillo (7 y 8), con CIC y con NBT.
     - El menú del iDrive solo funciona con NBT y después de activarlo por codificación.
     - La página se contradice: dice que se instala «sin cortar cables» y que en CIC hay que cortar dos mazos.
     - No menciona app, Bluetooth ni CAN.
   - **Kit de G30.** https://www.incarpassion.com/?p=15938 [visto]
     - La caja maestra va en el conector bajo el mando iDrive.
     - Se controla con un mini-programa de WeChat cuyo código QR viene también en la caja.
     - Lleva **cajas esclavas en las puertas**; hay que emparejarlas en orden para que funcione la bienvenida.
   - **BMW i3.** https://www.mybmwi3.com/threads/ambient-lighting-installation-base-bmw-i3.18836/ [solo resultado de búsqueda; la página da 403]
     - Kit de AliExpress de unos 105 $ empalmado al conector de 4 pines del mando iDrive.
     - Un interruptor DIP elige el control: menú del iDrive, botones 5–8 o solo la app.
     - La tabla de colores venía mal de fábrica.
     - Compáralo con tus pruebas del interruptor 8.
   - **F30 en Reddit.** La caja se conecta entre el mando iDrive y la alimentación, sin cambiar pines. https://axebps-redlib.hf.space/r/F30/comments/1js6cbg/ambient_lighting_install_help_needed [solo resultado de búsqueda]
   - **G30 en Bimmerpost.** Kits de 64 colores que se manejan con el iDrive, los botones 1–8 y la app. https://g30.bimmerpost.com/forums/showthread.php?p=30893006 [solo resultado de búsqueda]
   - **Mercedes W205.** Un kit chino que funcionó sin WeChat. https://mbworld.org/forums/c-class-w205/711574-interior-ambient-lighting-2.html [solo resultado de búsqueda]
   - En ninguna de estas fuentes aparece ninguna modificación.

### B. Controladores parecidos: cambiar la app o reprogramarlos

#### B1. Sacar el protocolo y hacer una app propia (lo más habitual)

1. **open-cardi**: https://github.com/harshmandan/open-cardi [visto]
   - **Qué hizo:** una app Android de código abierto (con pantalla para Android Auto) y una página web con Bluetooth, que sustituyen a la app de los kits de luz ambiente Cardi K3/K4. Incluye bloquear y desbloquear, consulta de versión y restaurar fábrica. No tocó el firmware.
   - **Cómo:**
     - Descompiló dos APK del fabricante con jadx, capturó el tráfico Bluetooth del móvil y lo reprodujo.
     - El protocolo usa el servicio FFF0, escritura sin respuesta en FFE2 y notificaciones en FFE1, con tramas binarias `ED … E9`.
     - Según el autor, el chip es un Beken BK343x, aunque no explica cómo lo sabe. El artículo que enlaza (harsh.ink) da error 404.
   - **Problema conocido:**
     - Con el coche encendido y los faros en AUTO, la caja a veces se reinicia al cambiar de color, también con la app del fabricante.
     - Si la conexión se abrió con un tamaño de paquete (MTU) grande, tras ese reinicio se queda parpadeando hasta quitarle la corriente. Chrome pide 517 y la caja acepta 131.
     - Con el tamaño por defecto (23), que es el que usa la app del fabricante, siempre se recupera.
   - **Hardware:** kits Cardi y otras marcas con el mismo firmware (CarDiLits, iLits, BaoYin, CaChuang, CarL, MTF-LIGHT, AIKON-LIT, Dream, Flash).
   - Dificultad: media. Parecido: **mismo tipo.** Es lo más cercano a tu caso que hay publicado: mismos papeles de FFE1 y FFE2, y usa como servicio el FFF0 que tu caja anuncia. Pero el protocolo es distinto y ningún comando sirve para la tuya.

2. **led-ble-car**: https://github.com/LycheeAPPF/led-ble-car [visto]
   - **Qué hizo:** documentó el protocolo y escribió una herramienta en Python para los kits interiores LEDCAR / LEDBLE / LEDDMX (app com.ledlamp). Solo lo probó en vivo con un LEDCAR-01. Según el README, también hizo un ESP32 que sustituye a la app («ESP32 dashboard replacement»), cuyo código no está en el repositorio. No tocó el firmware de la caja.
   - **Cómo:**
     - Descompiló el APK con jadx y Vineflower y comparó los resultados.
     - Servicio FFE0 con FFE1 (escritura y notificación), y FFE2 opcional y casi sin uso.
     - Tramas binarias de 9 bytes, sin comprobación ni contraseña.
     - Su documento del protocolo describe el lado Bluetooth como un módulo estándar de Bluetooth a puerto serie, tipo JDY/HM.
     - En el LEDCAR-02, bienvenida (puerta abierta), intermitente y freno son órdenes de la app.
     - Las cajas de puerta hablan con la caja central por una radio propia de 2,4 GHz, no por Bluetooth.
     - El README recuerda que la librería led-ble de Home Assistant ya implementa esa familia de protocolos.
   - Dificultad: media. Parecido: mismo tipo (FFE0/FFE1/FFE2, aunque con otros papeles).
   - Para ti: refuerza la idea de que los efectos de puerta y bienvenida necesitan cajas de puerta o tiras animadas. Y muestra que un ESP32 puede hacer de «app» para un kit de coche.

3. **Artículo de CSDN «车载氛围灯 BLE 通讯协议（以小程序源码为准）»**: https://blog.csdn.net/qq_41126242/article/details/156769850 [solo resultado de búsqueda; la página da error 521]
   - **Qué hizo:** reconstruyó el protocolo Bluetooth de una caja de luz ambiente de coche a partir del código de su mini-programa de WeChat, el mismo método que usaste tú. El protocolo es binario, con checksum y más de 30 comandos. El fabricante no se identifica.
   - Dificultad: media. Parecido: mismo tipo, pero de otro fabricante y con otro protocolo.

4. **Controlador iDeal LED inutilizado**: https://www.whizzy.org/2023-12-14-bricked-xmas/ [visto]. Repositorio: https://github.com/8none1/idealLED [visto]. Reseña en Hackaday: https://hackaday.com/2023/12/17/the-dark-side-of-hacking-xmas-lights-literally [visto]
   - **Qué pasó:**
     - El protocolo iba cifrado. Un colaborador encontró la clave en un artículo de Habr, donde otra persona la había sacado de la librería de la app con IDA. Con ella descifró las tramas.
     - Después el autor probó valores fuera de lo que usa la app: colores por encima del límite y efectos del 0 al 19.
     - Al llegar al efecto 12 el controlador se apagó para siempre: dejó de anunciarse por Bluetooth y nada lo recuperó. El autor sospecha un desbordamiento que corrompió el firmware, sin poder confirmarlo.
     - El repositorio avisa de no enviar valores fuera de rango.
   - Parecido: parecido (son luces de Navidad). Es la advertencia más directa para tu caso (ver §3).

5. **Controladores LED de casa en los que se identificaron piezas.** Usan el mismo método de capturar y reproducir.
   - **ELK-BLEDOM (arduino12):** protocolo `7E…EF` y desmontaje parcial (memoria EEPROM 24C02C, regulador HT7533, cristal de unos 12 MHz). El chip Bluetooth no se identificó. https://github.com/arduino12/ble_rgb_led_strip_controller [visto]
   - **JACKYLED:** el chip es un Telink TLSR8266, según lo impreso en él. La app del fabricante traía publicidad y analítica. No se volcó el firmware y el autor invita a otros a hacerlo. https://github.com/kquinsland/JACKYLED-BLE-RGB-LED-Strip-controller [visto]
   - **Govee H619A:** el chip es un Beken BK3269. El autor planea cambiar la placa por un ESP32 en vez de reprogramarla; solo existe la parte 1. Su método sirve para tu caja: leer lo impreso en los chips, mirar los documentos FCC y medir las salidas hacia las tiras con un analizador lógico. https://spezifisch.codeberg.page/posts/2023-03-13/govee-rgb-strip-h619a-part-1-investigation [visto]
   - **Govee H7312 (Raspberry Pi Magazine):** el chip es un Telink TLSR8267, con puntos de conexión UART y SWS sin soldar. La UART no transmitía nada y no se volcó el firmware. https://magazine.raspberrypi.com/articles/can-we-hack-it-an-rgb-light-kit [visto]
   - Dificultad: media. Parecido: parecido.

#### B2. Leer o reprogramar el firmware (solo en controladores de casa o en chips concretos)

Ninguno de estos casos es una caja de coche. Se incluyen porque son las herramientas que servirían si abres la caja y reconoces el chip.

| Si dentro hay… | Qué ha hecho la gente | Fuente |
|---|---|---|
| JieLi (杰理), logo «JL», p. ej. AC63xx | Kit de programación oficial (AC631N/632N/635N/636N/637N). Incluye el ejemplo «trans_data», que anuncia AF30. Su actualización inalámbrica va por el protocolo propio de JieLi (en el código, un servicio AE00) que tu caja no tiene | https://github.com/Jieli-Tech/fw-AC63_BT_SDK [visto] |
| | Herramienta de la comunidad para copiar y grabar la memoria por el modo de descarga del chip. Estado: AC635N (BR23) y AC636N (BR25) «Working»; AC632N (BD19) y AC630N (BD29) «unknown» | https://github.com/kagaimiq/jl-uboot-tool [visto] |
| | Cómo forzar el modo de descarga: por USB, con la clave 0x16EF por D+/D−; o por UART, con la clave 0x68AF, normalmente en el pin PB5 y solo en algunos chips. El chip también entra en ese modo si su memoria está vacía o dañada | https://github.com/kagaimiq/jielie/blob/main/isp/usb/usb-key.md [visto], https://github.com/kagaimiq/jielie/blob/main/isp/uart/uart-key.md [visto] |
| | El cifrado de la memoria es un cifrado de flujo sencillo. El comando «get chip key» del cargador USB devuelve la clave solo ofuscada, con un algoritmo y una clave fijos. Que se pueda deshacer es deducción nuestra | https://kagaimiq.github.io/jielie/misc/cipher.html [visto] |
| | Quarkslab copió el firmware de un reloj con JieLi AC6958 aprovechando un fallo de software y espiando la pantalla. Luego lo descifró y lo analizó, y publica un módulo para la herramienta de análisis Ghidra | https://blog.quarkslab.com/nerd-life-weeks-firmware-teardown-we-were-right.html [visto] |
| Telink TLSR82xx | Programador por un solo cable (SWS) que lee y escribe toda la memoria. Es la base de muchos firmwares libres. La página no habla de protección contra lectura | https://github.com/pvvx/TLSRPGM [visto] |
| | Firmware libre para termómetros Xiaomi, instalado por la actualización inalámbrica del fabricante (tu caja no tiene esa función) | https://github.com/atc1441/atc_MiThermometer [solo resultado de búsqueda] |
| Phyplus PHY6222 / Lenze ST17H66 | Copia completa (`rdwr_phy62x2.py -r rf fullflash.bin`) y grabación por puerto serie con un adaptador USB barato. Existe firmware libre (BTHome) | https://github.com/pvvx/THB2 [visto], https://github.com/pvvx/PHY62x2 [visto] |
| WCH CH582/CH573 | El firmware original estaba protegido contra lectura, así que la comunidad escribió uno nuevo desde cero (chapas LED Badge Magic) | https://gitea.kosmos.org/hueso/badgemagic-firmware/raw/branch/fix-compiler-warnings/CH582.md [visto], https://www.github.com/fossasia/badgemagic-firmware [solo resultado de búsqueda] |
| | Herramienta `wchisp`: `info` dice si la memoria está protegida, sin borrar nada. El README no documenta ningún comando para quitar la protección. Que exista uno que la quita **borrando** el chip solo aparece en resúmenes del buscador | https://github.com/ch32-rs/wchisp [visto] |
| Beken BK3431/BK3432 (como los kits Cardi) | Solo comentarios sueltos y sin verificar sobre un modo de descarga por UART. Otro usuario no consiguió activarlo | https://www.elektroda.com/rtvforum/topic4162759.html, https://www.elektroda.com/rtvforum/topic4131137.html, https://mitxela.com/forum/topic/beken-bk3231/3 [solo resultado de búsqueda] |
| Módulo tipo JDY-08 / HM-10 (TI CC2541) | Regrabado con el firmware HM-10 usando un Arduino como programador. Hay casos de módulos inutilizados | https://handiko.github.io/JDY-08-Reflash [visto], https://forum.arduino.cc/t/how-to-flash-genuine-hm-10-firmware-on-cc2541-make-genuine-hm-10-from-cc41/379343 [solo resultado de búsqueda] |
| Chip principal STM32F1 protegido | Ataque con una Raspberry Pi Pico que lee la memoria protegida. Avisa de que los chips de 2020 en adelante, o los no originales, quizá no sean vulnerables | https://github.com/CTXz/stm32f1-picopwner [visto] |
| STM32F0 protegido | Artículo académico: la protección se puede saltar a través del puerto de depuración | https://www.aisec.fraunhofer.de/content/dam/aisec/ResearchExcellence/woot17-paper-obermaier.pdf [solo resultado de búsqueda] |
| GD32F103/F130 protegido | Solo con un ataque invasivo, abriendo el encapsulado del chip | https://swarm.ptsecurity.com/gigavulnerability-readout-protection-bypass-on-gigadevice-gd32-mcus/ [solo resultado de búsqueda] |
| ESP8266 / BL602 (controladores Wi-Fi) | Regrabados con ESPHome, WLED u OpenBeken. Con un Magic Home que probablemente lleva BL602 todavía no se ha conseguido | https://margau.net/posts/2020-11-21-2h-led-hack [visto], https://github.com/scottrbailey/WLED-Utils/blob/33dbb7c3bcc143da08a5241d8cf26365f58a3c6f/sp511e_wled.md [solo resultado de búsqueda], https://www.elektroda.com/rtvforum/topic4058754.html [solo resultado de búsqueda], https://community.home-assistant.io/t/can-you-flash-this-magic-home-v2-5-led-strip-controller/945704 [visto] |

Dificultad de todo lo de B2: alta o muy alta. Hay que abrir, soldar, identificar las patillas y después entender un programa del que no hay código fuente. Parecido: parecido, o solo sirve de contexto. Además, a veces lo impreso en el chip está borrado con láser, como en una lámpara ELK-BLEDOM de Elektroda (https://www.elektroda.com/rtvforum/topic4174934.html [solo resultado de búsqueda]).

**Indicios de que tu caja podría llevar un chip JieLi** (son pistas, no pruebas):
- El ejemplo oficial «trans_data» de JieLi, un puente Bluetooth–puerto serie, anuncia AF30 pero sirve AE30, igual que tu caja anuncia AF30 y no lo tiene: https://raw.githubusercontent.com/Jieli-Tech/fw-AC63_BT_SDK/master/apps/spp_and_le/examples/trans_data/ble_trans.c [visto]
- Los radares Hi-Link HLK-LD2450 anuncian AF30 junto con la etiqueta «JLAISDK» (código 0x05D6), la misma que pone el kit de JieLi. Por eso se deduce que están hechos con él: https://github.com/mr-sparks/scent-assistant/issues/56 [visto]
- Un difusor de aromas chino (Aromely Aro Max) anuncia AF30, pero su hilo se contradice. Primero el mantenedor dice que las tramas van por el servicio AF30 y luego que su FFE0/FFE2 solo admite escritura sin respuesta. No sirve como coincidencia limpia: https://github.com/mr-sparks/scent-assistant/issues/4 [visto]
- Tu caja no lleva la etiqueta «JLAISDK» (usa el código 0x0103), así que el fabricante lo habría personalizado.
- El ejemplo Tencent LLSync de JieLi usa un FFE0 distinto, de 128 bits, así que tu caja no sigue ese ejemplo: https://raw.githubusercontent.com/Jieli-Tech/fw-AC63_BT_SDK/master/apps/spp_and_le/examples/ll_sync/ll_sync_profile.h [visto]
- Otra explicación posible es un módulo tipo JDY-16, que tiene servicio FFE0 y un modo WeChat (AirSync). Eso explicaría que anuncie FEE7. Pero en el JDY-16 FFE2 es la característica de configuración, los datos van por FFE1 y la app escribe en FFE3. Tu caja recibe las órdenes por FFE2 y no tiene FFE3, así que no encaja con su disposición por defecto: https://github.com/fawno/ATORCH-HiDANCE/blob/master/docs/modules/JDY-16 [visto]
- Ninguna fuente explica por qué anuncia FFF0 ni qué son sus datos de fabricante con el código 0x0103. Lo único que coincide es que los kits Cardi usan FFF0 como servicio.

### C. Sustituir el controlador o añadir algo que lea el coche

#### C1. Quitar la caja y poner un ESP32 que lea el coche y mueva las tiras

1. **ESP32 Ambient Lighting (Tesla Model X 2022)**: https://jaketheduque.github.io/ESP32-Ambient-Lighting/ [visto]. El código está en https://github.com/jaketheduque/ESP32-Ambient-Lighting.
   - **Qué hizo:** no compró ningún kit comercial. Movió con una placa propia unas tiras animadas de AliExpress (WB2815). Hay una animación al arrancar, y las tiras se apagan cuando el coche pone a 0 el brillo de la luz ambiente. El escalado del brillo todavía no está hecho.
   - **Cómo:**
     - ESP32-WROOM-32E con el controlador CAN interno y un transceptor SN65HVD230, a 500 kbps, en una placa propia. Se conectó al CAN de chasis en el conector X126 de la centralita de Autopilot.
     - Página web por Wi-Fi para elegir el color, y actualizaciones por Wi-Fi.
     - Buscar los mensajes a ciegas le funcionó mal. Lo que funcionó fue una lista hecha por la comunidad: 0x3F5 (estado de luces y brillo de la pantalla) y 0x3B3 (estado de la interfaz).
     - Quemó tres tiras por equivocarse de tensión.
   - Dificultad: alta. Parecido: parecido, pero es otro coche.

2. **TeslaAmbientLight (Tesla Model 3)**: https://github.com/alex-aprm/TeslaAmbientLight [visto]
   - **Qué hizo:** es el ejemplo más completo de «evento del coche → color»:
     - puerta abierta en rojo y barrido blanco al cerrarla;
     - barrido con el intermitente;
     - aviso de ángulo muerto en rojo o naranja;
     - azul con el Autopilot;
     - luz de pies blanca solo en P;
     - brillo según la pantalla.
   - **Cómo:**
     - Un ESP32 principal lee dos buses CAN, con chips MCP2515 o con el CAN interno, y manda el estado por Wi-Fi (UDP) a cuatro ESP32, uno por puerta.
     - Las tiras animadas usan Adafruit_NeoPixel; la luz de pies va por PWM, lo que sirve de referencia para tiras de color fijo.
     - Se alimenta de la toma de la consola, con fusible de 5 A.
     - Trae contraseñas de Wi-Fi y de actualización por defecto, que hay que cambiar.
   - Dificultad: muy alta. Parecido: parecido. Poner una placa por puerta conectada por Wi-Fi es una forma de añadir efectos de puerta que tu kit no tiene.

3. **NikoLight**: https://github.com/TheRealKasumi/NikoLight [visto]
   - **Qué es:** firmware libre (GPL-3.0) para ESP32 con hasta 8 zonas de LEDs animados tipo WS2812, 18 efectos, página web por Wi-Fi y actualizaciones por Wi-Fi. Pensado para Tesla Model 3/Y. El autor lo está reescribiendo.
   - **Cómo sabe lo que hace el coche:** **no lee el CAN**; lo deja como posible ampliación. Detecta la apertura y el cierre con un sensor en la luz de pies de fábrica.
   - Dificultad: media-alta (placa propia y tiras animadas). Parecido: parecido. El truco de la luz de pies es el atajo más sencillo para tener «bienvenida» sin descifrar el CAN.

4. **seat-canbus (Seat Ibiza 2013)**: https://github.com/jancoow/seat-canbus [visto]
   - **Qué hizo:** un Arduino Nano con MCP2515 que solo escucha el CAN de confort y nunca transmite.
     - Los botones del volante cambian color, modo y brillo.
     - Intermitente en naranja y freno en rojo.
     - Las tiras bajan de brillo con las luces encendidas.
   - Incluye scripts para buscar mensajes CAN que se podrían reutilizar en tu F32.
   - Dificultad: media. Parecido: parecido.

5. **laguna-ambient-lighting (Renault Laguna 2011)**: https://github.com/revidostudio/laguna-ambient-lighting [visto]
   - **Qué hizo:** ESP32 con MCP2515 conectado al OBD (pines 12 y 13, a 500 kbps) y tira WS2812B. Hace bienvenida al abrir la puerta, efecto con los intermitentes, despedida y un efecto según la velocidad. Tiene una app propia en Flutter.
   - Los mensajes CAN que usa están marcados como «Verify with sniffer!».
   - Dificultad: media. Parecido: parecido.

6. **Proyectos menores:**
   - **CAN-Reactive-LEDS:** un ESP32 en el OBD2 manda animaciones a otras placas por ESP-NOW. Proyecto inmaduro y sin coche indicado. https://github.com/earlynerd/CAN-Reactive-LEDS [visto]
   - **r/arduino, Tesla:** proyecto parecido; el autor quería además descifrar la radio de las cajas de puerta de un kit. https://nyc1.lr.ggtyler.dev/r/arduino/comments/1h3a83l/esp32arduino_ambient_light_for_tesla [solo resultado de búsqueda]
   - **r/led:** alguien quiere quitar el Bluetooth de su kit y ponerle un mando físico. No se sabe qué le respondieron. https://redlib.ssps.io/r/led/comments/1lbuo2r/making_an_led_controller_for_my_car [solo resultado de búsqueda]
   - **WLED en un coche:** activado con señales de 12 V cableadas, sin CAN y sin montaje terminado. https://wled.discourse.group/t/led-sequencer-for-vehicle-blinker-drl-brake-reverse/14519 [visto]

#### C2. Dejar la caja y mandarle órdenes con un ESP32, como si fuera el móvil

1. **ESPHome con una tira Bluetooth no compatible**: https://community.home-assistant.io/t/how-to-control-a-non-supported-ble-light-with-esphome/749821 [visto]
   - **Qué hizo:** un ESP32 con ESPHome se conecta a la tira (FFE0/FFE1) y le escribe las tramas capturadas de la app. En Home Assistant aparece como una luz RGB normal. El autor dice que le funcionó; nadie más lo confirma en el hilo.
   - El hilo pide apagar el Bluetooth del móvil antes. Que estas cajas solo admiten una conexión a la vez lo confirman otros proyectos: elkbledom, uniled y LotusLantern (sección D).
   - El mismo método está explicado en un blog: https://www-clihero-com.pages.dev/blog/making-cheap-tv-led-strip-smart-rack-light [visto]. Hace falta un ESP32; el ESP8266 no tiene Bluetooth.
   - Dificultad: baja-media. Parecido: parecido (misma familia de servicio Bluetooth). Es la receta que se puede aplicar directamente a tu caja, con tus tramas ASCII.

2. **led-ble-car**: su autor dice que hizo un ESP32 que sustituye a la app de un kit de coche LEDCAR. Es el único precedente en coche, sin CAN y con el código sin publicar (ver B1.2).

3. **esp32-BLE-led-controller**: https://github.com/siz-/esp32-BLE-led-controller [visto]. Un ESP32 con tres mandos giratorios hace de app para controladores chinos que usan la app LEDLAMP. No menciona coches ni CAN.

4. **ESPHome leyendo el CAN de un Jeep Grand Cherokee 2012**: https://community.home-assistant.io/t/esphome-can-bus-and-a-jeep-grand-cherokee-2012/758376 [visto]
   - **Qué hizo:** un ESP32 con MCP2515 y ESPHome. Cada mensaje del coche (puertas, marcha, acelerador) dispara una automatización. Encontró los mensajes abriendo las puertas de una en una.
   - **Problemas que tuvo:** el bus se caía unos 5 minutos después de arrancar el ESP32 con el coche encendido. Para enviar mensajes necesitó un adaptador de niveles.
   - Dificultad: media. Parecido: parecido.
   - Para ti: ESPHome puede leer el CAN y hacer de cliente Bluetooth a la vez, así que un solo ESP32 podría juntar esto con el punto 1. **Nadie lo ha publicado así**; es una propuesta.

5. **Adaptador de CAN a Bluetooth con ESP32 (Hackster)**: https://www.hackster.io/bhattvishal/can-to-bluetooth-low-energy-adapter-using-esp32-2a82bd [visto]
   - Es una pieza reutilizable. Ojo: lleva una resistencia de 120 Ω que **no** hay que poner si te conectas a un bus del coche.

#### C3. Piezas sueltas para un BMW (nadie lo ha hecho con luz ambiente en F30/F32)

| Qué es | Lo útil para ti | Fuente |
|---|---|---|
| Módulo CAN propio para un BMW E92 (con una placa Teensy 4.0). Lee cierre, puertas y bornes, y activa luces (warning, angel eyes) y otras funciones | Es el BMW más cercano a «eventos del coche → luces», aunque no hace luz ambiente. Es serie E: otros mensajes y sin CRC. Dificultad muy alta | https://github.com/superwofy/E9X-M-CAN-Integration-Module [visto] |
| Palanca de cambios de un F20 probada en banco. Documenta el CRC y el contador de sus mensajes. Según los códigos de avería, 0x12F = bornes (encendido) y 0x393 = control del brillo de la pantalla, ambos por el bus del tren motriz (PT-CAN) | Imitar mensajes exige calcular el CRC y el contador. Puede que 0x393 sea lo que sigue tu caja con el brillo del iDrive (no comprobado; en ese coche iba por otro bus) | https://projectgus.com/2022/07/bmw-f-series-gear-selector-part-three-success/ [visto] |
| Arranque remoto con Arduino en un F30. Otro participante se conecta a K-CAN2 en el mando iDrive | Es la única pista de que el conector del mando lleva K-CAN2 (500 kbps) | https://f30.bimmerpost.com/forums/showthread.php?p=28420233 [solo resultado de búsqueda; la página da 403] |
| Hilo «F Series Can Bus Hacking»: K-CAN va a 100 kbps y K-CAN2 a 500 kbps; el PDC está en K-CAN2; por el OBD solo pasa diagnóstico | Explicaría por qué la caja va al mando iDrive y no al OBD, y por qué reacciona al radar | https://www.bimmerfest.com/threads/f-series-can-bus-hacking.904318/ [solo resultado de búsqueda] |
| Librería de Arduino para un mando iDrive «posterior a 2004». Patillaje: 1 = +12 V, 2 = masa, 3 = CAN H, 4 = CAN L; 500 kbps (los mandos anteriores iban a 100) | Es el mismo conector de 4 pines que usa tu caja. No indica el chasis, así que hay que comprobarlo en el F32 | https://github.com/Autohome2/idrive-controller [visto] |
| Mando iDrive de un F44 manejado con un ESP32-C3 a 500 kbps | Es otra generación de mando, pero coincide en los 500 kbps | https://github.com/LeanWasTaken/iDrive [visto] |
| Pantalla con datos del K-CAN de un E92 (ESP32 + MCP2515) | El coche llenó el cuadro de errores hasta que el lector se puso en **modo solo escucha** | https://github.com/KUHLwasStolen/open-eye-drive-screen [visto] |
| Placa RejsaCAN-ESP32 | ESP32 con CAN y fuente para coche. Se apaga sola cuando baja la tensión, puede despertar con el CAN y la resistencia de terminación se desactiva cortando una pista. Su README no menciona BMW | https://github.com/MagnusThome/RejsaCAN-ESP32 [visto] |
| CAN de un Toyota Highlander leído solo escuchando para Home Assistant | Método para encontrar puertas, cierre y velocidad: hacer una acción cada 3–5 segundos y comparar. Avisa de que el modo solo escucha de algunos adaptadores falla sin avisar | https://community.home-assistant.io/t/project-decoding-my-toyotas-can-bus-from-scratch-to-rebuild-the-factory-app-read-only-in-ha/1020667 [visto] |
| ECUMaster (F30) y HP Academy (F22): enviar mensajes propios o copiados no funciona por el CRC y el contador (y, en el F22, quizá porque el emisor original sigue en el bus) | No intentes «engañar» a la caja repitiendo mensajes | https://community.ecumaster.com/t/2012-bmw-f30-canbus/6103 [visto], https://www.hpacademy.com/forum/canbus-communications-decoded/show/struggling-with-can-bus-message-injection-on-bmw-f-series-f22-240i/ [visto] |
| Arnés de BimmerWorld para tomar el CAN en F3x/F8x sin cortar cables, desde una caja de empalmes en el hueco de los pies del acompañante | Otro punto de conexión. La página no dice qué bus es; probablemente el del motor y la transmisión (suposición) | https://www.bimmerworld.com/Gauges-Data-Acquisition/Data-Cables-Harnesses/BimmerWorld-CAN-Tap-Harness-4-pin-F3X-F8X.html [visto] |
| Codificación con E-Sys para que aparezca el menú de color de la luz ambiente en un F30 con NBT | Si tu F32 tiene NBT, quizá la caja siga ese menú: el vendedor del kit F30 lo dice de su kit. La receta es de un solo usuario y no está verificada | https://f30.bimmerpost.com/forums/showthread.php?p=18117049 [solo resultado de búsqueda] |
| Puentes CAN en un E60 y un E70 (Arduino Due) | Son de la serie E; poco aplicables | https://github.com/petrunov/bmwcanbridge [visto], https://forum.arduino.cc/t/bmw-k-can-1-to-k-can-2/1162752 [visto] |

### D. Otros

**Integraciones de domótica para tiras Bluetooth de casa.** Todas trabajan solo con el protocolo, nunca con el firmware. Ninguna entiende las tramas ASCII `[..]` de tu caja.

| Proyecto | Familia de controladores y dato útil | Fuente |
|---|---|---|
| elkbledom (Home Assistant) | ELK-BLEDOM, MELK, LEDBLE, JACKYLED y otros. Solo admite una conexión (Home Assistant o la app). Incluye una guía para añadir modelos nuevos | https://github.com/dave-code-ruiz/elkbledom [visto] |
| led_ble, la integración oficial de Home Assistant, y su librería | Triones, LEDBLE, LEDBlue, QHM, Dream y otros. Hubo un fallo con los LEDBLE, ya cerrado | https://www.home-assistant.io/integrations/led_ble/ [visto], https://github.com/Bluetooth-Devices/led-ble [visto], https://github.com/home-assistant/core/issues/105338 [visto] |
| Triones / HappyLighting | Descripción del protocolo de referencia, un puente MQTT y una integración ya archivada | https://github.com/madhead/saberlight/blob/master/protocols/Triones/protocol.md [visto], https://github.com/8none1/pytrionesmqtt [visto], https://github.com/sysofwan/ha-triones [visto] |
| ELK-BLEDOM con la app duoCo | Captura del tráfico por radio con un sniffer nRF51822 | https://joshspicer.com/bluetooth-low-energy-home-assistant/ [visto] |
| Lotus Lantern (librería en Go) | Según el autor, algunas cajas cortan la conexión tras unas 3–10 escrituras seguidas (cifra aproximada) y solo admiten una conexión | https://pkg.go.dev/github.com/Rxflex/LotusLantern [visto] |
| Zengge / Magic Home | El estado de la luz viaja en el propio anuncio Bluetooth | https://github.com/8none1/lednetwf_ble [visto] |
| SP110E | También usa FFE0/FFE1/FFE2. Necesita una secuencia de inicio o se desconecta | https://gist.github.com/RufusVS/31e6d3de958e6a6357463bf79ff44556 [visto] |
| BanlanX / SP107E / SP110E | Una sola conexión a la vez | https://github.com/monty68/uniled [visto] |
| SP542E | FFE1 funciona como una «tubería» de puerto serie hacia el microcontrolador. Ignora las escrituras sin respuesta | https://xydac-com.pages.dev/blog/bridging-cloud-locked-led/ [visto] |

**Apps de otros fabricantes de luz ambiente:**
- **«风神氛围灯»**, de shenzhen ELK Technology: https://apps.apple.com/us/app/-/id1602187834 [visto]. Es una app para tiras RGB(W) que no menciona coches. Que sea del fabricante de los controladores ELK-BLEDOM se deduce solo del nombre.
- **LAMP&FRGN** (深圳睿志诚科技), app de luz ambiente de coche: https://apps.apple.com/tr/app/lamp-frgn/id1645508550 [visto]
  - Sus notas de versión mencionan «Fix OTA upgrade», es decir, arreglos en la actualización inalámbrica.
  - Un usuario pide la contraseña para volver a los ajustes de fábrica.
  - Algunos fabricantes sí actualizan desde la app; el tuyo no tiene esa función.

**Documentación de fondo sobre cómo están hechas estas cajas y qué chips llevan:**
- **Registros FCC con fotos internas** de cajas chinas de luz ambiente de coche (no ZYCELA): Shenzhen Xishi AL-T01 y Guangzhou Chihong H7. Las fotos internas dieron error 403 a los programas automáticos, pero cualquiera puede abrirlas en el navegador: https://fccid.io/2BW4AALT01 [visto], https://fccid.io/2A5CH-H7 [visto].
- **Feasycom** vende módulos Bluetooth para cajas de luz ambiente que se controlan con app o mini-programa de WeChat: https://www.feasycom.com/bluetooth-car-ambient-light/ [visto], https://www.feasycom.com/car-atmosphere-lamp-bluetooth-module.html [solo resultado de búsqueda].
  - BT618V, con TI CC2642R.
  - BT671C, con Silicon Labs EFR32BG21.
  - FSC-BT630, con nRF52832 (solo visto en el resumen).
- **Lenze ST17H66** ofrecido para luz ambiente de coche: https://blog.csdn.net/lenzetech/article/details/114434441 [solo resultado de búsqueda].
- **Práctica de laboratorio de la Universidad de Tongji:** un módulo Bluetooth nRF51822 manda las órdenes por UART a una placa de LEDs con su propio microcontrolador. https://vibcon.tongji.edu.cn/Upload/file/20221002/202210021850558815242.pdf [solo resultado de búsqueda].
- **Patente china** de una caja central con CAN y microcontrolador que manda órdenes por LIN a subcontroladores: https://patents.google.com/patent/CN209488863U/zh [solo resultado de búsqueda].
- **Proyectos caseros en CSDN** con STM32F407, CAN y PWM. Muchos parecen generados automáticamente, así que valen poco: https://blog.csdn.net/weixin_29188043/article/details/168720393 [solo resultado de búsqueda].
- **Vídeo de Bilibili** sobre instalar la luz ambiente original de BMW en un F30 (no es una modificación de kit): https://www.bilibili.com/video/BV1EMZRYuESp/ [solo resultado de búsqueda].
- **PhyOTA**, la app oficial de actualización de los chips Phyplus. No sirve con tu caja: https://apps.apple.com/id/app/phyota/id1492851629 [solo resultado de búsqueda].

## 3. Qué significa para tu módulo

### Lo que encaja con lo que ya ves

- **Teclas de favoritos de la radio, menú del iDrive y conexión al conector de 4 pines del mando:** lo hacen varios kits chinos para BMW de otros vendedores (fichas de incarpassion y el foro del i3), así que no es algo propio de ZYCELA.
- **Que no se vean la bienvenida ni los avisos de puerta e intermitente:** en otros kits del mismo tipo esos efectos necesitan cajas esclavas en las puertas (como en el G30) o cajas de puerta por radio (como en los LEDCAR). Encaja con que tu kit sea de color fijo (全彩). La etiqueta, con o sin «HC-», puede confirmarlo.
- **Que las reacciones estén fijas en el firmware:** el comentario del i3 sobre una tabla de colores que venía mal de fábrica apunta a lo mismo (solo visto en un resumen).

### Lo que sí podrías aplicar (de menos a más difícil)

1. **Seguir con tu app propia.** Es justo lo que hace la comunidad. Lecciones de otros:
   - Conéctate como lo hace la app del fabricante. En los kits Cardi, un tamaño de paquete (MTU) distinto al del fabricante hacía que la caja se quedara colgada tras un reinicio. El mini-programa de tu caja pide 120 en Android, así que lo más seguro es usar ese mismo valor y no dejar que el navegador negocie otro sin probarlo.
   - Deja un pequeño intervalo entre órdenes: algunas cajas cortan la conexión si reciben muchas seguidas.
   - Si una orden se ignora, prueba a enviarla como escritura con respuesta.
   - Solo admite una conexión: la app oficial y la tuya, o un ESP32, no pueden estar conectadas a la vez.
   - Prueba barata (es una suposición que hay que comprobar): comparar con nRF Connect los datos de fabricante del anuncio en distintos estados. En otras marcas esos datos cambian según el estado de la luz.

2. **Poner un ESP32 al lado de la caja que le mande órdenes con ESPHome.** Ventaja: no se abre la caja y se conservan sus reacciones de fábrica (radar, climatizador, botones).
   - **Activado por la luz de pies del coche** (como NikoLight, con un optoacoplador): por ejemplo, al abrir el coche le manda un `[06…]` con un color. No toca el CAN. Dificultad baja-media.
   - **Activado por el CAN** en el mismo conector del mando iDrive, **solo escuchando**. Tendrías que descubrir tú mismo los mensajes de puertas, cierre y velocidad del F32, porque no se encontró ninguna lista pública. Dificultad media-alta.
   - **Límites:** con tiras de color fijo solo puedes cambiar el color y el brillo de las zonas; no habrá animaciones de puerta. Mientras el ESP32 esté conectado, el móvil no puede conectarse.
   - Nadie lo ha publicado con el CAN; sería combinar piezas que ya funcionan por separado. Que un ESP32 controle un kit de coche por Bluetooth solo lo ha contado el autor de led-ble-car, sin publicar el código.

3. **Sustituir la caja por un ESP32 propio**, como en los proyectos de Tesla. Dificultad alta.
   - Con tiras de color fijo harían falta canales PWM con transistores MOSFET por zona. TeslaAmbientLight ya usa PWM para la luz de pies.
   - Perderías la app y todas las reacciones actuales, salvo que las vuelvas a programar.
   - Mide la tensión de las tiras antes de conectar nada.

4. **Abrir la caja solo para mirar.** Sirve para decidir qué hacer. Busca:
   - Lo impreso en los chips: logo «JL» o AC63xx, Telink, PHY62xx, ST17H66, CH58x o Beken. Puede estar borrado con láser.
   - Un segundo chip, un controlador CAN (por ejemplo MCP2515) y un transceptor CAN.
   - Puntos de conexión marcados como UART, SWD o SWS.
   - Una posible memoria EEPROM 24Cxx.

   Ninguna fuente muestra cómo está hecha por dentro esta caja ni otra igual. Las tramas ASCII entre corchetes y los anuncios que no corresponden a servicios reales sugieren un puente Bluetooth–puerto serie hacia otro chip, pero también podría ser un solo chip Bluetooth con un controlador CAN aparte. Si hay dos chips, reprogramar el Bluetooth no cambiaría cómo reacciona al coche, porque eso lo decidiría el otro chip, que probablemente estará protegido contra lectura (suposición).

5. **Volcar o reprogramar el firmware.** Dificultad muy alta, y nadie lo ha hecho con una caja de coche.
   - Si el chip resulta ser un JieLi AC635N/AC636N, hay una herramienta que funciona en esos modelos. Con el AC632N está sin comprobar.
   - Aunque consiguieras la copia, cambiar las reacciones exige entender un programa sin su código fuente o escribir uno nuevo entero, como hicieron con las chapas LED CH582. Eso es tanto trabajo como la opción 3.

6. **Pedírselo al fabricante.** ZYCELA dice que adapta las cajas de control a cada cliente. El contacto está en https://zycela.com/support/. No hay garantía de que conteste.

### Riesgos

- **Inutilizar la caja con órdenes desconocidas.** Le pasó al controlador iDeal LED tras recibir valores que la app nunca envía. Tu caja no se puede actualizar por Bluetooth, así que si se estropea su programa o su configuración no hay arreglo sin abrirla y sin tener una copia previa. No pruebes valores al azar, sobre todo con los comandos de fábrica (`[2101]`, `[20…]`, `[4200]`).
- **CAN del coche:**
  - Siempre en modo solo escucha; si no, aparecerán avisos en el cuadro. Comprueba que tu adaptador lo cumple de verdad.
  - No pongas la resistencia de 120 Ω.
  - Vigila el consumo con el coche parado y el problema de arrancar a la vez que el coche.
  - No envíes mensajes: muchos de la serie F llevan CRC y contador.
- **Abrir la caja:** puedes perder la garantía. Además, intentar quitar la protección de un chip protegido puede borrar su programa. En los chips WCH, la herramienta `wchisp` permite comprobar antes, sin borrar nada, si está protegido.
- **APK del fabricante:** el enlace oficial apunta a un dominio aparcado; no instales nada desde ahí.
- **Codificar el coche** para que aparezca el menú de luz ambiente: guarda antes una copia de la codificación original. La receta no está verificada.

### Lo que no aplica

- **Actualizaciones por Bluetooth** (Telink, Phyplus/PhyOTA, JieLi, la de LAMP&FRGN): tu caja no tiene servicio de actualización.
- **Integraciones de Home Assistant existentes** (elkbledom, led_ble, uniled y similares): usan otros protocolos.
- **Comandos de open-cardi, led-ble-car o el artículo de CSDN:** son de otros protocolos.
- **Mensajes CAN de Tesla, Seat, Renault, Jeep, Toyota o BMW de la serie E:** no sirven en el F32.
- **Reprogramaciones fáciles con ESPHome, WLED u OpenBeken:** solo funcionan en controladores Wi-Fi con chips ESP8266 o BL602.
- **Leer el modelo leyendo una característica** (el truco de la caja duoCo): en tu caja FFE1 y FFE2 no se pueden leer.
- **Repetir mensajes CAN para que la caja reaccione a algo:** el CRC y el contador lo impiden.

## 4. Lo que no se encontró

- **Nada de terceros sobre ZYCELA, 中雅车联, ZYCL-FWD, el mini-programa 氛围灯控制程序, su appid ni la contraseña 1689.**
  - Búsquedas probadas, entre otras: «中雅车联 氛围灯», «深圳市中雅车联科技有限公司», «"ZYCL-FWD"», «ZYCELA ambient light», «"wx4354b0b9d0c999a0" OR "氛围灯控制程序"» y «ambient light app "factory settings" password "1689"».
  - Se buscó en el buscador general, en Bing en chino y en el buscador interno de CSDN.
- **Códigos de producto:** HC-BM01D y BMPJ09 no dieron nada. HC-BM03M y BM03M solo aparecen en la web de ZYCELA. ZY45542 no se llegó a buscar.
- **Ningún desmontaje de una caja de luz ambiente de coche con los chips identificados.**
  - En chino: «氛围灯 控制盒 拆解 主控芯片», «汽车氛围灯 控制盒 刷固件 程序».
  - En inglés: «car ambient light controller teardown BLE chip MCU CAN transceiver», fotos internas FCC y STM32/GD32/CH32 dentro de estos kits.
  - En Bilibili, «氛围灯 主机 拆解» dio 42 vídeos, todos de instalación o publicidad.
- **Ningún volcado, reprogramación ni firmware a medida** de ninguna caja china de luz ambiente de coche, ni de ELK-BLEDOM, Triones, LEDBLE, SP110E o SP107E. Tampoco firmware para revendedores («氛围灯 控制器 定制程序 客户编码»).
- **Ninguna herramienta probada para los Beken BK3431/BK3432.**
- **Ningún proyecto de luz ambiente que use el K-CAN de un F30/F32 ni de otro serie F.**
  - Se buscó en GitHub, BimmerPost, Hackaday, Hackster e Instructables, y también en alemán y en chino. BimmerPost, Reddit y Bimmerfest no se pudieron abrir, así que el resultado negativo es débil.
  - No hay ninguna lista pública de mensajes de la serie F para puertas, cierre, brillo o velocidad.
  - 0x2FC y 0x130 solo aparecen para la serie E, y 0x1A1 no aparece en ninguna parte.
  - Solo se confirmó, de forma indirecta y en el bus del tren motriz de un F20, que 0x12F son los bornes (encendido).
- **No se encontró ningún proyecto publicado que una el CAN de un coche con un controlador LED Bluetooth comercial.**
- **Ninguna integración de ESPHome o Home Assistant para tramas ASCII `[..]`**, ni ninguna extensión de WLED que lea el CAN.
- **Nada explica** el FFF0 anunciado ni los datos de fabricante 0x0103 + `FFFF FFFF FFFF 6600 0108 00`.
- **Ningún esquema oficial confirma** el bus ni el patillaje del conector del mando iDrive en el F30/F32.
- **YouTube y Hackaday:** ningún vídeo con descripción útil ni ningún artículo de Hackaday sobre kits de luz ambiente de coche.

**Lo que no se pudo consultar:**
- **Páginas bloqueadas** (en la revisión se volvió a intentar con algunas y siguieron fallando):
  - Reddit y sus espejos, BimmerPost (403), BimmerForums y Spoolstreet.
  - Bimmerfest (muro de pago).
  - mybmwi3 (403) y MBWorld, tras una comprobación anti-robots que no se intentó saltar.
  - Artículos de CSDN (error 521) y Bilibili (error 412).
  - Baidu (cortaba la conexión); Sogou y DuckDuckGo (CAPTCHA, no se intentó saltar); Bing (no da resultados a programas automáticos).
  - Elektroda (tiempo agotado), las fotos internas y los informes de la FCC (403), la web de PT Swarm, el artículo de harsh.ink (404) y el archivo Wayback.
- **Búsquedas pendientes:** se agotó el cupo de búsquedas compartido, también para la revisión. Quedaron sin hacer:
  - Foros y tiendas chinas: 52pojie (吾爱破解), elecfans (电子发烧友), 21ic, oshwhub (立创开源), Taobao, 1688 y Zhihu.
  - El código ZY45542 y el nombre «SV», que usa el canal de YouTube del fabricante.
  - Los nombres de chips junto a 氛围灯 (PHY6222, ST17H66, BK3432, CH582, TLSR825x).
  - «"af30" jieli».
  - ConSmart/Cardi en BMW F30.
  - La lista de módulos del K-CAN y K-CAN2 del F30.
  - Las opciones de luz ambiente de BimmerCode para F30/F32.
  - Varias búsquedas en GitHub (ledble, elk-bledom, triones, happy lighting, duoco).
  - «ESP32 CAN bus send BLE commands to aftermarket LED kit».

  Se pueden retomar en otro mensaje.
