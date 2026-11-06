# MarCNC

App web que convierte un SVG o una imagen con fondo blanco en código G y M para grabado CNC.
Cada figura detectada tiene su propio modo de corte (Relleno, Contorno, Invertir, Línea, Omitir),
se pueden agregar textos y la vista previa simula el grabado con el ancho real de la herramienta.
Se reparte solo como app de escritorio con Tauri (`src-tauri/`): .exe de Windows y .deb / AppImage de Linux, publicados en un release al empujar una etiqueta `v*`. No hay versión web publicada (el repositorio es privado).
Público: estudiantes de ingeniería (ITL/TecNM) y talleres escolares. Toda la interfaz va en español.

## Comandos

- `npm run dev` — servidor de desarrollo (Vite)
- `npm test` — pruebas (Vitest). Deben pasar antes de cada commit.
- `npm run build` — build de producción en `dist/`
- `npm run preview` — sirve `dist/` para probar el build
- `npm run escritorio` / `npm run exe` — app de escritorio con Tauri (requiere Rust); los paquetes de Windows y Linux los compila CI

## Arquitectura

Todo corre en el navegador; no hay backend. La app de escritorio es la misma web dentro de WebView2 (Windows) o WebKitGTK (Linux): lo único nativo es
el diálogo de "Guardar como" (`src/desktop.js` → comando `guardar_texto` en `src-tauri/src/main.rs`).
Las fuentes van empaquetadas (`@fontsource`) para que funcione sin internet; no cargar nada de CDNs.

```
src/
  main.js            interfaz: estado, eventos, ciclo de cálculo (refresh), parámetros recordados
  desktop.js         puente con Tauri (solo se usa dentro del .exe)
  model.js           tipos del modelo (Element, TextItem), MODES, MODE_NAME
  design.js          dibujo cargado → elementos en mm sobre la pieza
  demo.js            dibujo y texto de ejemplo
  templates.js       plantillas (llavero, placa, engrane de evolvente con cuñero, posavasos, regla) como croquis + textos — probado
  input/svg-path.js  lector de rutas SVG puro (sin DOM); curvas divididas por tolerancia — probado
  input/dxf.js       lector DXF puro (LINE, ARC, CIRCLE, LWPOLYLINE/POLYLINE con abombado, ELLIPSE, SPLINE, bloques),
                     $INSUNITS → mm, une tramos sueltos en contornos; entra al croquis a 1:1 — probado
  input/svg.js       lee un SVG con estilos y transformaciones (usa DOM); niveles de calidad SVG_QUALITY
  input/detect.js    qué píxeles son dibujo: Otsu, adaptativo para fotos con sombra, por color del fondo, limpieza — probado
  input/image.js     imagen (recorte, detalle) → detect.js (o segment.js) → contornos con ImageTracer, o línea central
  input/segment.js   objeto en una foto: toques ＋/− → GrabCut (mezclas de gaussianas + corte mínimo Boykov–Kolmogorov),
                     se calcula a ~360 px y la orilla se suaviza; la silueta entra en Contorno — probado
  input/centerline.js  esqueletización (Zhang–Suen) → polilíneas por pieza, puro — probado
  sketch/geometry.js croquis puro: figuras (incl. ranura y rect. redondeado), inferencias, girar/reflejar,
                     cotas que mandan (applyDims, definedState), figuras → elementos — probado
  sketch/editor.js   herramientas (incl. Cota), selección múltiple y recuadro, patrones, construcción, deshacer;
                     tras cada cambio hace cumplir las cotas guardadas. Dibuja en la capa #ov
  ui/sketch-props.js medidas editables de la figura seleccionada
  preview/dims.js    cotas sobre la vista previa (al borde y tamaño); dimensions/applyDimension en sketch/geometry.js — probado
  geometry/clipper.js  envolturas de Clipper (offset, unión, resta, regiones)
  geometry/simplify.js RDP, distancia a segmento, punto en polígono
  cam/tool.js        ancho de línea según herramienta y profundidad — probado
  cam/toolpaths.js   relleno / contorno / invertir por elemento — probado
  cam/arcs.js        ajuste de arcos G02/G03 — probado
  cam/plan.js        cálculo con caché y orden de corte, cede el hilo cada ~30 ms
  cam/gcode.js       escritura del programa (función pura) — probado
  cam/checks.js      revisión antes de cortar: ficha de preparación (Exportar) y avisos de valores sin sentido — probado
  cam/material.js    perfiles de material: avances sugeridos por carga de viruta con el husillo de la máquina y avisos — probado
  cam/simulate.js    línea de tiempo del programa (duración por avance, posición en cada instante) — probado
  cam/explain.js     explica cada línea del programa siguiendo su estado (posición, modo G, avance) — probado
  text/hershey.js    texto de una línea (fuentes Hershey, datos en hershey-data.json)
  text/text.js       textos rellenos (canvas → ImageTracer) y posición en la pieza
  preview/canvas.js  dibujo de la vista previa y selección con el puntero
  ui/list.js         lista de figuras con miniatura y botones de modo; al pasar el cursor se resalta en la pieza
  ui/tool-figure.js  dibujo de la punta de la herramienta en la pieza y el ancho de línea que deja
  ui/help.js         botón "?" con explicación corta en los campos que confunden (textos en HELP)
  ui/code-view.js    visor del programa: tocar una línea la explica y resalta su movimiento
  ui/sheet.js        hoja de entrega imprimible (#sheet, solo visible con @media print)
tests/               Vitest en entorno node; helpers.js trae parseMoves() para leer G-code
```

El croquis no pasa por `buildDesign`: ya está en mm de la pieza y `sketchElements` da los elementos directo.
Se guarda en localStorage (`marcnc:croquis`); si hay uno guardado, la app abre con él; si no, con la bienvenida (Dibujar, Abrir, ejemplo, plantillas).

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
    redondeados; se prueban los redondeos vecinos de I y J para que los radios difieran ≤ 0.005 mm (lo que acepta GRBL).
    Si ninguno cumple, o el arco se aparta más de la tolerancia, se escribe con rectas. Los arcos se ajustan sobre
    la trayectoria densa (`path.dense`), no la simplificada. `tests/fuzz.test.js` vigila todo esto con piezas aleatorias.
  - Fanuc: `%`, `O####`, `T# M06`, `G28 G91 Z0`. GRBL: nada de eso (lo rechaza).
- **No bloquear la página:** nada de `getPointAtLength` en bucles (era O(n) por punto y congelaba Chrome).
  Procesos largos van en `computePlan` con cesiones del hilo, o en un Web Worker.
- **Distribución de la interfaz:** la pieza es el centro (banco oscuro `--stage` con reglas en mm). Herramientas en el riel
  izquierdo; inspector a la derecha con pestañas Figuras / Código G que muestra solo lo seleccionado. **Parámetros del
  trabajo** (pieza, herramienta, profundidad) en `#jobDlg`, resumidos en la barra de arriba de la pieza; **ajustes de
  máquina** (controlador, velocidades, formato) en `#setDlg`. Un solo botón principal: Exportar.
- **El croquis se maneja como SolidWorks** (sin copiar su aspecto), para que lo aprendido allá sirva aquí: orden de
  herramientas de su pestaña Croquis, Cota inteligente, PropertyManager con vista previa y ✓ / ✕ (Enter / Esc), "Para
  construcción" en Opciones, azul = insuficientemente definido, clic derecho termina la cadena o abre el menú, rueda =
  zoom en el cursor, botón central = desplazar, F = ajustar, Enter = repetir el último comando. Usar sus nombres en español.
- **Simple primero:** cada panel o diálogo muestra lo que casi todos usan; lo técnico va en un `details.more` ("Más opciones").
  La imagen abierta va arriba de la lista de figuras y pregunta una sola cosa: dibujo u objeto en una foto.
- **Textos:** cada cosa se dice una vez y en el lugar donde se usa. Los atajos van en el `title` de los botones, no en
  párrafos de ayuda; los mensajes de estado dicen qué falta, no repiten la leyenda de colores.
- **Lo que se dibuja sobre la placa** usa los tokens `--plate-*` y `--pm-*`, que no cambian con el tema: la placa es metal
  claro en ambos, y el acento del tema oscuro no se vería sobre ella.
- **Interfaz:** textos en español, tono directo. Estilo visual: alto contraste, un solo color de acento,
  tema claro y oscuro con tokens CSS en `:root`, mobile first, espaciado en múltiplos de 4 px,
  bordes en lugar de sombras, contraste accesible. Todos los colores salen de tokens en `src/styles.css`.

## Pruebas

Cualquier cambio en `cam/`, `geometry/`, `input/svg-path.js`, `input/dxf.js`, `input/segment.js`, `input/centerline.js`, `design.js` o `text/hershey.js` lleva su prueba.
Las pruebas de `tests/gcode.test.js` fijan los parámetros de la tarea de referencia (pieza 90 × 50 mm,
T3 ball mill 1/8", S2200, F60 en Z, F130 en XY, retracción Z3, profundidad 0.1 mm): si una cambia,
es un cambio de comportamiento que hay que justificar.

## Pendiente (en orden de valor)

1. Perfiles de máquina (husillo máximo, recorrido) además de los de material.
2. Mover vectorizado y vaciado a un Web Worker.
3. Firmar el .exe (certificado de código) para que Windows no muestre la advertencia de SmartScreen.
