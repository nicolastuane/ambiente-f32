# Ambiente F32

App web para controlar desde el iPhone la luz ambiente ZYCELA (módulo Bluetooth `ZYCL-FWD`) instalada en un BMW F32. Sustituye al mini-programa de WeChat 氛围灯控制程序.

- [app/](app/): la app. Es una PWA con Web Bluetooth; en iPhone se abre con el navegador Bluefy. Instrucciones en [app/README.md](app/README.md).
- [docs/protocolo-zycela.md](docs/protocolo-zycela.md): el protocolo Bluetooth del módulo, reconstruido a partir del mini-programa.
- [docs/mi-configuracion.md](docs/mi-configuracion.md): la configuración de instalación del coche y qué significa.
- [tools/](tools/): herramienta para extraer el mini-programa si el fabricante lo actualiza.

Cada push a `main` ejecuta los tests, compila la app y la publica en GitHub Pages (ver [.github/workflows/deploy.yml](.github/workflows/deploy.yml)).
