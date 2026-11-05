# GrabaCNC

App web que convierte un SVG o una imagen con fondo blanco en código G y M para grabado CNC.
Cada figura detectada tiene su propio modo de corte (Relleno, Contorno, Invertir, Línea, Omitir),
se pueden agregar textos y la vista previa simula el grabado con el ancho real de la herramienta.
Se publica como web (GitHub Pages) y como .exe de Windows (Tauri, `src-tauri/`).
Público: estudiantes de ingeniería (ITL/TecNM) y talleres escolares. Toda la interfaz va en español.

## Comandos

- `npm run dev` — servidor de desarrollo (Vite)
- `npm test` — pruebas (Vitest). Deben pasar antes de cada commit.
- `npm run build` — build de producción en `dist/`
- `npm run preview` — sirve `dist/` para probar el build
- `npm run escritorio` / `npm run exe` — app de escritorio con Tauri (requiere Rust); el .exe de Windows lo compila CI

## Arquitectura

Todo corre en el navegador; no hay backend. El .exe es la misma web dentro de WebView2: lo único nativo es
el diálogo de "Guardar como" (`src/desktop.js` → comando `guardar_texto` en `src-tauri/src/main.rs`).
Las fuentes van empaquetadas (`@fontsource`) para que funcione sin internet; no cargar nada de CDNs.

```
src/
  main.js            interfaz: estado, eventos, ciclo de cálculo (refresh), parámetros recordados
  desktop.js         puente con Tauri (solo se usa dentro del .exe)
  model.js           tipos del modelo (Element, TextItem), MODES, MODE_NAME
  design.js          dibujo cargado → elementos en mm sobre la pieza
  demo.js            dibujo y texto de ejemplo
  input/svg-path.js  lector de rutas SVG puro (sin DOM); curvas divididas por tolerancia — probado
  input/svg.js       lee un SVG con estilos y transformaciones (usa DOM); niveles de calidad SVG_QUALITY
  input/image.js     imagen → contornos con ImageTracer, o línea central
  input/centerline.js  esqueletización (Zhang–Suen) → polilíneas por pieza, puro — probado
  sketch/geometry.js croquis puro: figuras por coordenadas, ajuste a puntos, lectura de "x y"/"@dx dy"/"@d<a",
                     figuras → elementos (una cerrada dentro de otra es hueco) — probado
  sketch/editor.js   herramientas, imán, mover, deshacer; dibuja en una capa (#ov) sobre la vista previa
  ui/sketch-props.js medidas editables de la figura seleccionada
  geometry/clipper.js  envolturas de Clipper (offset, unión, resta, regiones)
  geometry/simplify.js RDP, distancia a segmento, punto en polígono
  cam/tool.js        ancho de línea según herramienta y profundidad — probado
  cam/toolpaths.js   relleno / contorno / invertir por elemento — probado
  cam/arcs.js        ajuste de arcos G02/G03 — probado
  cam/plan.js        cálculo con caché y orden de corte, cede el hilo cada ~30 ms
  cam/gcode.js       escritura del programa (función pura) — probado
  text/hershey.js    texto de una línea (fuentes Hershey, datos en hershey-data.json)
  text/text.js       textos rellenos (canvas → ImageTracer) y posición en la pieza
  preview/canvas.js  dibujo de la vista previa y selección con el puntero
  ui/list.js         lista de figuras con los botones de modo
tests/               Vitest en entorno node; helpers.js trae parseMoves() para leer G-code
```

El croquis no pasa por `buildDesign`: ya está en mm de la pieza y `sketchElements` da los elementos directo.
Se guarda en localStorage (`grabacnc:croquis`); si hay uno guardado, la app abre con él en vez del ejemplo.

Flujo: archivo → `RawShape[]` (unidades de lienzo) → `buildDesign` (mm, Y hacia arriba) → elementos
→ `computePlan` (trayectorias del centro de la herramienta + orden) → `generateGcode`.

## Convenciones que no se rompen

- **Unidades:** mm. Origen en la esquina inferior izquierda de la pieza, Y hacia arriba, Z0 en la cara superior.
  El SVG y las imágenes tienen Y hacia abajo: la conversión ocurre solo en `design.js` y `text/`.
- **Clipper usa enteros:** coordenadas × `S` (1000, o sea µm). Convertir siempre con `toC`/`fromC`.
- **Ancho de línea ≠ diámetro:** una ball mill solo corta con la punta. Toda la geometría usa `toolGeometry().w`.
- **El vaciado se desplaza 0.98·r** a propósito, para entrar en ranuras del ancho exacto de la línea
  (como los huecos del logo de la placa). No "corregirlo" a 1.0·r.
- **Cada vuelta del vaciado se simplifica a 5 µm** (`POCKET_TOL`) antes del siguiente desplazamiento: sin eso los
  vértices se multiplican con cada vuelta y el cálculo es ~5× más lento. La cobertura no cambia.
- **Calidad del SVG:** la tolerancia de las curvas va en unidades de lienzo (lado mayor = 1000), no en mm, porque la
  escala final se conoce hasta `buildDesign` (que la devuelve en `scale`).
- **G-code:**
  - Avance de Z (`fz`) en cada bajada; avance XY (`fxy`) en el primer corte después de cada bajada.
  - Nunca un `G00` en X-Y con la herramienta abajo; toda retracción va a `retract`.
  - Comentarios en MAYÚSCULAS y sin acentos ni paréntesis anidados (muchos controladores no los aceptan).
  - Arcos solo con 2 o 3 decimales; el centro se recalcula sobre la mediatriz de los extremos ya
    redondeados para que el radio inicial y final difieran < 0.01 mm (con 2 decimales).
  - Fanuc: `%`, `O####`, `T# M06`, `G28 G91 Z0`. GRBL: nada de eso (lo rechaza).
- **No bloquear la página:** nada de `getPointAtLength` en bucles (era O(n) por punto y congelaba Chrome).
  Procesos largos van en `computePlan` con cesiones del hilo, o en un Web Worker.
- **Interfaz:** textos en español, tono directo. Estilo visual: alto contraste, un solo color de acento,
  tema claro y oscuro con tokens CSS en `:root`, mobile first, espaciado en múltiplos de 4 px,
  bordes en lugar de sombras, contraste accesible. Todos los colores salen de tokens en `src/styles.css`.

## Pruebas

Cualquier cambio en `cam/`, `geometry/`, `input/svg-path.js`, `input/centerline.js`, `design.js` o `text/hershey.js` lleva su prueba.
Las pruebas de `tests/gcode.test.js` fijan los parámetros de la tarea de referencia (pieza 90 × 50 mm,
T3 ball mill 1/8", S2200, F60 en Z, F130 en XY, retracción Z3, profundidad 0.1 mm): si una cambia,
es un cambio de comportamiento que hay que justificar.

## Pendiente (en orden de valor)

1. Paquete de entrega escolar: .txt + imagen de coordenadas en cuadrícula + tabla que explica cada línea.
2. Perfiles de máquina y material (avances sugeridos para aluminio, acrílico, MDF).
3. Mover vectorizado y vaciado a un Web Worker.
4. Simulación animada del recorrido.
5. PWA instalable (manifest + service worker).
6. Firmar el .exe (certificado de código) para que Windows no muestre la advertencia de SmartScreen.
