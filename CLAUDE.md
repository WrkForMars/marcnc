# MarCNC

App web que convierte un SVG o una imagen con fondo blanco en código G y M para grabado CNC.
Cada figura detectada tiene su propio modo de corte (Relleno, Contorno, Invertir, Línea, Omitir),
se pueden agregar textos y la vista previa simula el grabado con el ancho real de la herramienta.
Se reparte solo como app de escritorio con Tauri (`src-tauri/`): .exe de Windows y .deb / AppImage de Linux, publicados en un release al empujar una etiqueta `v*`. No hay versión web publicada (el repositorio es público en GitHub).
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
  work.js            manda trabajos pesados al worker; un trabajo nuevo del mismo carril cancela el anterior; sin
                     worker los hace en la página — probado
  worker.js / jobs.js  segundo hilo y los trabajos que sabe hacer (funciones puras: datos entran, datos salen)
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
  input/image.js     imagen (recorte, detalle) → píxeles al tamaño de trabajo (canvas) → trace.js en el worker
  input/trace.js     vectorizado puro: detect.js (o segment.js) → contornos con ImageTracer, o línea central — probado
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
  cam/toolpaths.js   relleno / contorno / tallado V (vcarve: vueltas cada vez más hondas, 0.1 mm hacia adentro) / invertir
                     / recortar / barrenar por elemento — probado
  cam/arcs.js        ajuste de arcos G02/G03 — probado
  cam/plan.js        cálculo con caché y orden de corte, cede el hilo cada ~30 ms
  cam/gcode.js       escritura del programa (función pura) — probado
  cam/cut.js         recortar: profundidad por figura (elementOp), herramienta por fuera/dentro (profilePaths), puentes,
                     rampa de entrada (passWalk: recorrido 3D de cada pasada) — probado
  cam/drill.js       barrenos: círculos del tamaño de la herramienta con G81/G83 (GRBL: movimientos sueltos), más
                     grandes en espiral con G02; al recortar, los huecos redondos chicos se barrenan — probado
  cam/tools.js       varias herramientas: cuál usa cada figura (toolFor: la elegida; recortar/barrenar → fresa plana;
                     tallado V → V-bit), assignOps (herramienta, profundidad y puentes de cada figura) y usedTools — probado
  cam/relief.js      relieve 3D desde una imagen en grises: acomodo en la pieza, drop cutter (la punta toca la superficie
                     sin comerse lo de al lado) y zigzag simplificado en 3D; se desbasta por niveles — probado
  cam/stock.js       resultado: placa virtual tallada por el programa (sello de cada herramienta a lo largo de la línea
                     de tiempo) y su imagen sombreada; corre en el worker (casilla Ver resultado) — probado
  cam/copies.js      varias copias en una placa: cuadrícula desde el dibujo (copyOffsets) y figura corrida (shiftElement).
                     Las copias van al final de state.elements con copyOf (índice del original): siguen su modo y
                     ajustes, no salen en la lista, y tocarlas elige el original — probado
  cam/checks.js      revisión antes de cortar: ficha de preparación (Exportar) y avisos de valores sin sentido — probado
  cam/material.js    perfiles de material: avances sugeridos por carga de viruta con el husillo de la máquina y avisos — probado
  cam/simulate.js    línea de tiempo del programa (duración por avance, posición en cada instante) — probado
  cam/explain.js     explica cada línea del programa siguiendo su estado (posición, modo G, avance) — probado
  text/hershey.js    texto de una línea (fuentes Hershey, datos en hershey-data.json)
  text/text.js       textos rellenos (canvas → ImageTracer) y posición en la pieza
  preview/canvas.js  dibujo de la vista previa y selección con el puntero
  ui/list.js         lista de figuras con miniatura y botones de modo; al pasar el cursor se resalta en la pieza
  ui/tool-figure.js  dibujo de la punta de la herramienta en la pieza y el ancho de línea que deja
  ui/back.js         Atrás (navegador, botón del ratón, gesto) cierra la última capa abierta en vez de salir — probado
  ui/help.js         botón "?" con explicación corta en los campos que confunden (textos en HELP)
  ui/code-view.js    visor del programa: tocar una línea la explica y resalta su movimiento
  ui/sheet.js        hoja de entrega imprimible (#sheet, solo visible con @media print)
tests/               Vitest en entorno node; helpers.js trae parseMoves() para leer G-code; verify.js revisa un programa
                     línea por línea (verificador independiente) y audit.test.js pasa por él plantillas, herramientas y relieves
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
  - **Varias herramientas** (Parámetros → Otras herramientas, guardadas en `marcnc:herramientas`; la principal es la 0):
    el programa empieza con la de lo primero que se corta, agrupa por herramienta (grabar y luego recortar) y entre una
    y otra cambia: Fanuc `M05` `G28 G91 Z0` `G90` `T# M06` `S M03` `G00 G43 H# Z{retract}` (H = número de la herramienta;
    la ficha y la hoja piden cargar esos largos en la máquina); GRBL o Fanuc sin cambiador: `M05`, comentario y `M00`
    (pausa para cambiarla y tomar Z0), sin G43. Con una sola herramienta el programa no cambia (ni lleva G43).
    `assignOps` (`cam/tools.js`) decide herramienta y profundidad de cada figura; tallado en V → el V-bit si hay uno.
    Cada herramienta extra tiene sus avances (los escritos; si no, los sugeridos para el material con su diámetro; si no,
    los del trabajo) y el tiempo se estima con los de cada una.
  - **Cada figura tiene su profundidad** (`e.op.depth`: la del trabajo, la suya o el grosor + 0.2 si se recorta) y su
    herramienta a esa profundidad (`e.tl`). Lo recortado va al final y, en cada pieza, los huecos antes que el contorno.
  - Contornos cerrados con pasadas de más de 0.25 mm, o recortes: bajan a Z0 y entran en **rampa de 5°** a lo largo del
    contorno; en la última pasada repasan la rampa a fondo. Si la rampa de 5° no cabe, bajan en la vuelta completa (hasta
    20°); solo si ni así cabe bajan de punta con `fz` (`rampLength` en `cam/cut.js`). Sobre un puente suben en vertical y
    vuelven a bajar con `fz`. Esos recorridos van en rectas (sin arcos). Con la tarea de referencia (0.1 mm) nada aplica.
  - Cualquier bajada de más de 30° (`STEEP`, medida con las coordenadas ya redondeadas) va a `fz`, y el tiempo estimado
    la cuenta a ese avance; las bajadas y `fz` se cuentan con los de cada herramienta.
  - `tests/verify.js` es un verificador independiente del programa; lo usan `audit.test.js` y `fuzz.test.js`.
  - Barrenos: Fanuc usa `G98 G81/G83 … R1 F{fz}` y `G80` después de cada uno; GRBL no tiene ciclos fijos y se escriben
    con G00/G01 (picoteo: sube a R y baja rápido hasta 0.2 mm arriba de lo ya barrenado). El visor explica los ciclos y
    la simulación recorre sus pasos (`steps`).
- **No bloquear la página:** nada de `getPointAtLength` en bucles (era O(n) por punto y congelaba Chrome).
  Procesos largos van en `computePlan` con cesiones del hilo, o en el worker: se agregan a `JOBS` en `jobs.js` y se
  llaman con `run()` de `work.js` (con `lane` si un cambio nuevo debe cancelar el anterior). Lo que usa canvas o DOM se
  queda en la página y le pasa al worker solo los datos.
  El programa se escribe en el worker (job `program`, con `forProgram` para mandar solo lo necesario de cada figura); con
  más de 20 000 líneas solo regresan las primeras 4 000 explicadas (`state.exPartial`) y la simulación pide las completas.
- **Distribución de la interfaz:** la pieza es el centro (banco oscuro `--stage` con reglas en mm). Herramientas en el riel
  izquierdo; inspector a la derecha con pestañas Figuras / Código G que muestra solo lo seleccionado. **Parámetros del
  trabajo** (pieza, herramienta, profundidad) en `#jobDlg`, resumidos en la barra de arriba de la pieza; **ajustes de
  máquina** (perfil con nombre, controlador, velocidades, área de trabajo y límites, formato) en `#setDlg`; los perfiles
  se guardan en `marcnc:maquinas` y los límites (0 = sin dato) los revisa `machineRisks` en `cam/checks.js`. Un solo botón principal: Exportar.
- **El croquis se maneja como SolidWorks** (sin copiar su aspecto), para que lo aprendido allá sirva aquí: orden de
  herramientas de su pestaña Croquis, Cota inteligente, PropertyManager con vista previa y ✓ / ✕ (Enter / Esc), "Para
  construcción" en Opciones, azul = insuficientemente definido, clic derecho termina la cadena o abre el menú, rueda =
  zoom en el cursor, botón central = desplazar, F = ajustar, Enter = repetir el último comando. Usar sus nombres en español.
- **Simple primero:** cada panel o diálogo muestra lo que casi todos usan; lo técnico va en un `details.more` ("Más opciones").
  La imagen abierta va arriba de la lista de figuras y pregunta una sola cosa: dibujo, objeto en una foto o relieve 3D.
  Un relieve no se vectoriza: `state.reliefSrc` guarda la imagen en grises y `rebuildDesign` arma un solo elemento
  `type: 'relief'` (sin `parts`; todo lo que recorra `parts` debe saltarlo).
- **Atrás regresa, no saca:** cada capa (diálogo, menú, ayuda, herramienta de dibujo, PropertyManager, panel de texto,
  pestaña Código G) tiene su entrada en el historial vía `createBack` en `main.js`. Una capa nueva se agrega a esa lista
  con `isOpen` y `close`; el observador de atributos (`hidden`, `open`, `aria-pressed`, `aria-selected`) la sincroniza sola.
  En el navegador, el primer Atrás en el inicio avisa y el segundo sale; en la app de escritorio no hay a dónde salir.
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

1. Pasar al worker los textos rellenos (canvas → ImageTracer). Ya corren ahí: vectorizado, separación de objetos,
   escritura y explicación del programa, y la simulación del material.

No se firmará el .exe: Windows mostrará la advertencia de SmartScreen la primera vez (Más información → Ejecutar de todas formas).
