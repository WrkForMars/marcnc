// Lista de figuras y textos con sus botones de modo.
import { MODES } from '../model.js';
import { MODE_COLOR } from '../preview/canvas.js';

/**
 * @param {HTMLElement} box
 * @param {HTMLElement} allBox contenedor de los botones "Todas las figuras"
 * @param {{elements:any[], selected:number, onSelect:(i:number)=>void, onMode:(i:number, m:string)=>void, onModeAll:(m:string)=>void}} s
 */
export function renderList(box, allBox, s) {
  const { elements, selected, onSelect, onMode, onModeAll } = s;
  box.textContent = '';
  if (!elements.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Carga un SVG o una imagen, o agrega un texto.';
    box.append(p);
  }
  elements.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'el' + (i === selected ? ' sel' : '');
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
      t.textContent = e.type === 'line' ? 'Trazo' : 'Figura';
      const p = e.parts[0];
      sm.textContent = e.type === 'line'
        ? (p.closed ? 'cerrado' : 'abierto')
        : (p.holes.length ? `${p.holes.length} hueco${p.holes.length > 1 ? 's' : ''}` : 'sin huecos');
    }
    name.append(num, t, sm);
    top.append(name);
    if (e.warn) {
      const c = document.createElement('span');
      c.className = 'chip warn';
      c.textContent = e.src === 'text' && e.type === 'line' ? 'Muy chico' : 'No cabe todo';
      c.title = e.warn;
      top.append(c);
    }

    const seg = document.createElement('div');
    seg.className = 'seg';
    MODES[e.type].forEach(([m, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(e.mode === m));
      if (e.mode === m) b.style.background = `var(${MODE_COLOR[m]})`;
      b.addEventListener('click', ev => { ev.stopPropagation(); onMode(i, m); });
      seg.append(b);
    });
    row.append(top, seg);
    row.addEventListener('click', () => onSelect(i));
    row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(i); } });
    box.append(row);
  });

  allBox.textContent = '';
  if (elements.filter(e => e.type === 'region').length > 1) {
    const lab = document.createElement('span');
    lab.className = 'hint';
    lab.textContent = 'Todas las figuras:';
    allBox.append(lab);
    MODES.region.forEach(([m, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => onModeAll(m));
      allBox.append(b);
    });
  }
}
