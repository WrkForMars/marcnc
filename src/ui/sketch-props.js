// Propiedades de la figura del croquis seleccionada: cada medida es un campo editable.
import { ENTITY_NAME } from '../sketch/geometry.js';

const FIELDS = {
  rect: [['x', 'Esquina X (mm)'], ['y', 'Esquina Y (mm)'], ['w', 'Ancho (mm)', 'pos'], ['h', 'Alto (mm)', 'pos']],
  circle: [['cx', 'Centro X (mm)'], ['cy', 'Centro Y (mm)'], ['r', 'Radio (mm)', 'pos']],
  arc: [['cx', 'Centro X (mm)'], ['cy', 'Centro Y (mm)'], ['r', 'Radio (mm)', 'pos'], ['a1', 'Ángulo inicial (°)'], ['a2', 'Ángulo final (°)']],
  poly: [['cx', 'Centro X (mm)'], ['cy', 'Centro Y (mm)'], ['r', 'Radio (mm)', 'pos'], ['n', 'Lados', 'sides'], ['rot', 'Rotación (°)']],
};

const numInput = (value, onSet, check) => {
  const i = document.createElement('input');
  i.type = 'number'; i.step = 'any'; i.value = String(+(+value).toFixed(3));
  i.addEventListener('change', () => {
    const v = parseFloat(i.value);
    const ok = Number.isFinite(v) && (check !== 'pos' || v > 0) && (check !== 'sides' || (v >= 3 && v <= 64));
    if (!ok) { i.value = String(+(+value).toFixed(3)); i.setAttribute('aria-invalid', 'true'); return; }
    i.removeAttribute('aria-invalid');
    onSet(check === 'sides' ? Math.round(v) : v);
  });
  return i;
};
const field = (label, input, full = false) => {
  const l = document.createElement('label');
  if (full) l.className = 'full';
  l.append(label, input);
  return l;
};

/**
 * @param {HTMLElement} box contenedor .params
 * @param {import('../sketch/geometry.js').Entity} e
 * @param {(patch:object)=>void} onPatch
 * @returns {string} nombre de la figura, para el título
 */
export function renderSketchProps(box, e, onPatch) {
  box.textContent = '';
  if (e.type === 'line' && e.pts.length > 12) {
    // muchos puntos (una figura copiada de un archivo): se edita su posición y su tamaño, no cada punto
    const xs = e.pts.map(p => p[0]), ys = e.pts.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    const move = (dx, dy) => onPatch({ pts: e.pts.map(([x, y]) => [x + dx, y + dy]) });
    const scale = (sx, sy) => onPatch({ pts: e.pts.map(([x, y]) => [x0 + (x - x0) * sx, y0 + (y - y0) * sy]) });
    box.append(
      field('Esquina X (mm)', numInput(x0, v => move(v - x0, 0))), field('Esquina Y (mm)', numInput(y0, v => move(0, v - y0))),
      field('Ancho (mm)', numInput(w, v => scale(w > 0 ? v / w : 1, 1), 'pos')), field('Alto (mm)', numInput(h, v => scale(1, h > 0 ? v / h : 1), 'pos')),
    );
    const n = document.createElement('p');
    n.className = 'hint full';
    n.textContent = `${e.pts.length} puntos${e.closed ? ', cerrada' : ''}. Muévela con las flechas o arrastrándola.`;
    box.append(n);
  } else if (e.type === 'line') {
    e.pts.forEach((p, i) => {
      const set = j => v => onPatch({ pts: e.pts.map((q, k) => (k === i ? (j ? [q[0], v] : [v, q[1]]) : q)) });
      box.append(field(`Punto ${i + 1} X`, numInput(p[0], set(0))), field(`Punto ${i + 1} Y`, numInput(p[1], set(1))));
    });
    if (e.pts.length >= 3) {
      const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = e.closed;
      c.addEventListener('change', () => onPatch({ closed: c.checked }));
      const l = document.createElement('label');
      l.className = 'full check';
      l.append(c, ' Cerrada (une el último punto con el primero)');
      box.append(l);
    }
  } else {
    FIELDS[e.type].forEach(([k, label, check]) => box.append(field(label, numInput(e[k], v => onPatch({ [k]: v }), check))));
  }
  return ENTITY_NAME[e.type];
}
