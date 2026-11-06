// Ayuda en los campos que confunden: un botón "?" junto a la etiqueta abre una explicación corta.
// Una sola burbuja para toda la página; se cierra con Esc, tocando fuera o con el mismo botón.

/** id del campo → [título, explicación]. Frases cortas, para alguien que nunca ha usado una CNC. */
export const HELP = {
  imgMode: ['Detectar el dibujo', 'Automático sirve para un dibujo oscuro sobre papel claro. Objeto en una foto: toca el objeto y la app lo separa del fondo aunque esté revuelto; si algo sobra (una mano, la mesa), elige Fondo y tócalo.'],
  fit: ['Tamaño del dibujo', 'Ajustar: el dibujo crece o se encoge hasta llenar la pieza, dejando el margen. Elegir: tú das el ancho y el alto. Escala 1:1: cada unidad del SVG es 1 mm.'],
  margin: ['Margen', 'Espacio libre entre el dibujo y la orilla de la pieza cuando el dibujo se ajusta a ella.'],
  speck: ['Ignorar manchas', 'Las figuras con menos área que esta se descartan: suelen ser puntitos o polvo del escaneo, no parte del dibujo.'],
  material: ['Material', 'Llena avances y profundidad por pasada con valores prudentes para ese material y tu velocidad de husillo. Puedes cambiarlos después; si alguno es arriesgado, la app te avisa.'],
  ttype: ['Tipo de herramienta', 'Ball mill: punta redonda; a poca profundidad deja una línea más angosta que su diámetro. Fresa plana: deja una línea del ancho de su diámetro. V-bit: punta en V; la línea se ensancha mientras más baja.'],
  tdia: ['Diámetro', 'El grueso de la herramienta, medido en el cuerpo. Una de 1/8" mide 3.175 mm.'],
  tnum: ['Número (T)', 'Posición de la herramienta en el carrusel de la máquina. El programa la pide con T y M06 (solo en Fanuc).'],
  depth: ['Profundidad', 'Qué tanto entra la herramienta en el material, medido desde la cara de arriba (Z0). Más profundidad, línea más ancha con ball mill o V-bit.'],
  stepdown: ['Profundidad por pasada', 'Lo más que baja en una sola vuelta. Si la profundidad total es mayor, repite el recorrido bajando cada vez. Menos por pasada cuida la herramienta en materiales duros.'],
  stepover: ['Paso de vaciado', 'Al rellenar un área, cuánto se mueve de una vuelta a la siguiente, en % del ancho de la línea. Menos de 50 % no deja crestas; más es más rápido pero puede dejar rayas.'],
  vang: ['Ángulo del V-bit', 'Ángulo de la punta. Con 60° la línea crece más rápido con la profundidad que con 90°.'],
  vtip: ['Punta del V-bit', 'Ancho de la punta plana, si la tiene. Con 0 la punta es aguda.'],
  dialect: ['Controlador', 'El "idioma" de tu máquina. Fanuc / Haas usa % y número de programa; GRBL (Arduino, CNC de escritorio) los rechaza.'],
  rpm: ['Husillo', 'Vueltas por minuto de la herramienta (S). Usa la que acepte tu máquina; los avances sugeridos se calculan con ella.'],
  retract: ['Retracción Z', 'Altura a la que sube la herramienta para moverse sin tocar la pieza. Que libre las prensas y tornillos.'],
  fz: ['Avance en Z', 'Velocidad al bajar dentro del material (F en las bajadas). Más lento que en X-Y: la herramienta corta peor de punta.'],
  fxy: ['Avance en X-Y', 'Velocidad al cortar de lado (F). Muy rápido rompe la herramienta o deja mal acabado; muy lento quema madera y acrílico.'],
  dec: ['Decimales', 'Cuántos decimales llevan las coordenadas. 2 basta para la mayoría de las máquinas (centésimas de mm).'],
  prog: ['Número de programa', 'El O0001 del inicio en Fanuc: así se identifica el programa en la memoria del control.'],
  tol: ['Tolerancia de curvas', 'Cuánto se puede apartar el recorrido de la curva real. Menos es más fiel pero el programa sale más largo.'],
  arcs: ['Arcos G02/G03', 'Escribe las curvas como arcos en vez de muchas rectas cortas: el programa queda más corto y el corte más suave.'],
};

/** Agrega el botón "?" a la etiqueta de cada campo de HELP que exista en la página. */
export function attachHelp(doc = document) {
  const pop = doc.createElement('div');
  pop.className = 'helppop'; pop.id = 'helpPop'; pop.setAttribute('role', 'dialog'); pop.hidden = true;
  doc.body.append(pop);
  let owner = null;
  const close = () => { pop.hidden = true; if (owner) owner.setAttribute('aria-expanded', 'false'); owner = null; };
  const open = (btn, [title, text]) => {
    // la burbuja vive dentro del diálogo abierto (si lo hay) para quedar por encima de él
    const host = btn.closest('dialog') || doc.body;
    if (pop.parentElement !== host) host.append(pop);
    pop.textContent = '';
    const b = doc.createElement('b'); b.textContent = title;
    const p = doc.createElement('p'); p.textContent = text;
    pop.append(b, p);
    pop.hidden = false;
    owner = btn; btn.setAttribute('aria-expanded', 'true');
    const inBody = host === doc.body;
    const r = btn.getBoundingClientRect(), hr = inBody ? { left: -scrollX, top: -scrollY } : host.getBoundingClientRect();
    const room = inBody ? innerWidth : host.clientWidth; // dentro de un diálogo, sin salirse de él
    const w = Math.min(320, room - 32);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(16, Math.min(r.left - hr.left - 16, room - 16 - w)) + 'px';
    pop.style.top = (r.bottom - hr.top + 8 + (inBody ? 0 : host.scrollTop)) + 'px';
  };
  Object.entries(HELP).forEach(([id, h]) => {
    const input = doc.getElementById(id);
    const label = input && input.closest('label');
    if (!label || label.querySelector('.help')) return;
    const btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'help'; btn.textContent = '?';
    btn.setAttribute('aria-label', `Qué es: ${h[0]}`); btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); if (owner === btn) close(); else open(btn, h); });
    // junto al texto de la etiqueta, en el mismo renglón (antes del campo)
    const textNode = [...label.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!textNode) { label.prepend(btn); return; }
    const row = doc.createElement('span');
    row.className = 'lbl-row';
    textNode.replaceWith(row);
    row.append(textNode, btn);
  });
  doc.addEventListener('pointerdown', ev => { if (!pop.hidden && !pop.contains(ev.target) && !ev.target.closest?.('.help')) close(); });
  doc.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !pop.hidden) { ev.preventDefault(); ev.stopPropagation(); close(); } }, true);
  doc.addEventListener('close', close, true); // al cerrar un diálogo
}
