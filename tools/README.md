# Herramientas

## extraer_miniprograma.py

Descifra y desempaqueta el paquete `.wxapkg` que WeChat para Windows guarda al abrir un mini-programa. Sirve para volver a revisar el protocolo si el fabricante publica una versión nueva del mini-programa.

Requisitos: Python 3 y `pycryptodome`.

```bash
python -m pip install pycryptodome
```

1. Abre el mini-programa 氛围灯控制程序 en WeChat para Windows y recorre sus pantallas.
2. Busca el paquete. En WeChat 4.x está en:
   `%APPDATA%\Tencent\xwechat\radium\users\<id>\applet\packages\wx4354b0b9d0c999a0\<versión>\__APP__.wxapkg`
3. Ejecuta el script con el appid, el paquete y una carpeta de salida vacía, fuera de este proyecto:

```bash
python extraer_miniprograma.py wx4354b0b9d0c999a0 "ruta/al/__APP__.wxapkg" "C:/Temp/wxre/out"
```

La lógica de Bluetooth está en `appservice.app.js` (conexión) y en `chunk_*.appservice.js` (una por pantalla). El protocolo que sacamos de la versión 8 está en [../docs/protocolo-zycela.md](../docs/protocolo-zycela.md).

No copies el código del fabricante dentro de este proyecto: úsalo solo como referencia.
