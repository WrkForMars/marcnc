# Trazo CNC

Convierte un SVG o una imagen con fondo blanco en código G y M para grabado CNC.

- **Modo por figura:** cada figura detectada se graba con Relleno, Contorno, Invertir (orilla exterior + huecos vaciados), Línea u Omitir.
- **Textos:** de una sola línea (fuentes Hershey, ideales para grabar) o rellenos, con acentos y ñ; se arrastran en la vista previa.
- **Simulación real:** la vista previa dibuja el grabado con el ancho que de verdad deja la herramienta a esa profundidad (una ball mill de 1/8" a 0.1 mm corta 1.11 mm, no 3.175 mm) y avisa cuando un detalle no cabe o algo se sale de la pieza.
- **Código legible:** comentarios por figura, arcos `G02`/`G03`, pasadas múltiples, formato Fanuc/Haas o GRBL.

## Uso

```bash
npm install
npm run dev      # abre http://localhost:5173
npm test         # 40 pruebas de geometría y G-code
npm run build    # genera dist/
```

## Publicar en GitHub Pages

1. Sube el repositorio a GitHub.
2. En **Settings → Pages**, elige **GitHub Actions** como origen.
3. Cada push a `main` corre las pruebas, construye y publica (ver `.github/workflows/deploy.yml`).

## Antes de cortar

La app no conoce tu máquina. Revisa el programa en un simulador y haz una prueba en un retazo antes de la pieza final, sobre todo la altura de Z0: con una ball mill, 0.05 mm de diferencia cambian bastante el ancho de la línea.

## Créditos

- [Clipper](https://www.angusj.com/clipper2/) (clipper-lib) para operaciones de polígonos.
- [ImageTracer](https://github.com/jankovicsandras/imagetracerjs) para vectorizar imágenes.
- Fuentes Hershey (dominio público) para el texto de una línea.
