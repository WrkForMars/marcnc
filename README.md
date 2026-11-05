# GrabaCNC

Convierte un SVG o una imagen con fondo blanco en código G y M para grabado CNC. Funciona en el navegador o como programa de Windows (.exe), sin internet.

- **Croquis con coordenadas:** dibuja líneas, rectángulos, círculos, arcos y polígonos sobre la pieza con el ratón (imán a cuadrícula y a vértices, centros y puntos medios) o tecleando `x y`, `@dx dy` o `@distancia<ángulo`. Cada medida se puede corregir después; una figura cerrada dentro de otra queda como hueco. Atajos: V, L, R, C, A, P, Esc, Supr, Ctrl+Z / Ctrl+Y.
- **Modo por figura:** cada figura detectada se graba con Relleno, Contorno, Invertir (orilla exterior + huecos vaciados), Línea u Omitir.
- **Textos:** de una sola línea (fuentes Hershey, ideales para grabar) o rellenos, con acentos y ñ; se arrastran en la vista previa.
- **Simulación real:** la vista previa dibuja el grabado con el ancho que de verdad deja la herramienta a esa profundidad (una ball mill de 1/8" a 0.1 mm corta 1.11 mm, no 3.175 mm) y avisa cuando un detalle no cabe o algo se sale de la pieza.
- **Línea central:** las imágenes de trazos delgados (letras a mano, dibujos de línea) se pueden grabar en una sola pasada por el centro de cada trazo.
- **Aprende a leer el código:** toca cualquier línea del programa y te dice qué hace en español ("baja la herramienta 0.10 mm a 60 mm/min", "arco horario con centro en…") y resalta ese movimiento en la vista previa; con ↑ ↓ lo recorres paso a paso.
- **Hoja de entrega:** con tus datos (alumno, número de control, práctica, profesor, material) sale una hoja imprimible o en PDF con los parámetros de corte, el dibujo sobre cuadrícula con coordenadas, las líneas de cada figura y el programa explicado.
- **Código legible:** comentarios por figura, arcos `G02`/`G03`, pasadas múltiples, formato Fanuc/Haas o GRBL.

## Uso

```bash
npm install
npm run dev      # abre http://localhost:5173
npm test         # pruebas de geometría y G-code
npm run build    # genera dist/
```

Atajos: **Ctrl+O** abre un archivo, **Ctrl+S** guarda el código. También puedes arrastrar el archivo a la ventana.
Los parámetros de la máquina se recuerdan entre sesiones; **Valores iniciales** los regresa a los de la tarea de referencia.

## Programa de Windows (.exe)

La misma app empaquetada con [Tauri](https://tauri.app): pesa unos 5–10 MB y usa WebView2, que ya viene en Windows 10 y 11.

- **Sin compilar nada:** cada push a `main` corre `.github/workflows/escritorio.yml` y deja en *Actions → GrabaCNC-windows*
  `GrabaCNC-portable.exe` (se abre directo, sin instalar ni permisos de administrador) y el instalador `GrabaCNC_x.y.z_x64-setup.exe`
  (se instala solo para el usuario actual). Al subir una etiqueta `v0.3.0`, los publica como Release.
- **Compilar en tu equipo** (requiere [Rust](https://rustup.rs) y, en Windows, las herramientas de C++ de Visual Studio):

```bash
npm run escritorio   # ventana de desarrollo con recarga en vivo
npm run exe          # genera src-tauri/target/release/grabacnc.exe y el instalador
```

El .exe no está firmado: la primera vez Windows puede mostrar "Windows protegió su PC" → *Más información* → *Ejecutar de todas formas*.

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
