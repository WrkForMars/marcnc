// Visor del programa: una fila por línea; al tocar una se explica y se resalta su movimiento en la vista previa.

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {HTMLElement} box
 * @param {import('../cam/explain.js').Explained[]} ex
 * @param {{limit:number, explainAll:boolean, selected:number}} o selected = número de línea (1…) o 0
 */
export function renderCode(box, ex, o) {
  const shown = ex.slice(0, o.limit);
  box.classList.toggle('all', o.explainAll);
  box.innerHTML = shown.map(e => `<div class="row k-${e.kind}${e.n === o.selected ? ' sel' : ''}" data-n="${e.n}" role="option" aria-selected="${e.n === o.selected}">`
    + `<span class="no">${e.n}</span><code>${esc(e.code)}</code>${o.explainAll ? `<span class="ex">${esc(e.text)}</span>` : ''}</div>`).join('')
    + (ex.length > o.limit ? `<div class="more">… ${ex.length - o.limit} líneas más. El archivo guardado o copiado va completo.</div>` : '');
}

/** Marca la fila elegida sin volver a dibujar la lista, y la deja a la vista. */
export function markRow(box, n) {
  box.querySelector('.row.sel')?.classList.remove('sel');
  box.querySelector('.row[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
  const r = box.querySelector(`.row[data-n="${n}"]`);
  if (!r) return;
  r.classList.add('sel'); r.setAttribute('aria-selected', 'true');
  const top = r.offsetTop, h = box.clientHeight; // .code es position:relative
  if (top < box.scrollTop || top + r.offsetHeight > box.scrollTop + h) box.scrollTop = top - h / 3;
}

/** Nombre corto del tipo de línea, para la tarjeta de explicación. */
export const KIND_NAME = {
  comment: 'Comentario', setup: 'Preparación', tool: 'Herramienta', spindle: 'Husillo', rapid: 'Movimiento rápido',
  plunge: 'Bajada', retract: 'Subida', cut: 'Corte recto', arc: 'Corte en arco', end: 'Final', danger: 'Peligro', other: 'Otra',
};
