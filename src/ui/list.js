// Lista de figuras y textos con sus botones de modo.
import { MODES } from '../model.js';
import { MODE_COLOR, bbox, outlines } from '../preview/canvas.js';

const NS = 'http://www.w3.org/2000/svg';
const thumbs = new WeakMap(); // miniatura por elemento: se arma una vez
/** Miniatura de la figura (32 px), ajustada a su caja; las áreas rellenas con sus huecos, los trazos como línea. */
function thumb(e) {
  if (thumbs.has(e)) return thumbs.get(e).cloneNode(true);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'thumb'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('viewBox', '0 0 32 32');
  const b = bbox(e);
  if (b) {
    const s = 28 / Math.max(b[2] - b[0], b[3] - b[1], 1e-6), ox = 16 - ((b[0] + b[2]) / 2) * s, oy = 16 + ((b[1] + b[3]) / 2) * s;
    let d = '';
    outlines(e).forEach(({ pts, closed }) => {
      const step = Math.max(1, Math.floor(pts.length / 120)); // basta con ~120 puntos por contorno a 32 px
      for (let i = 0; i < pts.length; i += step) d += `${i ? 'L' : 'M'}${(ox + pts[i][0] * s).toFixed(1)} ${(oy - pts[i][1] * s).toFixed(1)}`;
      if (closed) d += 'Z';
    });
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', e.type === 'region' ? 'area' : 'stroke');
    svg.append(p);
  }
  thumbs.set(e, svg);
  return svg.cloneNode(true);
}

/**
 * @param {HTMLElement} box
 * @param {HTMLElement} allBox contenedor de los botones "Todas las figuras"
 * @param {{elements:any[], selected:number, onSelect:(i:number)=>void, onMode:(i:number, m:string)=>void, onModeAll:(m:string)=>void,
 *   onHover?:(i:number)=>void}} s onHover: el cursor entra a un renglón (i) o sale (−1), para resaltarlo en la pieza
 */
export function renderList(box, allBox, s) {
  const { elements, selected, onSelect, onMode, onModeAll, onHover } = s;
  box.textContent = '';
  if (!elements.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Aquí aparecen las figuras de la pieza, cada una con su modo de corte.';
    box.append(p);
  }
  elements.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'el' + (i === selected ? ' sel' : '');
    row.style.setProperty('--mc', `var(${MODE_COLOR[e.mode]})`); // franja del color de su modo
    row.tabIndex = 0;
    row.dataset.i = String(i);

    const top = document.createElement('div');
    top.className = 'el-top';
    const name = document.createElement('div');
    name.className = 'el-name';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = e.src === 'text' ? 'T' : String(i + 1);
    num.style.background = `var(${MODE_COLOR[e.mode]})`;
    const t = document.createElement('span');
    t.className = 't';
    const sm = document.createElement('small');
    if (e.src === 'text') {
      t.textContent = `“${e.text.text}”`;
      sm.textContent = `${e.text.h} mm · ${e.type === 'line' ? 'una línea' : 'rellena'}`;
    } else {
      t.textContent = e.label || (e.type === 'line' ? 'Trazo' : 'Figura');
      const p = e.parts[0];
      sm.textContent = e.detail ? e.detail : e.type === 'line'
        ? (e.parts.length > 1 ? `${e.parts.length} tramos` : p.closed ? 'cerrado' : 'abierto')
        : (p.holes.length ? `${p.holes.length} hueco${p.holes.length > 1 ? 's' : ''}` : 'sin huecos');
    }
    name.append(thumb(e), num, t, sm);
    top.append(name);
    if (e.warn) {
      const c = document.createElement('span');
      c.className = 'chip warn';
      c.textContent = e.src === 'text' && e.type === 'line' ? 'Muy chico' : 'No cabe todo';
      c.title = e.warn;
      top.append(c);
    }

    const seg = document.createElement('div');
    seg.className = 'modes';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Modo de corte');
    MODES[e.type].forEach(([m, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(e.mode === m));
      b.style.setProperty('--mc', `var(${MODE_COLOR[m]})`);
      b.addEventListener('click', ev => { ev.stopPropagation(); onMode(i, m); });
      seg.append(b);
    });
    row.append(top, seg);
    row.addEventListener('click', () => onSelect(i));
    if (onHover) { row.addEventListener('mouseenter', () => onHover(i)); row.addEventListener('mouseleave', () => onHover(-1)); }
    row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(i); } });
    box.append(row);
  });

  allBox.textContent = '';
  if (elements.filter(e => e.type === 'region').length > 1) {
    const lab = document.createElement('span');
    lab.className = 'hint';
    lab.textContent = 'Todas las figuras';
    const g = document.createElement('div');
    g.className = 'modes';
    MODES.region.forEach(([m, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => onModeAll(m));
      g.append(b);
    });
    allBox.append(lab, g);
  }
}
