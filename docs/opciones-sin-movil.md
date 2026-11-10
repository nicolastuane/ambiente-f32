> Investigación del 2026-11-09, hecha con tu informe de «Pruebas del coche» (7–9/11): cinco investigaciones en paralelo (código del mini-programa, manuales del fabricante, web, nuestros datos e iDrive), una síntesis y una revisión crítica. Las rutas `C:/Users/.../Temp/...` eran archivos de trabajo temporales y pueden haber desaparecido.

# Luz ambiente del F32: qué está pasando y qué puedes hacer sin el móvil

Leyenda: **[C]** = comprobado (se indica la fuente). **[H]** = hipótesis, sin confirmar.
Esto se basa en tu informe del 7–9/11 y en cinco investigaciones: el código del mini-programa, los manuales del fabricante, la web, nuestros datos y el iDrive.

---

## 1. Qué dicen tus resultados

| Funciona | No funciona (todo con el interruptor 8 encendido) |
|---|---|
| Radar en marcha atrás: las tiras parpadean de verde a rojo **[C]** (informe:13) | Bienvenida, modos 0 y 1 **[C]** (informe:14-15, 39) |
| Climatizador: al cambiar la temperatura, las tiras cambian de color **[C]** (informe:12) | Aviso de puerta, incluso en azul `[4603]` **[C]** (informe:9-10, 29-30) |
| Al arrancar de noche con las luces en AUTO baja el brillo **[C]**, según tu observación (protocolo-zycela.md:294). Que sea la opción `[1A01]`: **[H, fuerte]** (ver §2.A.2) | Intermitente izquierdo y luces de emergencia, en amarillo `[4501]` **[C]** (informe:11, 27-28) |
| Botones de favoritos de la radio: cambian el color **[C]** (informe:19-20). El brillo de los pies pasó de 4 a 9 **[C]** (informe:20), sin saber con qué botón | Efecto «Flujo» `[1E03]`: «No se mueve nada» **[C]** (informe:23-25) |
| Brillo desde el menú del iDrive: pasó de 9/9/4 a 6/6/6 **[C]** (informe:32-36). El menú solo tiene brillo **[C]** (lo comprobaste tú; protocolo-zycela.md:311) | |
| Las tiras se apagan nada más bloquear **[C]** (informe:38) | |

### La explicación más probable

**Tu kit es la versión de color fijo («全彩», «a todo color», RGB) y no tiene conectadas tiras animadas («幻彩», «colores mágicos», tiras direccionables con cables HC).** **[H]**
- Confianza **alta** para la bienvenida.
- Confianza **baja-media** para la puerta y los intermitentes.

**Qué se ve:** todo lo que funciona cambia la tira entera, de color o de brillo. Lo que falla es una animación (bienvenida, «Flujo») o un aviso cuyo dibujo no conocemos (puerta, intermitentes) **[H]**.

**En qué se apoya:**
- **La misma caja sirve para los dos kits [C].** El esquema del fabricante dice «幻彩版跟全彩控制盒共用，装全彩产品，幻彩接口预留不用插»: la versión animada comparte caja con la de color fijo, y en un kit de color fijo las tomas de las tiras animadas se dejan sin conectar (docs/fabricante/esquema-conexion.jpg).
- **Los kits se distinguen por las cajas de puerta [C].** El kit RGB del X3 («BM03M 模具款 17灯 RGB», «modelo moldeado, 17 luces, RGB») trae una sola caja (zyres/x3rgb.jpg). El kit animado trae además cuatro cajas de puerta: «左前门/右前门/左后门/右后门» (delantera izquierda, delantera derecha, trasera izquierda, trasera derecha) (zq/research9/x3hc_box.png).
- **La bienvenida es de las tiras animadas [C].** El manual de la app llama a su interruptor «幻彩迎宾开关» («interruptor de bienvenida de las tiras animadas») (zq/research9/amzx_p7_0.png; investigacion-eventos.md:93). Sus modos son movimientos: «中控环绕» (envolvente consola), «车门环绕» (envolvente puertas), «车门+回流» (puertas + retorno).
- **Con «Flujo» no se movió nada en ninguna tira [C]** (informe:23-25).
- **Indicio [H]:**
  - Los cuatro números de LEDs valen 50, también los de «puertas traseras», que un coupé no tiene (trama 4F, informe:6).
  - El parámetro `123` es el mismo del ejemplo del manual (amzx_p8_0.png).
  - Parece que nadie los ajustó a unas tiras reales.
- **Puerta e intermitentes [H, más débil].** Ningún documento del fabricante dice cómo se dibujan, y la app no tiene ningún texto de ayuda. Sin tiras HC, el kit podría dibujarlos igualmente:
  - las cajas de puerta tienen salidas de color fijo (tirador, contorno, portaobjetos; esquema-conexion.jpg);
  - en el kit LED del G38, las puertas de cada lado van por mazos separados, izquierdo y derecho (zq/research9/ae_dial.png).

### Por qué no es que el módulo «no lea el coche»

- **[C]** Reacciona al radar, al climatizador, a los botones de la radio, al brillo del iDrive y al bloqueo. También baja el brillo de noche al arrancar; qué señal usa para eso es **[H]**.
- **[C en la traza del F11]** Los mensajes de puertas (`0x2FC`) e intermitentes (`0x1F6`) circulan por K-CAN, K-CAN2 y PT-CAN (conteo propio en `bmwres/f11/*.csv`). Así que llegarían a cualquiera de esas redes. Que en el F32 pase igual es **[H]**.
- **[H, poco probable]** Que el perfil `01000010`, pensado para «老款F18/x1/x3/x4/x5/x6» (F18, X1, X3, X4, X5 y X6 antiguos), interprete mal esas señales concretas del F32.

### Dudas que quedan

- **[C]** En las pruebas guiadas, la puerta y los intermitentes solo se probaron con el contacto puesto, sin el motor en marcha (carTests.ts:174, :342, :365).
  - **[H]** El aviso de intermitentes ya estaba activado en la copia del 7/11 (informe:4). Quizá condujiste con él activado; no lo sabemos.
- **[C]** Durante las pruebas guiadas estaba activado el modo de depuración `[3702]` (carTests.ts:1375). Pero en esa misma sesión funcionaron el radar y el climatizador (informe:12-13), así que **casi seguro no influye**. `[3700]` queda solo como limpieza.

### Contradicciones entre investigadores, resueltas

1. **¿El interruptor 8 activa el climatizador?**
   - mi-configuracion.md:8 lo da por hecho, pero es **[H]**. En el mismo paso se volvió a enviar `[3501]` y se salió del modo fábrica (informe:9). Además, no sabemos si la prueba del día anterior se hizo igual.
   - El manual F30–F36 que «lo trae encendido» no se puede comprobar: zyres/mp.pdf es solo la página de comprobación de seguridad de manuals.plus.
   - Solo el manual del G38 lo muestra encendido (ae_2.jpg), con la nota «功能拨码不动» («no toques el dial de funciones»). Eso parece decir «déjalo como viene», no «enciéndelo».
   - El manual genérico de la app lo muestra todo apagado (amzx_p8_0.png), aunque ahí el código de coche también sale vacío.
   - **Conclusión:** déjalo encendido. Con él el radar sigue funcionando **[C]** (informe:13) y no se ha visto nada peor.
2. **«Rojo sobre rojo».** No es la causa del fallo: en las pruebas 1 y 5 el aviso de puerta estaba en azul **[C]** (informe:9, :30).
   - Al cerrar cada prueba, la app vuelve a poner la puerta y el intermitente en rojo (`[4600]` `[4500]`, informe:17; carTests.ts:674-682). Así que ahora **probablemente** están en rojo **[H]**: el informe no muestra la restauración de las pruebas 4 y 5.
   - En rojo, sobre tu `#ff0d00`, un aviso que funcionara no se vería.
3. **«La bienvenida solo sale de noche con la luz de bienvenida del coche»** (investigador web) **[H]**. Puede ser una condición de disparo, pero sin tiras animadas ningún disparo la hará visible.
4. **El radar está ahora apagado [C].** La restauración de la prueba 1 envió `[3200]` (informe:17).

**La comprobación que lo zanja es la prueba 1.**
- **Sin herramientas:** mira el título y las fotos del pedido.
  - «幻彩», «Phantom», «dynamic» o un código que empiece por «HC-» indican kit animado.
  - «RGB» o «LED版» («versión LED») indican color fijo.
  - Si el instalador puede enseñártelo: ¿hay cajitas dentro de las puertas? ¿Las tres tomas blancas HC1–HC3 de la caja principal están vacías o con clavija?
- **Con la app:** el efecto multicolor `[1E00]`, de noche.
- **Si no hay tiras HC:** la bienvenida queda descartada. La puerta y los intermitentes, **probablemente** también.

---

## 2. Lo que se puede hacer sin el móvil

### Resumen por objetivo

| Lo que haces en el coche | Mejor opción con este módulo | Estado |
|---|---|---|
| Marcha atrás | Radar: parpadeo de verde a rojo | **[C]** funciona |
| Arrancar o conducir de noche | La regla «consola a mitad de brillo» `[1A01]` | Baja el brillo: **[C]**. Que sea esta regla: **[H, fuerte]**. Más visible con `[1401]`: **[H]** |
| Noche / encender las luces | Seguir las luces del coche `[0702]` | **[H]** sin probar |
| Conducir | Aviso de exceso de velocidad `[3301]` | **[H]** sin probar |
| Tocar el climatizador | Cambio de color | **[C]** funciona. Cuánto dura: **[H]** |
| Poner música | Modos de ritmo `[040f]`–`[0411]` | **[H]** sin probar |
| Bloquear | Se apagan | **[C]** funciona |
| Abrir una puerta | Aviso de puerta `[3101]` | **[C]** no visto. Último intento: prueba 4 |
| Desbloquear | Bienvenida | **[H]** imposible sin tiras animadas |
| Elegir el color a mano | Botones de la radio | **[C]** funciona |
| Elegir el brillo a mano | iDrive **[C]**, rueda de instrumentos **[H]** | ver B.6 |

### A. Ya funciona: solo hay que dejarlo activado

**1. Marcha atrás → radar**
- **Qué verás:** con un obstáculo detrás, las tiras parpadean en un color que va de verde a rojo según la distancia.
- **Confianza [C]:** informe:13; protocolo-zycela.md:293.
- **Cómo ponerlo:** `[3201]`. Ahora está apagado. Para comprobarlo, `[0A01]`: en la trama 26, las posiciones 7–8 deben valer `01`.
- **Riesgo:** ninguno. **Deshacer:** `[3200]`.

**2. Arrancar o conducir de noche → la consola a mitad de brillo**
- **Qué verás:** al arrancar de noche con las luces en AUTO, baja el brillo **[C]** (tu observación).
- **Que sea `[1A01]`, «夜间行驶中控亮度减半» («de noche y conduciendo, consola a mitad de brillo»): [H, fuerte].**
  - La prueba que lo aislaba se saltó (informe:31).
  - A favor: al arrancar, la trama 4E no cambió (protocolo-zycela.md:283). Un cambio de brillo que viniera del coche sí se habría reflejado, como pasó con el iDrive (informe:35).
  - Qué tiras baja exactamente: **[H]**.
- **Cómo ponerlo:** `[1A01]`. Ya está activado (trama 26, posiciones 15–16 = `01`).
- **Variante [H], prueba 2:** con `[1401]` (zonas delante/detrás, «前后分区») el deslizador 1 pasa a ser «中控» (consola) y el 2 «车门» (puertas) (protocolo-zycela.md:58-61).
  - Probablemente solo bajaría la consola y las puertas seguirían a tope: un «modo noche» más visible.
  - Después hay que reenviar `[020009] [010109] [010204]`.
  - El manual avisa: «前后分区部分车型可用» («las zonas delante/detrás solo funcionan en algunos modelos») (amzx_p6_0.png).
- **Deshacer la variante:** `[1400] [020009] [010109] [010204]`.

**3. Climatizador → cambio de color**
- **Qué verás:** las tiras cambian de color al cambiar la temperatura **[C]** (informe:12). Qué color, en qué tiras y cuánto tiempo: **[H]**, se ve en la prueba 5.
- **Para qué sirve:** es un gesto que ya existe. Si el color se mantuviera mientras la temperatura sigue cambiada, la rueda del climatizador serviría para elegir escena. No se sabe.
- **Cómo ponerlo:** `[3501]` (ya activado), con el interruptor 8 encendido como lo tienes. Que haga falta el interruptor 8 es **[H]**.
- **Deshacer:** `[3500]`.

**4. Bloquear → se apagan [C]** (informe:38). No hay nada que ajustar.

### B. A mano, sin móvil

**5. Botones de favoritos de la radio**
- **Qué hacen en tu coche:**
  - Cambian el color **[C]**: `#ff0d00` → `#ff0000` (informe:19-20).
  - En la misma prueba, el brillo de los pies pasó de 4 a 9 **[C]**, sin saber qué botón lo hizo.
  - Según el manual del G38: 4 = modo, 5/6 = color, 7/8 = brillo (ae_4.jpg: «触摸数字4切换模式 / 5、6切换颜色 / 7、8切换亮度» = «toca el 4 para cambiar el modo / el 5 y el 6 para el color / el 7 y el 8 para el brillo»). En el F32, el 4 y el 7/8 son **[H]**.
- **El módulo lo adopta como su color actual [C]:** en la trama 4E cambiaron las posiciones 9–14 y también las 15–20, de `FF0D00` a `FF0000` (informe:20-21).
- **¿Dura después de dormir? [H]:** probablemente sí. Tus brillos 9/9/4 seguían igual del 6/11 al 7/11.
- **Qué colores recorre, y si pisa los dos colores de zona:** no se sabe. Es la prueba 6.
- **Requisito:** control «原车 + 手机» («coche + móvil»), `[5100]`, que es el actual (trama 4E, posiciones 35–36 = `00`). Con `[5101]` («强制手机», «solo móvil») probablemente los ignoraría **[H]**.

**6. Brillo desde el coche**
- **Menú de luz ambiente del iDrive [C]:** cambia el brillo y no tiene colores (informe:33-35; protocolo-zycela.md:311).
  - **Ojo:** pone los tres brillos al mismo valor. Pasaron de 9/9/4 a 6/6/6, y se pierde la diferencia de los pies **[C]**.
  - **[H]:** el coche no lo vuelve a imponer en cada arranque. Ahora el iDrive se ha quedado en el nivel que dio 6/6/6, así que lo comprobamos en «Antes de empezar» (sección 3).
  - **Deshacer:** `[020009] [010109] [010204]`.
- **Rueda de iluminación de los instrumentos [H]:**
  - **[C]** El manual del F30 dice que el brillo del ambiente se puede ajustar «via the thumbwheel for the instrument lighting» o por separado (manualsdir, p. 91).
  - **[C]** BimmerCode del F32 ofrece «Ambient lighting brightness decoupling from instrument cluster» (separar el brillo del ambiente del de los instrumentos) (bimmercode.app/cars/f32).
  - **[H]** Si tu coche las tiene acopladas, la rueda movería el brillo del kit sin el móvil. Se mira en la prueba 2.
- **Si no quieres que el coche pise tus brillos [H]:**
  - `[5101]` («solo móvil») probablemente lo impide.
  - Pero probablemente también desactiva los botones de la radio, y quizá la bajada de noche.
  - Sin probar. **Deshacer:** `[5100]`.

### C. Automático y posible con este módulo, pero sin probar (pruebas 2, 3 y 7)

**7. Seguir las luces del coche, `[0702]` («跟随车灯», «seguir las luces del coche»)**
- **Existe [C]:**
  - la tabla del fabricante la marca para tu código (mi-configuracion.md:33);
  - en el mini-programa está en el apartado «开关控制» («control de encendido»): 开启 (encender) / 关闭 (apagar) / 跟随车灯 (seguir las luces) (app-service.js 2930-2940; amzx_p6_0.png).
- **Qué verás [H]:** las tiras encendidas solo con las luces del coche encendidas. Con el mando en AUTO: apagadas de día, encendidas al anochecer, en túneles y en garajes.
- **[H, poco probable]:** que también se enciendan con la luz de bienvenida del coche al desbloquear.
- **Solo enciende y apaga;** no cambia el color.
- **Riesgo:** si el módulo no detecta las luces, las tiras se quedan apagadas. Se arregla con `[0701]` desde la app. Que el Bluetooth siga activo con las tiras apagadas es **[H]**, muy probable.
- **Deshacer:** `[0701]`.

**8. Velocidad, `[3301]`**
- **Nombres:** «车速联动» («vinculado a la velocidad») en la app, «超速警示» («aviso de exceso de velocidad») en la tabla del fabricante (mi-configuracion.md:36).
- **[C]:** solo se puede activar o desactivar. No hay umbral ni modos (app-service.js 4992-5002).
- **[H]:** un parpadeo o un color por encima de una velocidad fija que no conocemos.
- **[H, débil]:** 120 km/h es un valor habitual en coches chinos. Si es ese, quizá nunca se vea conduciendo dentro del límite.
- **Deshacer:** `[3300]`.

**9. Música → modos de ritmo «律动» (ritmo), `[040f]`, `[0410]`, `[0411]`**
- **Existen [C]:**
  - son los modos RGB 15–17 (protocolo-zycela.md:84);
  - la fuente de sonido es «内置麦克风» (micrófono interno, `[1B00]`) o «原车喇叭» (altavoces del coche, `[1B01]`) (amzx_p7_0.png).
- **[H]:** las tiras de color fijo laten con la música.
- **Dudas:**
  - tu trama 26 da la fuente como `FF` (protocolo-zycela.md:289);
  - el puerto DAT de la caja está marcado «预留(声控)» («reservado, control por sonido») (esquema-conexion.jpg).
  - Puede que no haya micrófono ni señal de los altavoces.
- **Es un «look» que reacciona a algo que haces**, no un aviso.
- **Deshacer:** `[0400] [06ff0d00]`.

### D. Probablemente no funciona, pero no cuesta dejarlo preparado

**10. Aviso de puerta e intermitentes, con colores que se distingan del rojo**
- **Cómo ponerlo:** `[3101] [4603]` (puerta en azul) y `[3401] [4501]` (intermitente en amarillo).
- **Estado:** no se han visto **[C]**. Probablemente necesitan tiras animadas, o fallan por otra causa **[H]**. Dejarlos activados no molesta.
- **Último intento:** la prueba 4, con el motor en marcha y sin depuración.

### E. No recomendado ahora

- **Aprender un botón del volante, `[22XX]`.**
  - Solo hace funciones fijas **[C]** (protocolo-zycela.md:171; app-service.js 4477-4492):
    - «唤醒按键» (despertar);
    - «流水大模式» (modo principal de efectos) y «流水子模式» (submodo de efectos): estos dos son para tiras animadas;
    - «模式/颜色+» y «模式/颜色−» (modo/color + y −).
  - Se parece a los botones de la radio, que ya tienes.
  - Solo se puede deshacer restaurando de fábrica, y **`[42…]` (y `[41…]`) no se envían nunca**.
  - La idea de aprender el selector de modo de conducción es especulativa **[H]**.
- **Cambiar el código de coche.** Ningún código BMW de la tabla ofrece más funciones: todos marcan las mismas seis **[C]** (tabla-codigos-modelo.pdf p. 2).
  - El `01000001` («F18 只有亮度界面 无颜色», «F18 con menú de solo brillo, sin color») describe un menú como el tuyo.
  - Pero tu código actual ya sigue el brillo del iDrive, así que no se espera ninguna ganancia **[H]**.
- **Secuencia de colores personalizada,** `[2A…]` + `[2B01]`.
  - Recorre hasta 8 colores de la paleta de 15, a la velocidad `[3E]` **[C]** (protocolo-zycela.md:72-74, 87-95). Cómo se ve en tus tiras es **[H]**.
  - Es un «look», no una reacción a algo que hagas.
  - Los modos RGB `[04XX]` (respiración, degradado) también deberían verse en tus tiras **[H]**. Lo que falló fueron los efectos de las tiras animadas, `[1EXX]`.

### Combinación recomendada (se configura una vez)

`[3201] [3501] [1A01] [3101] [4603] [3401] [4501]`. Mantén `[5100]` y el interruptor 8 encendido.

Según lo que salga en las pruebas, añade `[0702]`, `[3301]` y/o `[1401]`.

Si todo sale bien, quedaría así:

| Situación | Lo que harían las tiras |
|---|---|
| De día | Apagadas, solo si eliges `[0702]` |
| De noche, parado | A tope |
| Al arrancar y conducir de noche | Brillo reducido; consola a la mitad y puertas a tope si funciona `[1401]` |
| Marcha atrás | Verde a rojo según la distancia |
| Climatizador | Cambio de color |
| Exceso de velocidad | Aviso, si existe |
| Al bloquear | Apagadas |
| A mano | Color con los botones de la radio; brillo con el iDrive |

**Base de dos tonos (estática):** `[10RRGGBB]` pinta la zona 1 (分区一) y `[09RRGGBB]` la zona 2 (分区二) **[C]** (protocolo-zycela.md:69-70).
- Según el esquema del fabricante, la zona 1 es el salpicadero, los tiradores y los contornos, y la zona 2 los pies y los portaobjetos **[C]** (protocolo-zycela.md:273-274).
- En tu coche, el reparto es **[H]**: se ve en la prueba 1.
- Si los botones de la radio pisan esta base: prueba 6.

### Lo que no se puede, y por qué

- **Un color propio al desbloquear, dar el contacto o arrancar.**
  - No existe ningún comando que asocie un color a esos momentos **[C]**: todas las familias de comandos que puede enviar el mini-programa ya están en protocolo-zycela.md.
  - Los únicos colores ligados a eventos son los de puerta, intermitente y ángulo muerto (protocolo-zycela.md:144-146).
  - La única reacción al desbloquear es la bienvenida, que necesita tiras animadas **[H, fuerte]**.
- **Un color según el modo de conducción** (ECO PRO, COMFORT, SPORT).
  - No hay ningún ajuste para eso **[C]** (protocolo-zycela.md:131-148).
  - En la traza del F11, el mensaje del modo (`0x3A7`) va por K-CAN2 y PT-CAN, no por K-CAN **[C]**.
  - En qué red va el kit es dudoso **[H]**: K-CAN según BMW, K-CAN2 según un tutorial chino (investigacion-eventos.md:45-46). Da igual: sin ajuste, no hay reacción.
- **Un color que cambie poco a poco con la velocidad.** `[33]` solo se activa o se desactiva **[C]**.
- **Elegir el color desde el iDrive.**
  - Tu menú solo tiene brillo **[C]** (protocolo-zycela.md:311).
  - Según el DBC público de la serie F, el mensaje de ambiente solo lleva brillo (21 niveles) y estilo, «Classic» o «Sport-Modern-Luxury» **[C]** (FXX-BN2010.dbc:366-372, 839-842). Que no haya otro mensaje con color: **[H]**.
  - Activar el estilo exige codificar la unidad del iDrive (recetas de foro, solo con NBT) **[H]**. Es de riesgo medio, no se sabe si el kit reaccionaría y queda fuera de «solo el módulo».
- **Que el móvil detecte lo que pasa en el coche.** El módulo nunca envía nada por su cuenta **[C]** (protocolo-zycela.md:280-285; informe:42).

---

## 3. Pruebas propuestas (por orden)

**Antes de empezar:**
1. Si quedó abierta una sesión de «Pruebas del coche», ciérrala con **«Terminar»**, **no** con «Restaurar todo ahora». «Restaurar todo ahora» deshace lo que elegiste dejar y volvería a apagar el interruptor 8 (carTests.ts:1850-1871).
2. Envía `[3700]` (apaga la depuración).
3. **Antes de tocar nada,** envía `[0A01]` y guarda las tramas.
   - En la trama 4E, mira las posiciones 31–32, 21–22 y 23–24: deberían ser `09`, `09` y `04`.
   - Si salen `06`, `06` y `06`, el coche vuelve a imponer el brillo del iDrive en cada viaje **[H]**. En ese caso, pon el brillo del iDrive al máximo, o usa `[5101]` asumiendo lo de B.6.

Estado esperado:
- color `#ff0d00`, efecto 24, brillos 9/9/4;
- radar apagado;
- intermitente y puerta activados, probablemente en rojo **[H]**;
- climatizador activado;
- bienvenida activada (modo 1, cian);
- interruptor 8 encendido.

### Prueba 1 · ¿Hay tiras animadas? + mapa de zonas
2 minutos, de noche o en un garaje, con el contacto puesto.

- **Poner:**
  1. `[10ff00ff]` (zona 1 magenta) y `[09ffffff]` (zona 2 blanco). Mira.
  2. `[1E00]` (multicolor) y `[0B05]` (lo más rápido). Mira 10 segundos.
  3. `[1E17]` (efecto 23, rojo y azul en movimiento). Mira 10 segundos.
- **Qué mirar:**
  - Qué zonas salen magenta, cuáles blancas y cuáles apagadas.
  - Si alguna tira muestra varios colores a la vez o se mueve.
  - Si se mueve: dónde, y si se mueve entera o se queda un trozo quieto.
- **Sin herramientas:** el título y las fotos del pedido. Si el instalador puede: ¿hay cajitas dentro de las puertas? ¿Las tomas blancas HC1–HC3 están vacías?
- **Restaurar:** `[1E18] [0B03] [06ff0d00]`.
  - Comprueba con `[0A01]`: en la trama 4E, posiciones 5–6 = `18`, 9–14 = `FF0D00` y 15–20 = `FF0D00`.
- **Cómo leerlo:** si nada sale multicolor, no hay cajas de puerta y las tomas están vacías, olvida la bienvenida. La prueba 4 se hace igualmente.

### Prueba 2 · Noche: seguir las luces, rueda de instrumentos y zonas delante/detrás

**Parte A: seguir las luces**
- **Poner:** `[0702]`, y luego `[0A01]`. ¿En la trama 4E, las posiciones 7–8 pasan de `01` a `02`?
- **De día, con el contacto puesto:** pon el mando de luces en 0, en luces de posición, en cruce y en AUTO, 3 segundos en cada una. ¿Tiras encendidas o apagadas?
- **Al anochecer o en un garaje:** repítelo en AUTO.
- **Opcional:**
  1. Activa en el iDrive la luz de bienvenida (Ajustes › Iluminación; la ruta exacta es **[H]**). Se guarda por llave.
  2. Bloquea y espera 1 minuto.
  3. Desbloquea a oscuras. ¿Se encienden las tiras a la vez que las luces del coche?
- **Restaurar:** `[0701]`. O déjalo en `[0702]` si te gusta.

**Parte A2: rueda de instrumentos (1 minuto, con las luces encendidas)**
- Gira la rueda de iluminación de los instrumentos, si tu mando de luces la tiene, del mínimo al máximo. ¿Cambian las tiras?
- `[0A01]`: ¿cambiaron las posiciones 21–24 y 31–32 de la trama 4E?
- **Restaurar:** deja la rueda donde estaba y envía `[020009] [010109] [010204]`.

**Parte B: zonas delante/detrás**
- **Poner:** `[1401]` y después `[020009] [010109] [010204]`.
- **De noche, en AUTO:** pon el contacto y mira; después arranca. ¿Baja solo el salpicadero y las puertas siguen a tope?
- **Restaurar:** `[1400] [020009] [010109] [010204]`. Comprueba en la trama 26 que las posiciones 17–18 = `00`.

**Si estás en un garaje:** abre la puerta del garaje antes de arrancar.

### Prueba 3 · Velocidad

- **Poner:** `[3301]`. Comprueba con `[0A01]`: en la trama 26, posiciones 9–10 = `01`.
- **En marcha:** el conductor no mira las tiras; las mira un acompañante. Conduce normal y apunta a qué velocidad cambia algo (30, 50, 80 o 100 km/h, solo donde sea legal).
- **Opcional:** pon el aviso de velocidad del iDrive a 40 km/h y pásalo de forma legal. ¿Reaccionan las tiras cuando suena el aviso del coche? Después déjalo como estaba.
- **De paso, parado:** cambia entre ECO PRO, COMFORT y SPORT. Lo esperado es que no cambie nada.
- **Restaurar:** `[3300]`, o déjalo activado.
- **Riesgo:** distracción. Nunca superes un límite de velocidad para provocarlo.

### Prueba 4 · Puerta e intermitentes en condiciones no probadas
Hazla aunque la prueba 1 no encuentre tiras animadas: es barata y es la última condición sin probar.

- **Poner:** `[3700]`, `[0600ff00]` (base verde, para que contraste), y después `[3101] [4603] [3401] [4501]`.
- **De noche, con el motor en marcha,** en P y con el freno de mano puesto (en un garaje, con la puerta del garaje abierta):
  1. Abre la puerta del conductor 5 segundos, y luego la del acompañante.
  2. Intermitente izquierdo 5 segundos, derecho 5 segundos, emergencias 5 segundos.
- **Además, con el contacto quitado y el coche desbloqueado:** abre una puerta.
- **Qué mirar:** un destello azul en cualquier tira, o amarillo en un solo lado.
- **Restaurar:** `[06ff0d00]`. Deja `[3101] [4603] [3401] [4501]` activados, o apaga los intermitentes con `[3400]`.

### Prueba 5 · Qué hace el climatizador, y si depende del interruptor 8

- **Comprobar:** trama 26, posiciones 13–14 = `01` (`[3501]` activado).
- **Con el motor en marcha** (en un garaje, con la puerta del garaje abierta):
  1. Sube 1 °C y espera 15 segundos.
  2. Sube 2 °C más.
  3. Baja 3 °C.
  4. Pulsa A/C, cambia el ventilador y pulsa AUTO.
- **Qué apuntar en cada paso:** el color, qué tiras cambian, cuántos segundos dura y si se mantiene mientras la temperatura sigue cambiada. Al final, `[0A01]`: ¿cambió el color en la trama 4E?
- **Opcional, con el interruptor 8 apagado** (mejor desde la pantalla Instalación de la app):
  1. `[2101]`, espera las tramas 23/25/4F, luego `[200100001000000000]` y `[2100]`.
  2. Comprueba: `[2101]`, la trama 23 debe ser `[230100001000000000]`, y luego `[2100]`.
  3. Repite los pasos **sin** reenviar `[3501]`.
  4. Envía `[3501]` y repítelos otra vez.
  5. Vuelve a encenderlo: `[2101]`, espera las tramas, `[200100001000000001]`, `[2100]`.
  6. Comprueba: `[2101]`, la trama 23 debe acabar en `…00000001`, y luego `[2100]`.

### Prueba 6 · Botones de la radio: qué recorren y si se guardan

- **Antes:** `[0A01]`.
- **Colores:** toca el 5 una vez y envía `[0A01]` (trama 4E, posiciones 9–14 y 15–20). Repite hasta que vuelva a salir un color ya visto y apunta la lista. Haz lo mismo con el 6.
- **Modo y brillo:**
  - Toca el 4: ¿cambian las posiciones 3–4 o 5–6?
  - Luego el 7/8: ¿cambian las posiciones 21–24 y 31–32? ¿Quedan los tres brillos iguales, como con el iDrive?
- **Dos zonas:** envía `[10ff0000] [090000ff]` y pulsa el 5. ¿Cambian las dos zonas?
- **Memoria:**
  1. Elige un color con los botones.
  2. Bloquea y espera al menos 40 minutos. El Bluetooth se cortó a los 30 minutos **[C]** (protocolo-zycela.md:284).
  3. Desbloquea y envía `[0A01]`. ¿Sigue el mismo color?
- **Restaurar:** `[0400] [06ff0d00] [1E18] [0B03] [3E08] [020009] [010109] [010204]`.
  - Comprueba con `[0A01]` que la trama 4E vuelve a `[4E001801FF0D00FF0D000904010300090800]`.

### Prueba 7 (opcional) · Ritmo con la música

- **Poner:** `[040f]` (ritmo, siete colores). Pon música alta 30 segundos. ¿Laten las tiras?
- **Si no laten:** prueba `[1B00]` (micrófono interno) y repite. Luego prueba `[1B01]` (altavoces del coche).
- **Restaurar:** `[0400] [06ff0d00]`.
  - La fuente de sonido ya no volverá a `FF`.
  - Solo afecta a los modos de ritmo **[H]**.

---

## 4. Fuentes

**Tus resultados**
- Informe de pruebas: `C:/Users/.../AppData/Local/Temp/zq/research9/informe-pruebas-2026-11-09.txt`
  - línea 4: diferencias con tu configuración (intermitentes ya activados)
  - líneas 5-6: tramas de la copia
  - líneas 9-17: interruptor 8, puerta, intermitentes, climatizador, radar, bienvenida y restauración
  - líneas 18-22: radio
  - líneas 23-25: Flujo
  - líneas 27-30: pruebas 4 y 5, sin restauración registrada
  - líneas 32-36: iDrive
  - líneas 38-39: bloqueo y bienvenida
  - línea 42: sin notificaciones

**Proyecto** (`(raíz del proyecto)`)
- `docs/protocolo-zycela.md`
  - 48-52: `[07]` y `[51]`
  - 58-62: deslizadores, `[14]` y `[1A]`
  - 68-70: `[06]`, `[10]` y `[09]`
  - 72-74: `[3E]`, `[2B]` y `[2A]`
  - 84 y 87-95: ritmo y paleta
  - 131-148: eventos
  - 171: aprender un botón
  - 269-274: cableado y zonas
  - 280-285: el módulo no envía nada por su cuenta
  - 289: fuente de sonido `FF`
  - 293-294: radar y mitad de brillo
  - 311: el menú del iDrive solo tiene brillo
- `docs/mi-configuracion.md`
  - 8: nota del interruptor 8
  - 33-38: tabla de funciones
- `docs/investigacion-eventos.md`
  - 44-55: red del coche
  - 45-46: contradicción K-CAN / K-CAN2
  - 93: «幻彩迎宾开关»
  - 118-131: historia del interruptor 8
- `app/src/state/carTests.ts`
  - 174, 342, 365: solo con el contacto puesto
  - 674-682: colores restaurados a rojo
  - 1375: depuración `[3702]`
  - 1697-1705: restauración por prueba
  - 1850-1871: «Restaurar todo ahora» deshace lo que elegiste dejar
  - 1886-1919: «Terminar»
- `app/src/protocol/zycela/commands.ts`: formato de los comandos

**Fabricante**
- `docs/fabricante/esquema-conexion.jpg`: la caja compartida, las tomas HC sin conectar en kits de color fijo y las zonas.
- `docs/fabricante/tabla-codigos-modelo.pdf`: filas BMW, columnas «跟随车灯» (seguir las luces) y «超速警示» (aviso de exceso de velocidad).
- `C:/Users/.../AppData/Local/Temp/zyres/x3rgb.jpg`: kit RGB con una sola caja. `C:/Users/.../AppData/Local/Temp/zq/research9/x3hc_box.png`: kit animado con cuatro cajas de puerta.
- `C:/Users/.../AppData/Local/Temp/zyres/ae_2.jpg`: dial de funciones del G38 y «功能拨码不动» (no toques el dial de funciones).
- `C:/Users/.../AppData/Local/Temp/zyres/ae_4.jpg`: iDrive del G38 y botones de la radio 4, 5/6 y 7/8.
- `C:/Users/.../AppData/Local/Temp/zq/research9/ae_dial.png`: en el kit LED del G38, mazos izquierdo y derecho hacia las puertas.
- `C:/Users/.../AppData/Local/Temp/zq/research9/amzx_p6_0.png`, `amzx_p7_0.png` y `amzx_p8_0.png`: brillo, ajustes y fábrica.
  - el aviso «部分功能不支持，待开发» («algunas funciones no están disponibles, en desarrollo»);
  - la nota «前后分区部分车型可用» (zonas delante/detrás solo en algunos modelos);
  - el ejemplo 40/130/100/100 y el parámetro 123.
- `C:/Users/.../AppData/Local/Temp/zyres/mp.pdf`: solo la página de comprobación de seguridad de manuals.plus, así que el manual F30–F36 no se puede comprobar.

**Mini-programa** (`C:/Users/.../AppData/Local/Temp/wxre/pretty/app-service.js`)
- 2930-2940: «开关控制» y «跟随车灯» `[07]`
- 3012-3018: `[51]`
- 4477-4492: aprender botones `[22]`
- 4867-4916 y 4992-5017: ajustes de eventos y sus colores

**Red BMW**
- `C:/Users/.../AppData/Local/Temp/bmwres/FXX-BN2010.dbc:366-372, 839-842` (DBC de la comunidad): el mensaje de ambiente lleva brillo y estilo «Classic» / «Sport-Modern-Luxury».
- `C:/Users/.../AppData/Local/Temp/bmwres/f11/*.csv` (traza real de un F11, conteo propio):
  - `0x3A7`: K-CAN 0, K-CAN2 242, PT-CAN 49
  - `0x2FC`: 41 / 41 / 62
  - `0x1F6`: 63 / 75 / 107

**Web**
- https://bimmercode.app/cars/f32: solo «Ambient lighting brightness» y «…decoupling from instrument cluster»; no hay color de ambiente; sí hay opciones de «Welcome Light».
- https://www.manualsdir.com/manuals/661577/bmw-2013-3-series.html?page=91: el color del ambiente depende del equipo; el brillo se ajusta con la rueda de instrumentos o por separado. `?page=87`: luz de bienvenida, guardada por llave.
- f30.bimmerpost.com/forums/showthread.php?p=18117049: solo visto en extractos de búsqueda; Classic/Sport por codificación **[H]**.
