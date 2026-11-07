// Lista de figuras y textos con sus botones de modo.
import { MODES } from '../model.js';
import { MODE_COLOR, bbox, outlines } from '../preview/canvas.js';
import { circleOf } from '../cam/drill.js';

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
 *   onHover?:(i:number)=>void, onOpts?:(i:number, patch:object)=>void, job?:{depth:number, thick:number}}} s
 *   onHover: el cursor entra a un renglón (i) o sale (−1), para resaltarlo en la pieza; onOpts: profundidad propia o puentes
 */
export function renderList(box, allBox, s) {
  const { elements, selected, onSelect, onMode, onModeAll, onHover, onOpts, job } = s;
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
      const p = e.parts && e.parts[0]; // un relieve no tiene contornos: trae su detalle
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
    // Barrenar solo en un círculo; Tallado V solo con un V-bit
    MODES[e.type].filter(([m]) => m === e.mode || (m !== 'drill' || circleOf(e)) && (m !== 'vcarve' || e.tl?.type === 'v')).forEach(([m, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(e.mode === m));
      b.style.setProperty('--mc', `var(${MODE_COLOR[m]})`);
      b.addEventListener('click', ev => { ev.stopPropagation(); onMode(i, m); });
      seg.append(b);
    });
    row.append(top, seg);
    if (i === selected && onOpts && job && e.mode !== 'skip') row.append(optsRow(e, i, onOpts, job));
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
    MODES.region.filter(([m]) => m !== 'drill' && m !== 'vcarve').forEach(([m, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => onModeAll(m));
      g.append(b);
    });
    allBox.append(lab, g);
  }
}

/**
 * Ajustes de la figura elegida: su propia profundidad o, si se recorta, cuántos puentes.
 * Vacío = lo del trabajo (la profundidad de Parámetros, los puentes automáticos).
 */
function optsRow(e, i, onOpts, job) {
  const box = document.createElement('div');
  box.className = 'el-opts';
  box.addEventListener('click', ev => ev.stopPropagation());
  box.addEventListener('keydown', ev => ev.stopPropagation());
  if (job.tools && job.tools.length > 1) {
    // con más de una herramienta: con cuál se corta esta figura (vacío = la automática)
    const tl = document.createElement('label');
    tl.append('Herramienta');
    const sel = document.createElement('select');
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = `Automática (${job.tools[e.op?.tool ?? 0].split(' · ')[0]})`; sel.append(auto);
    job.tools.forEach((t, k) => { const o = document.createElement('option'); o.value = String(k); o.textContent = t; sel.append(o); });
    sel.value = e.opts?.tool != null ? String(e.opts.tool) : '';
    sel.addEventListener('change', () => onOpts(i, { tool: sel.value === '' ? null : +sel.value }));
    tl.append(sel);
    box.append(tl);
  }
  const lab = document.createElement('label');
  if (e.mode === 'cut') {
    lab.append('Puentes');
    const sel = document.createElement('select');
    [['', 'Automático'], ['0', 'Ninguno'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6'], ['8', '8']].forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o);
    });
    sel.value = e.opts?.tabs != null ? String(e.opts.tabs) : '';
    sel.addEventListener('change', () => onOpts(i, { tabs: sel.value === '' ? null : +sel.value }));
    lab.append(sel);
    const note = document.createElement('small');
    note.textContent = `Atraviesa ${+(job.thick + 0.2).toFixed(2)} mm (grosor + 0.2)`;
    box.append(lab, note);
  } else {
    // un barreno atraviesa la pieza salvo que se le dé su profundidad (ciego)
    const through = e.mode === 'drill', def = through ? +(job.thick + 0.2).toFixed(2) : e.mode === 'relief' ? 2 : job.depth;
    lab.append('Profundidad (mm)');
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0.01'; inp.max = '100'; inp.step = '0.05';
    inp.placeholder = String(def);
    inp.value = e.opts?.depth > 0 ? String(e.opts.depth) : '';
    inp.addEventListener('change', () => { const v = parseFloat(inp.value); onOpts(i, { depth: v > 0 ? v : null }); });
    lab.append(inp);
    const note = document.createElement('small');
    note.textContent = e.mode === 'relief' ? 'Lo más oscuro baja esto' : inp.value ? 'Propia de esta figura' : through ? 'Pasante (grosor + 0.2)' : 'La del trabajo';
    box.append(lab, note);
  }
  return box;
}
