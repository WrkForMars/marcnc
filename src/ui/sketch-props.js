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
  if (e.type === 'line') {
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
