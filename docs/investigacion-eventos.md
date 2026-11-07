> Informe de la investigación del 2026-11-06 (cuatro investigaciones en paralelo y una síntesis). Las rutas `C:/Users/.../Temp/...` que se citan eran archivos de trabajo temporales y pueden haber desaparecido; las fuentes web van enlazadas.

# Módulo ZYCELA en el BMW F32: qué hace, por qué falla la bienvenida, por qué baja la luz y cómo tener un color por estado

**Cómo leer este informe**
- **[C]** significa CONFIRMADO, con la fuente al lado.
- **[H]** significa HIPÓTESIS: falta probarla en el coche.

**Fuentes que se citan:**
- **AS nnnn**: el código del mini-programa del fabricante (`pretty/app-service.js`), con el número de línea.
- **manual G38**: el manual del fabricante para el BMW G38 (`zyres/ae_2.jpg`, `ae_4.jpg`). Lo he revisado yo.
- **manual F30–F36**: el manual del fabricante en manuals.plus que cita el informe *vendor-web*. No he podido volver a abrirlo porque la web devolvió un error 403.
- **F30 GVE**: un documento de formación técnica de BMW. He revisado yo el esquema de la p. 4.
- **traza F11**: una grabación real de la red de datos de un BMW F11, citada por el informe *bmw-f32*.
- *mini-programa*, *vendor-web*, *bmw-f32* e *iphone* son los cuatro informes de partida.

Algunos datos los he comprobado yo directamente. En esos casos pongo "verificado".

---

## Resumen

1. **El módulo sí está pensado para reaccionar al coche, pero no se lo cuenta al móvil.** Su protocolo no tiene ningún mensaje del tipo "se ha abierto una puerta" o "el motor está en marcha". Por eso la app no ve nada, aunque el módulo por dentro reaccione.
2. **Bienvenida.** Hay tres sospechosos principales:
   - la bienvenida solo se dibuja en las tiras "animadas", y el modo que tienes elegido es de "4 puertas" en un coupé;
   - un problema de momento: el módulo se apaga cuando el coche se duerme;
   - una diferencia concreta con la configuración del fabricante: el interruptor de funciones nº 8. El fabricante lo trae encendido y el tuyo está apagado.
3. **La luz que baja al arrancar** es casi seguro la opción del propio módulo "夜间行驶中控亮度减半" (de noche y conduciendo, consola a la mitad de brillo), que tienes activada. Se confirma con una prueba de 2 minutos.
4. **Un color con contacto y otro con el motor en marcha:** el módulo no tiene ese ajuste. Hay salidas:
   - **Manuales, de un toque y gratis:** los botones de favoritos de la radio, o un botón del volante "aprendido".
   - **Semimanual:** botones de escena en la app.
   - **Automática de verdad:** un pequeño ESP32 en el coche que lea la red de datos.
5. Hay un plan de pruebas de unos 15 minutos en la sección 5.
6. Probar comandos sin documentar a ciegas no compensa (sección 6).

---

## 1. Qué hace el módulo por dentro y por qué no se lo cuenta al móvil

### 1.1 Está conectado a la red de datos del coche

Los coches modernos tienen una "red de datos interna" llamada **CAN**. Por ella las centralitas se avisan de todo: puertas, contacto, motor, luces, intermitentes. El "cable de protocolo" (协议线) del kit se engancha a esa red.

- **[C] El fabricante conecta el kit en el conector de 4 pines del mando del iDrive.** En el manual G38 dice "氛围灯电源线与档位大旋钮4P电源线转接" ("empalmar el cable de alimentación del kit con el cable de 4 pines del mando grande"), verificado en `ae_2.jpg`. Según *vendor-web*, el manual F30–F36 indica lo mismo en las pp. 9–10.
- **[C] En el F30, el mando del iDrive (CON) cuelga de la red llamada K-CAN**, la misma del climatizador (IHKA). Fuente: esquema de la F30 GVE, p. 4, verificado.
- **Hay una contradicción entre fuentes.** Un tutorial chino (Bilibili, citado por *vendor-web*) dice que en el mando llega la red K-CAN2, y el esquema oficial de BMW dice K-CAN. A efectos prácticos da igual.
- **[C en un F11 / H en tu F32] Por esas redes viajan los mensajes clave:**
  - estado de contacto y motor (mensaje `0x12F`, con valores "desbloqueado", "contacto", "motor en marcha", "conduciendo");
  - puertas (`0x2FC`);
  - botones de la llave (`0x23A`);
  - regulador de luz del cuadro (`0x202`);
  - luces (`0x21A`);
  - intermitentes (`0x1F6`).

  En la traza F11 aparecen en las tres redes (*bmw-f32*). Es decir, el módulo tiene acceso a todo lo que haría falta.
- **[C en el foro / H en tu coche] El pin 1 de ese conector sería "30B"**, una alimentación que el coche solo da mientras está "despierto" (*vendor-web*, foro bimmerfest).

### 1.2 Qué hace con esos datos

- **[C] Funciones que el fabricante declara para tu código de coche (`01000010`):** seguir las luces del coche, aviso de puerta abierta, radar, exceso de velocidad, intermitentes y aire acondicionado. El ángulo muerto no está (tabla del fabricante, p. 2).
- **[C] El módulo sabe qué eventos admite tu coche.** En la trama de ajustes `26` marca con `FF` lo que el coche no admite. En la tuya el ángulo muerto es `FF` y el resto vale `00`/`01` (AS 4994-5000, verificado).
- **[C] Aprender un botón del volante tiene tres respuestas posibles:** "学习成功 / 学习失败 / 不支持该功能" (aprendido / fallo / no admitido) (AS 4519-4530). **[H, fuerte]** Para aprender un botón tiene que estar leyendo la red del coche.
- **[C] El fabricante documenta control desde los botones de favoritos de la radio y desde el menú del iDrive.** En el manual G38 (`ae_4.jpg`, verificado): "触摸数字4切换模式 / 5、6切换颜色 / 7、8切换亮度" (tocar el 4 cambia el modo, el 5 y el 6 el color, el 7 y el 8 el brillo). El mismo manual muestra en el iDrive la opción "在夜间行驶时调暗" (atenuar en conducción nocturna).
- **[C] Tu propio experimento:** al arrancar la luz baja, pero los brillos guardados (9/9/4) no cambian. **[H]** Algo dentro del módulo reacciona y no lo refleja en lo que informa (sección 3).

### 1.3 Por qué no se lo cuenta al móvil

- **[C] El protocolo no tiene mensajes de eventos.** Las únicas respuestas que la app del fabricante sabe leer son `1F`/`4E` (estado), `13` (versión), `26` (ajustes), `27` (secuencias), `2E` (resultado de un ajuste), `17`, `18`, `23`, `25`, `4F` y `58` (modo fábrica). Ninguna trae puertas, contacto ni motor (AS 2471-2487 y 4519-4566).
- **[C] No hay pantallas ocultas.** El código contiene las mismas 8 pantallas que se ven en la app (*mini-programa*). La app de iOS del fabricante tiene las mismas pantallas, según las capturas de la App Store (*vendor-web*).
- **[C] La app del fabricante nunca pregunta el estado de forma periódica.** Solo envía `[0A01]` al conectar (AS 2468).
- **[C] Tu experimento de 10 pasos lo confirma:** no llegó ninguna notificación espontánea, y las tramas fueron idénticas en todos los pasos.
- **[C] La app del fabricante solo escucha el canal de notificaciones FFE1** (AS 2461, verificado). Tu módulo también ofrece notificaciones en FFE2 (`protocolo-zycela.md` §6). **[H]** Es poco probable, pero quizá la depuración `[3702]` salga por FFE2. Probarlo no cuesta nada (apéndice).
- **[H] Cómo está montado por dentro, probablemente:** el chip Bluetooth (de Lenze, fabricante de chips Bluetooth) hace de "cable inalámbrico" hacia un microcontrolador aparte. Ese microcontrolador lee el coche y solo contesta a lo que se le pregunta.

**Conclusión.** No es que el módulo no haga nada: es que no lo cuenta. Aun así, en tu coche todavía no hemos visto una prueba directa de que lea la red. El paso 2 del plan lo comprueba.

> **Actualización 2026-11-07. [C] Confirmado en tu coche: el módulo lee la red.**
> - **Radar:** al activar el aviso de radar (`[3201]`), con marcha atrás las tiras parpadean de verde a rojo según la distancia. Con el aviso desactivado (`[3200]`) no hay efecto.
> - **Luz de noche:** la consola a mitad de brillo de noche funciona.
>
> Por tanto, el cableado y el código de coche están bien:
> - de las sospechas de la sección 2 queda descartado que no lea la red;
> - la hipótesis 1 de la sección 3 sobre la bajada de brillo gana fuerza.
>
> Ver `protocolo-zycela.md` §6.

---

## 2. Por qué puede no funcionar la bienvenida

**Lo que sabemos con seguridad:**
- **[C] Solo hay tres ajustes:** activar o desactivar (`[30]`), el modo (`[39]`, 6 modos) y el color (`[38]`). No existe ningún comando para elegir el disparador, la duración ni para "probar la bienvenida" (AS 4961-4991).
- **[C] El manual de la app del fabricante llama a ese interruptor "幻彩迎宾开关"** (interruptor de bienvenida de las tiras **animadas**) (`amz.pdf`, fig. 7, verificado).
- **[C] Ningún documento del fabricante dice qué la dispara.**

Las hipótesis, de más a menos probable:

### H1. El modo elegido no encaja con tus tiras o con un coupé
- **Pruebas a favor:**
  - [C] la bienvenida solo usa las tiras animadas (幻彩);
  - [C] tu modo es el 5, "4门同步③" (4 puertas a la vez ③), y el F32 tiene 2 puertas;
  - [C] tus tiras animadas están ahora en el efecto 24, "单色 同步RGB" (un color, igual que el resto), así que quizá nunca las has visto animarse.
- [H] Si en el sitio donde el modo dibuja no hay tiras animadas, o están mal configuradas, no se ve nada.
- **Prueba:** pasos 1 y 6 del plan. El paso 1 enseña qué tiras se mueven. El paso 6 prueba el modo 0 (salpicadero) y el modo 1 (puertas).

### H2. Problema de momento: el módulo está apagado cuando debería actuar
- **Pruebas a favor:**
  - [C] el fabricante alimenta el kit desde el conector del iDrive;
  - [C en el foro, H en tu coche] esa alimentación es la 30B;
  - [C] BMW corta la 30B 30 minutos después de cerrar si el cierre no es el doble (o 1 minuto con doble cierre) (BMW F01 Energy Management, pp. 17-20, vía *bmw-f32*);
  - [C] en tu experimento el Bluetooth se cortó unos 30 minutos después de bloquear.
  - *vendor-web* citaba "1 minuto" de una fuente de la serie E. El documento F01 es más preciso.
- [H] Hay dos variantes:
  - **(a)** La bienvenida se dispara con el mensaje de "desbloqueado", pero el módulo arranca justo en ese instante y se lo pierde.
  - **(b)** La bienvenida es la animación de arranque del propio módulo. Entonces solo se vería tras un sueño completo del coche, nunca en un cerrar y abrir rápido como el de tu experimento.
- **Prueba:** paso 6 (módulo despierto) frente al paso 8 (tras 40 minutos o más cerrado).

### H3. El interruptor de funciones nº 8 está apagado y el fabricante lo trae encendido
- **Pruebas a favor:**
  - [C] en el manual G38 el dial de funciones aparece con el **interruptor 8 encendido** y la nota "功能拨码不动" ("no toques el dial de funciones") (`ae_2.jpg`, verificado);
  - según *vendor-web*, el manual F30–F36 (p. 7) muestra lo mismo para tu mismo código de coche (no lo he podido volver a comprobar);
  - el tuyo está en `00000000` (`mi-configuracion.md`).
- [H] No se sabe qué hace ese interruptor.
- **Prueba:** paso 7.

### H4. El módulo no está leyendo la red en tu coche
- Por ejemplo, el cable de protocolo está suelto o mal empalmado. Esto explicaría a la vez la bienvenida y cualquier otra función que no reaccione.
- **Prueba:** paso 2.

### H5. Condiciones extra
- Por ejemplo: que solo funcione a oscuras, solo al abrir la puerta, o que dependa de la "luz de bienvenida" del propio coche. Para esto no hay pruebas concretas [H].
- [C] BMW tiene luces de bienvenida al desbloquear (manual de usuario del Serie 3 2013, pp. 87-91, vía *bmw-f32*).
- **Prueba:** paso 5 (activar la "luz de bienvenida" en el iDrive) y paso 6 hecho al atardecer y abriendo la puerta.
- Al aviso de puerta abierta (rojo al abrir) se le atribuyó un posible conflicto (*mini-programa*, [H]). En el paso 6 se apaga temporalmente para descartarlo.

### H6. Código de coche equivocado: probabilidad baja
- El fabricante usa tu mismo código, `01000010`, para F30–F36 (*vendor-web*).
- El informe *iphone* sugería probar `01000011` y `01000100`. **Lo descarto:** según *bmw-f32* son para la serie G (otra electrónica) y para el iDrive antiguo CIC, que el F32 no llevó.
- La única alternativa razonable sería `01000001`, y solo como último recurso.

---

## 3. Por qué bajan las luces al arrancar

**Lo que sabemos:**
- **[C]** Tienes activada `[1A01]`, cuyo texto es "夜间行驶中控亮度减半", es decir, "**de noche y conduciendo**, consola a mitad de brillo" (`chunk_2.webview.js:30`).
- **[C]** El control está en "原车 + 手机" (coche + móvil) (`[5100]`).
- **[C]** Al arrancar, los brillos guardados no cambiaron.

Las hipótesis, de más a menos probable:

1. **[H, la más probable] La regla "de noche y conduciendo" del propio módulo (`[1A]`).** Si el módulo entiende "conduciendo" como "motor en marcha", la luz baja justo al arrancar, que es lo que ves. El concepto es el mismo que la opción del iDrive "atenuar en conducción nocturna" (manual G38, `ae_4.jpg`).
2. **[H] El módulo copia la atenuación del propio coche** porque el control está en "coche + móvil". Esto lo debilita algo: según *bmw-f32* [H], en BMW las luces y el regulador cambian **al dar el contacto**, no al arrancar.

   Aquí hay una **contradicción**: el informe *iphone* supone que "las luces se encienden al arrancar". En tu experimento las luces de cruce fueron un paso posterior, así que probablemente estaban apagadas al arrancar [H].
3. **[H, débil] Un efecto eléctrico.** Con el motor en marcha la tensión sube a unos 14 V, y eso daría más brillo, no menos.

**Observación gratis:** fíjate si al arrancar bajan **solo las tiras del salpicadero o consola**, o **todas**. Si bajan solo esas, apunta a la hipótesis 1.

**La prueba que las distingue** es el paso 3 del plan: primero `[1A00]` y arrancar, luego `[5101]` y arrancar.

| Resultado | Conclusión |
|---|---|
| Con `[1A00]` ya no baja | Es la regla del módulo (hipótesis 1). Si te molesta, déjala en `[1A00]` |
| Solo deja de bajar con `[5101]` | El módulo sigue la atenuación del coche (hipótesis 2). Revisa en el iDrive si está activada "atenuar en conducción nocturna" |
| Baja en ambos casos | Ni lo uno ni lo otro: sospecha eléctrica o una regla desconocida |

Esto **ya es un cambio automático ligado al motor**, aunque solo de brillo, no de color. Si la hipótesis 1 se confirma, es la única reacción "motor en marcha" que el módulo ofrece de serie.

---

## 4. ¿Se puede tener un color con contacto y otro con el motor en marcha?

**[C] Dentro del módulo, no.** No existe ningún comando que asocie un color a "contacto" o a "motor"; está comprobado repasando todos los comandos. Los colores ligados a eventos que existen son los de puerta abierta, intermitente y ángulo muerto. La bienvenida daría un color durante unos segundos al desbloquear (si funciona), y eso probablemente dura poco [H].

| Opción | ¿Automático? | ¿Distingue contacto y motor? | Coste | Esfuerzo | Riesgos | Estado |
|---|---|---|---|---|---|---|
| **Botones de favoritos de la radio** (tocar el 5 o el 6, o pulsar 1+5) | No: un toque al arrancar y otro al aparcar | Lo decides tú | 0 | 1 minuto probarlo | Ninguno | Por probar (paso 4). Documentado por el fabricante [C en el G38] |
| **Botón del volante aprendido** (`[22]`, función "模式/颜色+", modo/color +) | No: una pulsación | Lo decides tú | 0 | 10 minutos | Medio: efecto desconocido sobre la función original del botón, y no se conoce otra forma de "desaprender" que restaurar de fábrica (`[4200]`) y reconfigurar con `mi-configuracion.md` [H] | Por probar |
| **Botones de escena en la app** ("Parado" y "Conduciendo") | No | Lo decides tú | 0 | Una tarde de programación | Ninguno | Factible ya: basta con enviar `[06RRGGBB]` [C] |
| **Atajos de iPhone + Bluefy** (`bluefy://open?url=…` [C]) | A medias: solo funciona con el móvil desbloqueado [C, foro de Apple] | **No.** Solo sabe "Bluetooth del coche conectado" (≈ contacto) o "en movimiento" (modo Conducción) [H] | 0 | Una tarde | Fallará a menudo, con el móvil bloqueado o en el bolsillo | Factible con límites |
| **App Bluetooth Inspector** (acción "Write Value" en Atajos) | Probablemente solo con el móvil desbloqueado [H] | No | 0 – 3,99 USD; requiere iOS 26 [C] | 15 minutos probarlo | Bajo | Por probar |
| **App nativa de iOS** | Sí, incluso con el móvil bloqueado [H] | No | 99 USD al año, o volver a instalarla cada 7 días | Varios días, sin Mac | Mantenimiento | Posible, pero cara para lo que da |
| **ESP32 en el coche** (una plaquita de unos 5 cm que lee la red de datos sin enviar nada y manda el color al módulo por Bluetooth) | Sí | **Sí**, leyendo el estado de contacto y motor (`0x12F`) [H en el F32] | Unos 15–30 USD [H] | Un fin de semana, incluido el cableado | Cableado en el coche (siempre con fusible y en modo "solo escuchar"), consumo con el coche parado, y que el módulo acepte una sola conexión a la vez, lo que puede chocar con el móvil [H] | La única solución completa |

**Recomendación:**
1. Primero el **paso 4** (favoritos de la radio): es gratis y no tiene riesgo. Si funciona, la solución más simple es tocar el 5 al arrancar y volver al color de "parado" al aparcar.
2. Si eso no funciona, el **botón del volante**, sabiendo el riesgo que tiene.
3. Si de verdad lo quieres **automático**, la única vía es el **ESP32**. Conviene hacerlo solo después de confirmar en el paso 2 que el módulo reacciona al coche, y de comprobar si el módulo sigue visible desde un segundo aparato mientras el móvil está conectado (si no lo está, solo acepta una conexión a la vez).
4. Mientras tanto, puedo añadir botones de escena a la app sin coste.

---

## 5. Plan de pruebas en el coche (unos 15 minutos)

**Antes de empezar:**
- Coche en un garaje o al atardecer, porque las animaciones se ven mejor.
- Mando de las luces en AUTO (apunta en qué posición estaba).
- La app conectada al módulo.
- Cada paso indica qué enviar, qué hacer, qué mirar, una pregunta de sí o no, y cómo dejarlo como estaba.

**Paso 0. Copia de seguridad (1 minuto)**
- **Enviar:** `[0A01]`. Guarda las tramas `4E`, `26`, `27` y `13`. Después `[2101]`, guarda las tramas `23`, `25` y `4F` (o `58`), y por último `[2100]`.
- **Comprobar:**
  - la `26` debe ser `[2601010000000101000504FF00FF]`;
  - la `4E` debe ser `[4E001801FF1000FF11010904010300090800]`;
  - la `23` debe tener el código de coche `01000010` y las funciones `00000000`.
- **Pregunta:** ¿coinciden? Si no, apunta las diferencias antes de seguir.

**Paso 1. ¿Hay tiras animadas y dónde están? (1 minuto)**
- **Enviar:** `[1E03]` (efecto "flujo").
- **Mirar:** si alguna tira muestra luz que se mueve a lo largo de ella.
- **Pregunta:** ¿se mueve alguna? ¿En el salpicadero? ¿En las puertas?
- **Restaurar:** `[1E18]`.
- **Si no se mueve ninguna:** la bienvenida no puede verse. El problema es de instalación (tiras animadas o cable "HC").

**Paso 2. ¿El módulo lee el coche? (2 minutos)**
- **Enviar:** `[3401]` (activa la reacción a los intermitentes) y `[4501]` (en amarillo).
- **En el coche:** pulsa START **sin pisar el freno** (solo contacto) y enciende las luces de emergencia.
- **Pregunta A:** ¿parpadea alguna tira en amarillo?
- **En el coche:** abre la puerta del conductor. El aviso de puerta ya está activado.
- **Pregunta B:** ¿la tira de la puerta se pone roja o parpadea?
- **Restaurar:** `[3400]` y `[4500]`. El color original del intermitente no se puede leer; `00`, rojo, es el valor por defecto, y no importa porque esa función está desactivada.
- **Si responde no a A y a B:** probablemente el módulo no lee la red (H4). Haz una foto de dónde va el cable de protocolo.

**Paso 3. La bajada de luz al arrancar (4 minutos)**
- **3a. Sin cambiar nada:** arranca (freno + START).
  - **Pregunta:** ¿bajan todas las tiras o solo las del salpicadero?
  - Apaga el motor.
- **3b. Enviar `[1A00]`.** Pulsa START sin freno, espera 5 segundos y arranca.
  - **Pregunta:** ¿sigue bajando la luz al arrancar?
  - **Restaurar:** `[1A01]`, o déjalo en `[1A00]` si prefieres que no baje.
- **3c. Enviar `[5101]`.** Repite lo mismo: contacto y arrancar.
  - **Pregunta:** ¿sigue bajando?
  - **Restaurar:** `[5100]`.
- La interpretación está en la tabla de la sección 3.

**Paso 4. Botones de favoritos de la radio (1 minuto)**
- **En el coche:** con contacto, toca sin apretar el botón 5, luego el 6. Después pulsa 1+5. Prueba también el 7/8 (brillo) y el 4 (modo).
- **Pregunta:** ¿cambia el color, el brillo o el modo del kit?
- **Restaurar:** `[0400]`, `[06ff1000]`, `[1E18]`, `[020009]`, `[010109]`, `[010204]`.

**Paso 5. Menú del iDrive (1 minuto)**
- **En el coche:** en el iDrive, entra en Ajustes y luego en Iluminación. Los nombres exactos varían según el equipo [H].
- **Pregunta A:** ¿hay luz ambiente, con color o brillo, o "atenuar en conducción nocturna"?
- Si hay brillo, cámbialo mientras miras el kit.
- **Pregunta B:** ¿el kit lo sigue?
- **Pregunta C:** ¿existe "luz de bienvenida" y está activada? Déjala activada para el paso 6.
- **Restaurar:** vuelve a poner los valores del iDrive como estaban (salvo la luz de bienvenida, si quieres).

**Paso 6. Bienvenida con el módulo despierto (3 minutos)**
- **Enviar:**
  - `[3900]`: envolvente de la consola, en el salpicadero;
  - `[3809]`: blanco, para que contraste con tu rojo;
  - `[3100]`: aviso de puerta desactivado temporalmente.
- **En el coche:** apaga el coche, sal, cierra y bloquea con la llave.
  - **Pregunta A:** ¿se apagan las tiras justo al bloquear (sí) o siguen encendidas (no)? Si se apagan al momento, es otra prueba de que el módulo lee la red [H].
- **En el coche:** espera 15 segundos, desbloquea y mira 10 segundos. Luego abre la puerta del conductor y mira otros 10 segundos.
  - **Pregunta B:** ¿ves luz blanca recorriendo alguna tira?
- **Si no la ves:** envía `[3901]` (envolvente de puertas) y repite.
- **Restaurar:** `[3905]`, `[3804]` y `[3101]`. No restaures todavía si vas a hacer el paso 7 o el 8.

**Paso 7. Interruptor de funciones 8 (opcional, 3 minutos; solo si el paso 6 no mostró nada)**
- **Enviar:** `[2101]`, espera la respuesta, luego `[200100001000000001]`, luego `[2100]`.
- **Comprobar:** `[2101]`; la trama `23` debe mostrar las funciones en `00000001`. Luego `[2100]`.
- **En el coche:** repite el paso 6 y, rápidamente, la pregunta B del paso 2.
- **Pregunta:** ¿aparece ahora la bienvenida? ¿Sigue funcionando el aviso de puerta?
- **Restaurar**, sobre todo si algo deja de funcionar: `[2101]`, `[200100001000000000]`, `[2100]`.

**Paso 8. Bienvenida después de que el coche se duerma (opcional, sin prisa: al día siguiente o tras 40 minutos)**
- **Ajuste:** el del paso 6 (`[3900]`, `[3809]`, `[3100]`).
- **En el coche:** bloquea y deja el coche 40 minutos o más (mejor una noche), con Bluefy cerrado. Al volver, desbloquea, mira, y abre la puerta.
- **Pregunta:** ¿aparece la animación blanca?
- **Cómo leerlo:**
  - si sale aquí y no en el paso 6, la bienvenida depende de que el módulo arranque (H2b);
  - si no sale en ningún caso, la causa es H1, H3 o H4.
- **Restaurar:** `[3905]`, `[3804]`, `[3101]`, o deja el modo que haya funcionado.

**Paso 9. Restaurar todo y comprobar**
- **Enviar, en este orden, los ajustes de uso:**
  `[3001] [3101] [3200] [3300] [3400] [3501] [1A01] [1400] [3905] [3804] [0400] [06ff1000] [1E18] [0B03] [0C00] [3E08] [020009] [010109] [010204] [030001] [5100]`
  y además los comandos que salen de la trama `27` guardada en el paso 0.
- **Comprobar:** `[0A01]`. Las tramas `4E` y `26` deben ser idénticas a las del paso 0.
- **Instalación:** solo si cambió algo, entre `[2101]` y `[2100]`:
  `[200100001000000000] [1C0050] [0F0050] [130050] [1D0050] [2C00] [2F00] [4801] [4901] [4A01] [4B01] [400123] [430000]`

**Opcional, fuera de los 15 minutos: aprender un botón del volante.**
- Antes de hacerlo, elige un botón que uses poco.
- **Enviar:** `[2101]`, luego `[2204]` (modo/color +), y pulsa ese botón en unos segundos.
- **Esperar la respuesta:** `[1700]` = aprendido, `[1701]` = fallo, `[1702]` = no admitido. Luego `[2100]`.
- **Comprobar:** con el motor en marcha, pulsa el botón. ¿Cambia el color? ¿Sigue haciendo lo que hacía antes?
- **Riesgo:** no se conoce cómo deshacerlo, salvo restaurar de fábrica y reconfigurar.

---

## 6. Comandos sin documentar o arriesgados

**¿Compensa probar comandos desconocidos? No.**
- Hay códigos sin usar entre `00` y `58`: `05 08 0D 0E 11 12 15 16 19 24 28 2D 36 3F 4C 4D 50 55 56 57` (*mini-programa*).
  - La lista de *vendor-web* incluía `15–19`, `1F` y `23–28`. Varios de ellos sí se usan, como `17`, `1F`, `23`, `25`, `26` y `27`, así que me quedo con la lista de *mini-programa*.
- No hay ninguna pista de que alguno de ellos sirva para "informar de eventos". Aunque existiera, habría que adivinar qué significa su respuesta.
- El riesgo es real: los códigos vecinos `[41]` y `[42]` son destructivos.

**Comandos que no hay que enviar:**

| Comando | Qué hace | Regla |
|---|---|---|
| `[41xx]` | "原车氛围灯界面开通 → 开始刷机" (activar el menú de ambiente original → empezar a flashear) | **Nunca.** Puede intentar reprogramar algo; para BMW no hay fila de flasheo [C] |
| `[42xx]` | Restaurar los ajustes de fábrica | **Nunca.** Borra la instalación |
| `[20…]` | Código de coche y dial de funciones | Nunca fuera del modo fábrica. Dentro, solo con valores conocidos y copia previa (paso 7) |
| `[43nnnn]`, `[40nnnn]` | Código de cliente y parámetro de la tira | Solo para restaurar tus valores guardados (`0000` y `0123`) |
| `[22xx]` | Aprender un botón del volante: empieza a escuchar en el acto | Solo con intención, dentro de `[2101]`…`[2100]` |
| `[21xx]` | Modo fábrica | Solo `[2101]`, siempre seguido de `[2100]` |
| `[1C]` `[0F]` `[13]` `[1D]` `[52]` `[2C]` `[2F]` `[48]`–`[4B]` `[53]` `[54]` | Número de LEDs y dirección de las tiras | Solo para restaurar |
| `[37]` con un valor distinto de `00` o `02` | Depuración | Riesgo bajo pero desconocido. `[3701]` solo dentro del protocolo de abajo |

**Si aun así quieres probar, este es el protocolo seguro [H]:**
1. Haz la copia del paso 0.
2. Coche despierto y motor apagado, fuera del modo fábrica.
3. La app debe registrar las notificaciones de FFE1 **y** FFE2.
4. Prueba primero la depuración: escucha FFE2, envía `[3702]`, luego `[3701]`, y termina con `[3700]`.
5. Prueba solo los códigos de la "zona baja" (`05 08 0D 0E 11 12 15 16 19 36 3F`), siempre con el valor `00` (`[XX00]`):
   - uno por minuto;
   - después de cada uno, espera 3 segundos, envía `[0A01]` y compara las tramas;
   - mira también las luces.
6. Excluye siempre `24`, `28`, `2D`, `4C` a `57` y todo el bloque `20–22` y `40–43`.
7. **Regla de parada:** si se corta la conexión, si llega `2E` con valor `02` (fallo), si llega una trama inesperada como `18`, `23` o `25`, o si las luces hacen algo raro, restaura de inmediato y para.
8. **Lo esperable:** que no pase nada. En el peor caso, habría que reconfigurar el módulo con `mi-configuracion.md`. En un caso extremo, el módulo podría quedar inservible.

---

## Appendix (English): Design notes for the app

**General command rules:** write frames to FFE2 one at a time, 80–150 ms apart, each 20 bytes or fewer. Data hex is lowercase, while the command code is literal (`[1A0`, `[3E`, `[0A01]`), as in the vendor app. Buffer received data until `]`.

1. **Settings snapshot and restore.**
   - Snapshot:
     - `[0A01]`, then collect `4E|1F`, `26`, `27`, `13` (3 s timeout);
     - `[2101]`, then collect `23`, `25`, `4F|58`, then `[2100]` (always in a `finally`);
     - store as JSON with a timestamp and the firmware version; offer export.
   - Restore generators (`s(i,n)` = substring of the frame text):
     - From `26`: `[30+s(3,2)]`, `[31+s(5,2)]` … `[35+s(13,2)]` (skip `ff`), `[1A+s(15,2)]`, `[14+s(17,2)]`, `[39+s(19,2)]`, `[38+"0"+s(22,1)]` (`f` → `[380f]`), `[1B+s(23,2)]` (skip `FF`), `[44+s(27,2)]` (skip `FF`).
     - From `4E`: `[04+s(3,2)]`, `[06+s(9,6).lower]`, `[1E+s(5,2)]`, `[0B+s(27,2)]`, `[0C+s(29,2)]`, `[3E+s(33,2)]`, `[0200+s(31,2)]`, `[0101+s(21,2)]`, `[0102+s(23,2)]`, `[0300+s(25,2)]`, `[51+s(35,2)]`.
     - From `27`: `[2A+s(3,8)]`, `[2B+s(11,2)]`, `[3A+s(13,8)]`, `[3B+s(21,2)]`, `[3C+s(23,2)]`, `[3D+s(25,2)]`.
     - Order: `27`, then `14`, then the `4E` items (`04` before `06`), then `26`. Finish with `[0A01]` and diff. Flag `4E` positions 15–20 if they differ, since this may be the zone-2 colour (`FF1101`, unknown).
     - Factory items (`[20…]`, `1C`/`0F`/`13`/`1D` counts in 4-digit decimal from `4F`, directions `2C`/`2F`/`48`/`49`/`4A`/`4B`, `40`, `43`): only on an explicit request, wrapped in `[2101]`…`[2100]`.
2. **Guided diagnostic ("Asistente de pruebas").**
   - Each step is `{id, title, needsFactory, apply[], instruction, observe, question, answers{yes,no → conclusionId}, restore[]}`, implementing steps 0–9 of section 5 with their exact commands.
   - Behaviour:
     - automatic snapshot before step 1;
     - a "Restaurar todo" button visible at all times;
     - `[0A01]` before and after each step, with the frames stored;
     - every FFE1/FFE2 notification logged;
     - the final report (answers, conclusions, frame diffs) exported as text.
   - Step 8 needs a 40-minute wait. The page cannot keep a timer in the background, so tell the user to set an iOS reminder.
3. **Notification capture.**
   - Call `startNotifications` on both FFE1 and FFE2 (each in try/catch).
   - Log a timestamp plus hex, ASCII and UTF-8 for every packet.
   - Debug buttons for `[3702]`, `[3701]` and `[3700]`.
4. **Welcome tester.**
   - "Visible" preset: `[3001][3900][3809][3100]`, with a restore to the snapshot values (`[3905][3804][3101]`).
   - Mode selector 0–5 with hints ("mode 0 = dashboard, needs HC strips on the main box; modes 3–5 assume 4 doors").
   - A test for the addressable strips: `[1E03]`, then restore `[1E1x]` from the snapshot.
5. **Factory dial editor with guard rails.**
   - Show the `23` bits; toggles produce a diff preview.
   - Send `[20`+car8+feat8+`]` only between `[2101]` and `[2100]`, with a forced snapshot first.
   - Read back `23` to verify; one-tap revert.
   - Annotate feature switch 8 with: "vendor manuals show it ON (功能拨码不动)".
6. **Steering-key learning UX.**
   - List the 5 functions (1 wake, 2 main effect mode, 3 sub-mode, 4 mode/colour +, 5 mode/colour −).
   - Confirmation modal (side effects unknown, no known unlearn except `[4200]` + reconfigure).
   - Sequence:
     - send `[2101]` and wait for `23`;
     - send `[22`+id+`]` and show a 10 s countdown ("press the wheel button now");
     - await `[17xx]`: 00 learned, 01 failed, 02 unsupported;
     - send `[2100]` in a `finally`.
   - Keep a local log of learned keys, since the module cannot report them.
7. **Scenes, URL parameter and auto-reconnect.**
   - Accept `?escena=<id>` and `/s/<id>/`. A scene is a command list, e.g. Parado `[0400][06ff1000]`, Conduciendo `[0400][06xxxxxx]`.
   - Flow:
     - `navigator.bluetooth.getDevices()`, filter on names starting with `ZYCL-FWD`;
     - optional `watchAdvertisements()` with a 10 s abort;
     - `gatt.connect()`, service `0xffe0`, FFE1 notifications;
     - write the scene, then `[0A01]` and verify the colour at `4E` positions 9–14;
     - `history.replaceState` to drop the parameter.
   - Re-apply on `visibilitychange`.
   - Fallback: a full-screen button calling `requestDevice({filters:[{namePrefix:'ZYCL-FWD'}], optionalServices:[0xffe0]})`.
   - Document the deep link `bluefy://open?url=<percent-encoded URL>` and test the unencoded and path forms too. Shortcuts recipes:
     - "car Bluetooth connected → Conduciendo";
     - "disconnected → Parado" (unreliable while locked);
     - Back Tap as a manual trigger.
8. **Console blocklist.**
   - Hard-block `41` and `42`.
   - Soft-block, with typed confirmation and an automatic snapshot: `20`, `21` (other than the 01/00 pair), `22`, `40`, `43`, and the install codes (`1C 0F 13 1D 52 2C 2F 48–4B 53 54`).
   - Enforce `^(?:[0-9a-fA-F]{2})+$` and a total length of 20 bytes or fewer.
9. **Optional zero-risk field probes** (each with diff and restore from the snapshot):
   - `[0700]` → `[0A01]` → `[0701]`, to see whether `4E` positions 7–8 hold the `[07]` power state;
   - `[4601]` → `[0A01]` → `[4600]`, to see whether `26` positions 25–26 hold the door colour.
10. **Single-connection check.** While the PWA is connected, scan from a second device. Record whether the module still advertises its name `ZYCL-FWD…`. This decides the ESP32 design.
11. **ESP32 bridge spec (later).**
    - Power from 30B through a fuse tap.
    - SN65HVD230 transceiver in listen-only mode on the same pair the kit uses. The F30 GVE shows the iDrive controller on K-CAN; 100 kbit/s is expected there [H], 500 kbit/s if the tap turns out to be K-CAN2 or PT-CAN.
    - Decode `0x12F` ST_VEH_CON (2 basic op, 5 ignition, 7/8 engine idle/driving). Use "drive-ready" rather than RPM, so that the automatic engine stop at traffic lights does not flip colours.
    - On a change: connect over BLE, write `[06RRGGBB]`, disconnect, and retry if the phone holds the link. Alternatively, a bridge mode that re-exposes FFE0.
12. **Additions to `protocolo-zycela.md`:**
    - FFE1 is the only channel the vendor app subscribes to;
    - debug console format and UTF-8 decoding;
    - `[07]` is never read back;
    - `26` positions 25–26 are unknown;
    - `2E` source unknown;
    - unused-code list;
    - `4E` positions 15–20 are unknown;
    - welcome is labelled 幻彩迎宾开关 (welcome on the addressable strips only);
    - vendor default feature dial `00000001`;
    - favourite-button control (4 = mode, 5/6 = colour, 7/8 = brightness; 1+N variants).

**Files:** the only scratch file I created is `C:/Users/ntuane/AppData/Local/Temp/zysyn/ae_dial_crop.png`, a crop of the vendor G38 manual showing the feature dial with switch 8 ON. Key sources:
- `C:/Users/ntuane/AppData/Local/Temp/zyres/ae_2.jpg`
- `C:/Users/ntuane/AppData/Local/Temp/zyres/ae_4.jpg`
- `C:/Users/ntuane/AppData/Local/Temp/zyres/amz_p7_crop.png`
- `C:/Users/ntuane/AppData/Local/Temp/bmwres/pdf/gve_p8.png` (F30 bus overview, document page 4)
- `C:/Users/ntuane/AppData/Local/Temp/wxre/pretty/app-service.js`