// Hoja de entrega: datos del alumno, parámetros de corte, dibujo sobre cuadrícula y programa explicado.
// Se arma en #sheet y se imprime (o se guarda como PDF desde el diálogo de impresión).
import { blockRanges } from '../cam/explain.js';
import { bbox } from '../preview/canvas.js';
import { MODES } from '../model.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = v => (+v).toFixed(2);
const TOOL = { ball: 'Ball mill (punta esférica)', flat: 'Fresa plana', v: 'V-bit' };
const MODE_ES = Object.fromEntries(Object.values(MODES).flat()); // todos los modos, con el nombre que ve el alumno
const MAX_ROWS = 3000;

/**
 * Dibujo de la pieza en cuadrícula de 1 y 10 mm con las coordenadas en los bordes, en blanco y negro para imprimir.
 * @returns {string} PNG como data URL
 */
export function sheetImage({ elements, W, H, toolWidth, css }) {
  const pxW = 1800, mL = 70, mB = 56, mT = 24, mR = 24;
  const k = (pxW - mL - mR) / W, pxH = Math.round(H * k + mT + mB);
  const c = document.createElement('canvas');
  c.width = pxW; c.height = pxH;
  const x = c.getContext('2d');
  const X = v => mL + v * k, Y = v => mT + (H - v) * k;
  const ink = css('--sheet-ink'), muted = css('--sheet-muted'), line = css('--sheet-line'), fill = css('--sheet-fill');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, pxW, pxH);

  // cuadrícula: 1 mm fina, 10 mm marcada, con su valor en los bordes
  x.lineWidth = 1;
  for (let v = 0; v <= W + 1e-9; v += 1) { x.strokeStyle = v % 10 === 0 ? line : fill; x.beginPath(); x.moveTo(Math.round(X(v)) + 0.5, Y(0)); x.lineTo(Math.round(X(v)) + 0.5, Y(H)); x.stroke(); }
  for (let v = 0; v <= H + 1e-9; v += 1) { x.strokeStyle = v % 10 === 0 ? line : fill; x.beginPath(); x.moveTo(X(0), Math.round(Y(v)) + 0.5); x.lineTo(X(W), Math.round(Y(v)) + 0.5); x.stroke(); }
  x.strokeStyle = ink; x.lineWidth = 2; x.strokeRect(X(0), Y(H), W * k, H * k);
  x.fillStyle = muted; x.font = '22px "IBM Plex Mono", monospace';
  x.textAlign = 'center'; x.textBaseline = 'top';
  for (let v = 0; v <= W + 1e-9; v += 10) x.fillText(String(v), X(v), Y(0) + 8);
  x.textAlign = 'right'; x.textBaseline = 'middle';
  for (let v = 0; v <= H + 1e-9; v += 10) x.fillText(String(v), X(0) - 10, Y(v));
  x.textAlign = 'left'; x.fillStyle = ink; x.font = '600 22px "IBM Plex Mono", monospace';
  x.fillText('X →', X(W) - 52, Y(0) + 38); x.save(); x.translate(18, Y(H) + 40); x.fillText('Y ↑', 0, 0); x.restore();
  // cero de la pieza
  x.beginPath(); x.arc(X(0), Y(0), 9, 0, 2 * Math.PI); x.fillStyle = ink; x.fill();

  // grabado con el ancho real, en gris, y la trayectoria del centro en negro
  const path = pts => { x.beginPath(); pts.forEach(([a, b], j) => (j ? x.lineTo(X(a), Y(b)) : x.moveTo(X(a), Y(b)))); x.stroke(); };
  x.lineCap = 'round'; x.lineJoin = 'round';
  // cada figura con el ancho que deja a su profundidad (un recorte, el diámetro; el tallado en V, cada vuelta el suyo);
  // un relieve se marca con su rectángulo: su zigzag llenaría el dibujo
  const drawn = elements.filter(e => e.type !== 'relief');
  // lo que la fresa corta por fuera de la pieza es aire: no tapa la regla
  x.save(); x.beginPath(); x.rect(X(0), Y(H), W * k, H * k); x.clip();
  x.strokeStyle = '#b5b5b5';
  drawn.forEach(e => (e.paths || []).forEach(p => { x.lineWidth = Math.max(2, (p.w ?? (e.tl ? e.tl.w : toolWidth)) * k); path(p.pts); }));
  x.strokeStyle = ink; x.lineWidth = 1.5;
  drawn.forEach(e => (e.paths || []).forEach(p => path(p.pts)));
  x.restore();
  elements.filter(e => e.type === 'relief').forEach(e => {
    const r = e.relief; x.setLineDash([12, 8]); x.strokeRect(X(r.x0), Y(r.y0 + r.h), r.w * k, r.h * k); x.setLineDash([]);
  });

  // número de cada figura
  x.font = '600 22px "IBM Plex Mono", monospace'; x.textBaseline = 'middle';
  elements.forEach((e, i) => {
    if (!e.paths || !e.paths.length || e.copyOf != null) return; // las copias no llevan número
    const bb = bbox(e);
    if (!bb) return;
    const lbl = e.src === 'text' ? 'T' : String(i + 1), w = x.measureText(lbl).width + 14;
    const tx = Math.min(X(bb[2]), pxW - w - 2), ty = Math.max(Y(bb[3]), 16);
    x.fillStyle = '#ffffff'; x.strokeStyle = ink; x.lineWidth = 2;
    x.fillRect(tx - w / 2, ty - 15, w, 30); x.strokeRect(tx - w / 2, ty - 15, w, 30);
    x.fillStyle = ink; x.textAlign = 'center'; x.fillText(lbl, tx, ty + 1);
  });
  return c.toDataURL('image/png');
}

/**
 * @param {{info:any, p:any, tl:any, g:any, ex:import('../cam/explain.js').Explained[], elements:any[], image:string, fileName:string, withProgram:boolean, test?:boolean, tools?:string[]}} d
 *   tools: las herramientas que usa el programa, en orden
 *   test: agrega el registro de prueba en máquina
 * @returns {string} HTML de la hoja
 */
export function sheetHTML(d) {
  const { info, p, tl, g, ex, elements } = d;
  const today = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const rows = pairs => pairs.map(([a, b, c, e]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td><td>${esc(e)}</td></tr>`).join('');

  const ranges = blockRanges(ex);
  const lineOf = block => ranges.find(r => r.block === block);
  const figs = elements.map((e, i) => {
    if (e.copyOf != null) return ''; // las copias van en el renglón del original
    const name = e.src === 'text' ? `TEXTO "${e.text.text.toUpperCase().replace(/[()]/g, '')}"` : `FIGURA ${i + 1}`;
    const r = lineOf(name), bb = bbox(e), first = e.paths && e.paths[0] ? e.paths[0].pts[0] : null;
    const label = e.src === 'text' ? `T · “${e.text.text}”` : `${i + 1} · ${e.label || (e.type === 'line' ? 'Trazo' : 'Figura')}`;
    return `<tr><td>${esc(label)}</td><td>${MODE_ES[e.mode]}</td><td>${first ? `X${f2(first[0])} Y${f2(first[1])}` : '—'}</td>`
      + `<td>${bb ? `X${f2(bb[0])}–${f2(bb[2])} · Y${f2(bb[1])}–${f2(bb[3])}` : '—'}</td><td>${r ? `${r.first}–${r.last}` : e.mode === 'skip' ? 'no se graba' : '—'}</td></tr>`;
  }).join('');

  const prog = d.withProgram ? `<h2>Programa explicado</h2>
    ${g.lines > MAX_ROWS ? `<p class="note">El programa tiene ${g.lines} líneas; aquí van las primeras ${MAX_ROWS}. El archivo .txt va completo.</p>` : ''}
    <table class="prog"><thead><tr><th>N</th><th>Código</th><th>Qué hace</th></tr></thead><tbody>
    ${ex.slice(0, MAX_ROWS).map(e => `<tr><td>${e.n}</td><td>${esc(e.code)}</td><td>${esc(e.text)}</td></tr>`).join('')}
    </tbody></table>` : '';

  return `<h1>Hoja de entrega · Programa CNC</h1>
  <table class="info">
    ${rows([
      ['Alumno o equipo', info.name || '', 'Número de control', info.id || ''],
      ['Grupo', info.group || '', 'Fecha', today],
      ['Práctica', info.practice || '', 'Profesor', info.teacher || ''],
      ['Archivo', d.fileName, 'Material', info.material || ''],
    ])}
  </table>

  <h2>Parámetros de corte</h2>
  <table class="info">
    ${rows([
      ['Pieza', `${p.W} × ${p.H} mm`, 'Cero de la pieza', 'Esquina inferior izquierda; Z0 en la cara superior'],
      ['Herramienta', `T${p.toolNum} · ${TOOL[tl.type]} Ø${+tl.D.toFixed(3)} mm`, 'Ancho de línea', `${f2(tl.w)} mm a ${f2(tl.depth)} mm de profundidad`],
      ['Husillo', `S${p.rpm} rpm (M03)`, 'Pasadas', `${g.passes} de ${f2(tl.depth / g.passes)} mm`],
      ['Avance en Z', `F${p.fz} mm/min`, 'Avance en X-Y', `F${p.fxy} mm/min`],
      ['Retracción', `Z${f2(p.retract)} mm`, 'Controlador', p.dialect === 'fanuc' ? 'Fanuc / Haas' : 'GRBL'],
      ...extraRows(d),
      ['Líneas del programa', String(g.lines), 'Corte y tiempo', `${g.cutLen.toFixed(0)} mm · ~${Math.max(1, Math.round(g.mins))} min`],
    ])}
  </table>

  <div class="avoid">
    <h2>Dibujo con coordenadas</h2>
    <p class="note">Cuadrícula de 1 mm, marcada cada 10 mm. El punto negro es el cero (X0 Y0). Gris: zona grabada con el ancho real de la línea; negro: recorrido del centro de la herramienta.</p>
    <img src="${d.image}" alt="Dibujo de la pieza sobre cuadrícula">
  </div>

  <h2>Figuras</h2>
  <table><thead><tr><th>Figura</th><th>Modo</th><th>Primer punto</th><th>Ocupa</th><th>Líneas del programa</th></tr></thead><tbody>${figs}</tbody></table>

  ${d.test ? testRecord(d) : ''}

  ${prog}

  <div class="sign"><div>Elaboró</div><div>Revisó</div><div>Calificación</div></div>`;
}


/**
 * Registro de prueba en máquina: lo que el programa espera y un espacio para anotar lo medido en el retazo. Con eso se
 * sabe si la máquina acepta el programa y qué tan cerca quedan el ancho de línea, las medidas y el tiempo.
 * @param {{p:any, tl:any, g:any, elements:any[], ex:any[]}} d
 */
export function testRecord(d) {
  const { tl, g, elements, ex } = d;
  const live = elements.filter(e => e.mode !== 'skip');
  const rows = [['El control acepta el programa sin alarmas', 'Corre completo', '']];
  rows.push(['Ancho de línea grabada', `${f2(tl.w)} mm`, '']);
  rows.push(['Profundidad del grabado', `${f2(tl.depth)} mm`, '']);
  const cut = live.find(e => e.mode === 'cut' && e.parts);
  if (cut) {
    const bb = bbox(cut);
    rows.push(['Medida de la pieza recortada', `${f2(bb[2] - bb[0])} × ${f2(bb[3] - bb[1])} mm`, '']);
    if (g.tabs) rows.push(['Los puentes sostienen la pieza hasta el final', `${g.tabs} puente${g.tabs > 1 ? 's' : ''}`, '']);
  }
  const drills = ex.filter(e => e.kind === 'drill').length + (ex.some(e => /G0[23] .*Z-/.test(e.code)) ? 1 : 0);
  if (drills) rows.push(['Barrenos: diámetro y si atraviesan', `Ø${f2(tl.D)} mm`, '']);
  if (ex.some(e => /M06|M00/.test(e.code) && e.n > 12)) rows.push(['Cambio de herramienta (y Z0 de nuevo si es a mano)', 'Sin golpes ni brincos de Z', '']);
  rows.push(['Tiempo de corte', `~${Math.max(1, Math.round(g.mins))} min`, '']);
  rows.push(['Avance y sonido (sin vibrar ni quemar)', '', '']);
  return `<div class="avoid">
    <h2>Registro de prueba en máquina</h2>
    <p class="note">Corre el programa en un retazo del mismo material, con una tabla de sacrificio debajo. Anota lo medido y marca si quedó bien.</p>
    <table class="test"><thead><tr><th>Qué revisar</th><th>Esperado</th><th>Medido</th><th>¿Bien?</th></tr></thead><tbody>
    ${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td class="blank"></td><td class="box">☐</td></tr>`).join('')}
    </tbody></table>
    <p class="note">Observaciones:</p><div class="lines"></div>
  </div>`;
}

/**
 * Renglones de parámetros que solo aplican a veces: el recorte (hasta dónde y en cuántas pasadas, con cuántos puentes),
 * otras profundidades, varias herramientas y copias.
 * @returns {[string,string,string,string][]}
 */
function extraRows(d) {
  const { tl, g, elements } = d, rows = [];
  const live = elements.filter(e => e.mode !== 'skip' && e.tl);
  const cut = live.find(e => e.mode === 'cut');
  if (cut) {
    const n = Math.max(1, Math.ceil(cut.tl.depth / cut.tl.down - 1e-9));
    rows.push(['Recorte', `${f2(cut.tl.depth)} mm en ${n} pasada${n > 1 ? 's' : ''} de ${f2(cut.tl.depth / n)} mm, entrada en rampa`, 'Puentes', g.tabs ? `${g.tabs}, cortarlos a mano al final` : 'ninguno']);
  }
  const drills = live.filter(e => e.mode === 'drill' || (e.paths || []).some(p => p.drill)).length;
  const other = [...new Set(live.filter(e => e.mode !== 'cut' && e.mode !== 'drill' && Math.abs(e.tl.depth - tl.depth) > 1e-9).map(e => f2(e.tl.depth)))];
  if (drills || other.length) rows.push(['Barrenos', drills ? `${drills} figura${drills > 1 ? 's' : ''} con barrenos (G81/G83 o espiral)` : '—', 'Otras profundidades', other.length ? `${other.join(', ')} mm` : '—']);
  if (d.tools && d.tools.length > 1) rows.push(['Herramientas en orden', d.tools.join(' → '), 'Cambio', d.p.dialect === 'grbl' || d.p.changer === false ? 'Pausa M00: cambiarla a mano y tomar Z0' : 'Automático (M06)']);
  const copies = 1 + new Set(elements.filter(e => e.copyOf != null).map(e => e.copyN)).size;
  if (copies > 1) rows.push(['Copias', `${copies} en la placa`, '', '']);
  return rows;
}
