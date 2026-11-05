# MarCNC

Convierte un SVG o una imagen con fondo blanco en código G y M para grabado CNC. Funciona en el navegador o como programa de Windows (.exe) y Linux (.deb / AppImage), sin internet.

- **Croquis como en CAD:** línea, rectángulo de esquina y de centro (con esquinas redondeadas), círculo, arco centro-extremos, polígono y ranura recta, con inferencias al dibujar: horizontal, vertical y alineado con otros puntos, con líneas guía.
- **Si sabes SolidWorks, ya sabes usarlo:** mismo orden de herramientas, **Cota inteligente** (figura y luego un lugar libre = tamaño; otra figura = distancia; un borde = distancia al borde), azul = insuficientemente definido y negro = completamente definido (también en la barra de estado), **PropertyManager** con vista previa, ✓ Aceptar (Enter) y ✕ Cancelar (Esc), clic derecho para terminar la cadena o abrir el menú, rueda para zoom en el cursor, botón central o Espacio para desplazar, **F** para zoom para ajustar y **Enter** para repetir el último comando.
- **Cotas que mandan:** con la herramienta Cota (D) acotas el tamaño de una figura, su distancia a un borde de la pieza o la distancia entre dos figuras. Al cambiar el valor la geometría se ajusta, y lo acotado ya no se mueve en esa dirección. Las figuras sin cotas suficientes se ven en azul y las completamente definidas en negro. Al elegir una figura aparecen cotas sugeridas: tocar una y escribir el valor la guarda.
- **Geometría de construcción** (punteada, no se graba), **selección múltiple** (Shift+clic; recuadro de izquierda a derecha = dentro, de derecha a izquierda = lo que toque), **matriz lineal**, **matriz circular** y **simetría de entidades**.
- **Atajos:** V L R C A P S D (herramientas), Shift+R (rectángulo de centro), Q (construcción), F (ajustar), Enter (repetir), Ctrl+C / X / V / D, Ctrl+A, Supr, flechas (Shift: ×10), Ctrl+Z / Y.
- **Croquis con coordenadas:** dibuja líneas, rectángulos, círculos, arcos y polígonos sobre la pieza con el ratón (imán a cuadrícula y a vértices, centros y puntos medios) o tecleando `x y`, `@dx dy` o `@distancia<ángulo`. Cada medida se puede corregir después; una figura cerrada dentro de otra queda como hueco.
- **Modo por figura:** cada figura detectada se graba con Relleno, Contorno, Invertir (orilla exterior + huecos vaciados), Línea u Omitir.
- **Textos:** de una sola línea (fuentes Hershey, ideales para grabar) o rellenos, con acentos y ñ; se arrastran en la vista previa.
- **Simulación real:** la vista previa dibuja el grabado con el ancho que de verdad deja la herramienta a esa profundidad (una ball mill de 1/8" a 0.1 mm corta 1.11 mm, no 3.175 mm) y avisa cuando un detalle no cabe o algo se sale de la pieza.
- **Imágenes y fotos:** detecta el dibujo solo. Reconoce una foto de papel con sombra y la ignora, voltea fondos oscuros y separa un logo de su fondo de color. También limpia puntitos, permite recortar arrastrando, sube el detalle para V-bit fino y muestra lo que detecta para ajustarlo a ojo.
- **Línea central:** las imágenes de trazos delgados (letras a mano, dibujos de línea) se pueden grabar en una sola pasada por el centro de cada trazo.
- **Aprende a leer el código:** toca cualquier línea del programa y te dice qué hace en español ("baja la herramienta 0.10 mm a 60 mm/min", "arco horario con centro en…") y resalta ese movimiento en la vista previa; con ↑ ↓ lo recorres paso a paso.
- **Simulación del recorrido:** el grabado aparece poco a poco con el ancho real de la herramienta, a 1×–500×, con barra para adelantar o regresar; el visor del código va narrando cada línea y al tocar una salta a ese momento.
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

## Programa de escritorio (Windows y Linux)

La misma app empaquetada con [Tauri](https://tauri.app). Usa el navegador del sistema (WebView2 en Windows, WebKitGTK en Linux), así que pesa poco y funciona sin internet.

Cada push a `main` (y cada PR) corre `.github/workflows/escritorio.yml`, que deja en *Actions → (la corrida) → Artifacts*:

- **MarCNC-windows:** `MarCNC-portable.exe` (se abre directo, sin instalar ni permisos de administrador) y el instalador `MarCNC_x.y.z_x64-setup.exe` (se instala solo para el usuario actual).
- **MarCNC-linux:** `MarCNC_x.y.z_amd64.deb` y `MarCNC_x.y.z_amd64.AppImage`, compilados en Ubuntu 22.04 para que sirvan en Ubuntu 22.04/24.04 y Linux Mint 21/22.

Al subir una etiqueta `v0.3.0` se publican todos como Release.

### Instalar en Linux Mint / Ubuntu

```bash
sudo apt install ./MarCNC_0.3.0_amd64.deb
```

O doble clic al `.deb` y *Instalar paquete*. Queda en el menú como **MarCNC**. Para desinstalar: `sudo apt remove marcnc`.

El AppImage no se instala: dale permiso de ejecución (`chmod +x MarCNC_*.AppImage`) y ábrelo. En Ubuntu 22.04 / Mint 21 puede pedir `sudo apt install libfuse2`.

### Windows

El .exe no está firmado: la primera vez Windows puede mostrar "Windows protegió su PC" → *Más información* → *Ejecutar de todas formas*.

### Compilar en tu equipo

Requiere [Rust](https://rustup.rs). En Linux Mint / Ubuntu, además:

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev build-essential patchelf file
```

En Windows hacen falta las herramientas de C++ de Visual Studio.

```bash
npm run escritorio   # ventana de desarrollo con recarga en vivo
npm run exe          # paquetes del sistema en el que compilas (src-tauri/target/release/bundle/)
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
