// Interfaz: une la carga de archivos, los textos, el cálculo y la vista previa.
import './styles.css';
import { buildDesign } from './design.js';
import { DEMO_SVG, DEMO_TEXT } from './demo.js';
import { generateGcode } from './cam/gcode.js';
import { computePlan } from './cam/plan.js';
import { isDesktop, saveTextDesktop } from './desktop.js';
import { toolGeometry } from './cam/tool.js';
import { parseSVG } from './input/svg.js';
import { traceImage } from './input/image.js';
import { bbox, createPreview } from './preview/canvas.js';
import { buildText, textElement, TEXT_FONTS } from './text/text.js';
import { renderList } from './ui/list.js';

const $ = id => document.getElementById(id);
const tick = () => new Promise(r => setTimeout(r, 0));

const state = {
  raw: null, rawId: 0, design: [], designNote: '', texts: [], elements: [],
  selected: -1, lastImage: null, fileName: '', gcode: '', plan: null, gen: 0, textSeq: 0,
  cache: new Map(),
};
const preview = createPreview($('cv'));

TEXT_FONTS.forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; $('tFont').append(o); });

/* ---------- parámetros del formulario ---------- */
const num = (id, def) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : def; };
function params() {
  return {
    W: num('pw', 90), H: num('ph', 50), margin: num('margin', 3), fit: $('fit').value, speck: num('speck', 0.5),
    toolType: $('ttype').value, dia: num('tdia', 3.175), depth: num('depth', 0.1), vAngle: num('vang', 60), vTip: num('vtip', 0.1),
    stepoverPct: num('stepover', 45), stepdown: num('stepdown', 0.2),
    toolNum: num('tnum', 1), rpm: num('rpm', 1000), fz: num('fz', 60), fxy: num('fxy', 130), retract: num('retract', 3),
    dialect: $('dialect').value, dec: +$('dec').value, tol: Math.max(0.002, num('tol', 0.05)), prog: num('prog', 1), arcs: $('arcs').checked,
  };
}

/* ---------- elementos ---------- */
function rebuildDesign() {
  const r = buildDesign(state.raw, params(), state.design);
  state.design = r.elements; state.designNote = r.note; state.cache.clear();
}
function assemble() {
  state.elements = state.design.concat(state.texts.map(textElement).filter(Boolean));
  if (state.selected >= state.elements.length) state.selected = -1;
}
const keyOf = e => (e.src === 'text' ? `t${e.text.id}:${e.text.x}:${e.text.y}:${e.text.rev}` : `d${state.rawId}:${state.design.indexOf(e)}`);

function select(i) {
  state.selected = i;
  const e = state.elements[i];
  const isText = !!(e && e.src === 'text');
  $('txtTitle').textContent = isText ? 'Editar texto' : 'Agregar texto';
  $('tAdd').hidden = isText; $('tDel').hidden = !isText; $('tNew').hidden = !isText;
  if (isText) {
    const t = e.text;
    $('tText').value = t.text; $('tFont').value = t.font; $('tH').value = t.h; $('tSp').value = t.sp;
    $('tX').value = +t.x.toFixed(1); $('tY').value = +t.y.toFixed(1);
  }
}

/* ---------- ciclo principal ---------- */
function busy(msg) { $('busy').hidden = !msg; if (msg) $('busyText').textContent = msg; }
function drawOnly(dragging = false) {
  const p = params();
  preview.draw({
    elements: state.elements, selected: state.selected, W: p.W, H: p.H,
    toolWidth: state.plan ? state.plan.tl.w : toolGeometry(p).w, plan: state.plan, showPath: $('showPath').checked, dragging,
  });
}
function renderAll() {
  drawOnly();
  $('elCount').textContent = state.elements.length ? `${state.elements.length} en la pieza` : '';
  renderList($('els'), $('allModes'), {
    elements: state.elements, selected: state.selected,
    onSelect: i => { select(i); renderAll(); },
    onMode: (i, m) => { const e = state.elements[i]; e.mode = m; if (e.src === 'text') e.text.mode = m; select(i); refresh(); },
    onModeAll: m => { state.elements.forEach(e => { if (e.type === 'region') { e.mode = m; if (e.src === 'text') e.text.mode = m; } }); refresh(); },
  });
}

function warnings(p, plan) {
  const r = plan.tl.r;
  const nm = (e, i) => (e.src === 'text' ? `El texto “${e.text.text}”` : `La figura ${i + 1}`);
  const out = state.elements.map((e, i) => {
    if (e.mode === 'skip') return null;
    const bb = bbox(e);
    return bb && (bb[0] - r < -0.01 || bb[1] - r < -0.01 || bb[2] + r > p.W + 0.01 || bb[3] + r > p.H + 0.01) ? nm(e, i) : null;
  }).filter(Boolean);
  const thin = state.elements.map((e, i) => (e.warn ? { e, i } : null)).filter(Boolean);
  const ws = [];
  if (state.designNote) ws.push(state.designNote);
  if (out.length) ws.push(`${out.join(', ')} se sale${out.length > 1 ? 'n' : ''} de la pieza; muévelo o reduce su tamaño.`);
  if (thin.length > 3) {
    const tot = thin.reduce((a, { e }) => a + (parseFloat(e.warn) || 0), 0);
    ws.push(`${thin.length} figuras tienen detalles más finos que la línea de ${plan.tl.w.toFixed(2)} mm${tot ? ` (${tot.toFixed(1)} mm² en total)` : ''}; están marcadas con “No cabe todo”. Prueba una herramienta más fina, menos profundidad, una pieza más grande o el modo Contorno.`);
  } else {
    thin.forEach(({ e, i }) => ws.push(`${nm(e, i)}: ${e.warn}.`));
  }
  return ws;
}

async function refresh() {
  const my = ++state.gen;
  busy('Calculando trayectorias…');
  await tick();
  if (my !== state.gen) return;
  const p = params();
  const tl = toolGeometry(p);
  const plan = await computePlan(state.elements, tl, {
    tol: p.tol, cache: state.cache, keyOf, onProgress: busy, isCancelled: () => my !== state.gen,
  });
  if (!plan || my !== state.gen) return;
  state.plan = plan;

  if (!state.elements.length) {
    state.gcode = '';
    $('code').textContent = 'Carga un SVG o una imagen, o agrega un texto, para generar el código.';
    $('stats').textContent = ''; $('warns').textContent = '';
  } else {
    busy('Escribiendo el código…');
    await tick();
    if (my !== state.gen) return;
    const g = generateGcode(plan, state.elements, p);
    state.gcode = g.text;
    $('code').textContent = g.lines > 4000
      ? g.text.split('\n').slice(0, 4000).join('\n') + `\n… (${g.lines - 4000} líneas más; usa Copiar o Descargar para el archivo completo)`
      : g.text;
    $('stats').textContent = '';
    [['Líneas', g.lines], ['Arcos', g.arcsN], ['Corte', `${g.cutLen.toFixed(0)} mm`], ['Pasadas', g.passes], ['Tiempo aprox.', `${Math.max(1, Math.round(g.mins))} min`]]
      .forEach(([a, b]) => { const s = document.createElement('span'); s.append(a + ' '); const bb = document.createElement('b'); bb.textContent = b; s.append(bb); $('stats').append(s); });
    const ws = warnings(p, plan);
    $('warns').textContent = '';
    if (ws.length) { const d = document.createElement('div'); d.className = 'warnbox'; d.textContent = ws.join(' '); $('warns').append(d); }
  }
  busy(null);
  renderAll();
  $('eff').textContent = `Ancho de línea a ${tl.depth} mm: ${tl.w.toFixed(2)} mm${tl.type === 'ball' ? ' (la bola solo corta con la punta)' : tl.type === 'v' ? ' (depende de la profundidad)' : ''}`;
}

async function loadShapes(fn, isImage) {
  $('loadErr').textContent = ''; $('toast').textContent = '';
  busy(isImage ? 'Vectorizando la imagen…' : 'Leyendo el SVG…');
  await tick();
  try {
    const t0 = performance.now();
    state.raw = fn(); state.rawId++;
    select(-1);
    busy('Separando figuras…');
    await tick();
    state.design = [];
    rebuildDesign(); assemble();
    $('imgOpts').hidden = !isImage;
    await refresh();
    $('toast').textContent = `Procesado en ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
  } catch (err) {
    busy(null);
    $('loadErr').textContent = err.message || String(err);
  }
}
function loadImage() {
  if (!state.lastImage) return;
  if ($('fit').value === 'native') $('fit').value = 'fill'; // una imagen no tiene unidades físicas
  loadShapes(() => traceImage(state.lastImage, +$('thr').value, $('imgHow').value), true);
}

/* ---------- archivos ---------- */
function openFile(f) {
  const isSvg = /svg/i.test(f.type) || /\.svg$/i.test(f.name);
  if (!isSvg && !/^image\//.test(f.type)) { $('loadErr').textContent = 'Ese archivo no es un SVG ni una imagen (PNG, JPG o WEBP).'; return; }
  state.fileName = f.name.replace(/\.[^.]+$/, '');
  const rd = new FileReader();
  if (isSvg) {
    rd.onload = () => { state.lastImage = null; const txt = String(rd.result); loadShapes(() => parseSVG(txt, $('svghost')), false); };
    rd.readAsText(f);
  } else {
    rd.onload = () => {
      const im = new Image();
      im.onload = () => { state.lastImage = im; loadImage(); };
      im.onerror = () => { $('loadErr').textContent = 'No pude abrir esa imagen.'; };
      im.src = String(rd.result);
    };
    rd.readAsDataURL(f);
  }
}
$('file').addEventListener('change', ev => {
  const f = ev.target.files[0];
  if (f) openFile(f);
  ev.target.value = '';
});
// arrastrar y soltar en cualquier parte de la ventana
let dragDepth = 0;
const hasFiles = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', ev => { if (!hasFiles(ev)) return; ev.preventDefault(); dragDepth++; $('drop').hidden = false; });
document.addEventListener('dragover', ev => { if (hasFiles(ev)) ev.preventDefault(); });
document.addEventListener('dragleave', ev => { if (hasFiles(ev) && --dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
document.addEventListener('drop', ev => {
  if (!hasFiles(ev)) return;
  ev.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  const f = ev.dataTransfer.files[0];
  if (f) openFile(f);
});
$('demo').addEventListener('click', () => { state.lastImage = null; state.fileName = ''; $('fit').value = 'native'; loadShapes(() => parseSVG(DEMO_SVG, $('svghost')), false); });
$('clear').addEventListener('click', () => {
  Object.assign(state, { raw: null, design: [], texts: [], lastImage: null, designNote: '', fileName: '' });
  $('imgOpts').hidden = true; assemble(); select(-1); refresh();
});
$('thr').addEventListener('input', () => { $('thrVal').textContent = $('thr').value; });
$('thr').addEventListener('change', loadImage);
$('imgHow').addEventListener('change', loadImage);

/* ---------- parámetros ---------- */
['pw', 'ph', 'margin', 'speck', 'fit'].forEach(id => $(id).addEventListener('change', () => { rebuildDesign(); assemble(); refresh(); }));
['depth', 'ttype', 'tdia', 'vang', 'vtip', 'tnum', 'rpm', 'fz', 'fxy', 'retract', 'stepdown', 'stepover', 'dialect', 'dec', 'tol', 'prog', 'arcs']
  .forEach(id => $(id).addEventListener('change', () => { $('vAngLbl').hidden = $('vTipLbl').hidden = $('ttype').value !== 'v'; refresh(); }));
$('showPath').addEventListener('change', () => drawOnly());

// los parámetros se recuerdan entre sesiones (cada taller tiene su máquina y su herramienta)
const SAVED = ['pw', 'ph', 'margin', 'speck', 'ttype', 'tdia', 'vang', 'vtip', 'tnum', 'depth', 'rpm', 'retract', 'fz', 'fxy',
  'stepdown', 'stepover', 'dialect', 'dec', 'tol', 'prog', 'arcs', 'imgHow', 'thr'];
const STORE = 'grabacnc:parametros';
const getVal = id => ($(id).type === 'checkbox' ? $(id).checked : $(id).value);
const setVal = (id, v) => { if ($(id).type === 'checkbox') $(id).checked = !!v; else $(id).value = v; };
const DEFAULTS = Object.fromEntries(SAVED.map(id => [id, getVal(id)]));
const syncLabels = () => { $('vAngLbl').hidden = $('vTipLbl').hidden = $('ttype').value !== 'v'; $('thrVal').textContent = $('thr').value; };
function storeParams() {
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(SAVED.map(id => [id, getVal(id)])))); } catch { /* sin almacenamiento: no pasa nada */ }
}
function restoreParams() {
  try { const o = JSON.parse(localStorage.getItem(STORE) || '{}'); SAVED.forEach(id => { if (id in o) setVal(id, o[id]); }); } catch { /* valores del HTML */ }
  syncLabels();
}
SAVED.forEach(id => $(id).addEventListener('change', storeParams));
$('reset').addEventListener('click', () => {
  SAVED.forEach(id => setVal(id, DEFAULTS[id]));
  storeParams(); syncLabels();
  if (state.lastImage) { loadImage(); return; }
  rebuildDesign(); assemble(); refresh();
  $('toast').textContent = 'Parámetros de la tarea de referencia restablecidos.';
});

/* ---------- tema ---------- */
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('grabacnc:tema', root.dataset.theme); } catch { /* solo esta sesión */ }
  drawOnly();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawOnly());

/* ---------- textos ---------- */
function textFromForm(t) {
  t.text = $('tText').value.slice(0, 80); t.font = $('tFont').value;
  t.h = Math.max(0.5, num('tH', 5)); t.sp = num('tSp', 0); t.x = num('tX', 0); t.y = num('tY', 0);
  t.rev = (t.rev || 0) + 1;
  return t;
}
async function addText(t) {
  busy('Preparando el texto…'); await tick();
  await buildText(t);
  state.texts.push(t); assemble();
  select(state.elements.findIndex(e => e.text === t));
}
$('tAdd').addEventListener('click', async () => {
  const t = textFromForm({ id: ++state.textSeq });
  if (!t.text.trim()) { $('loadErr').textContent = 'Escribe el texto que quieres grabar.'; return; }
  $('loadErr').textContent = '';
  await addText(t); refresh();
});
['tText', 'tFont', 'tH', 'tSp', 'tX', 'tY'].forEach(id => $(id).addEventListener('change', async () => {
  const e = state.elements[state.selected];
  if (!e || e.src !== 'text') return;
  const t = e.text, shapeBefore = t.text + t.font + t.h + t.sp;
  textFromForm(t);
  if (t.text + t.font + t.h + t.sp !== shapeBefore) { busy('Preparando el texto…'); await tick(); await buildText(t); }
  assemble(); select(state.elements.findIndex(x => x.text === t)); refresh();
}));
$('tDel').addEventListener('click', () => {
  const e = state.elements[state.selected];
  if (!e || e.src !== 'text') return;
  state.texts = state.texts.filter(t => t !== e.text); assemble(); select(-1); refresh();
});
$('tNew').addEventListener('click', () => { select(-1); renderAll(); $('tText').focus(); });

/* ---------- vista previa: selección y arrastre de textos ---------- */
const cv = $('cv');
let drag = null;
cv.addEventListener('pointerdown', ev => {
  const r = cv.getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const i = preview.hit(mx, my, state.elements, state.plan ? state.plan.tl.w : 1);
  select(i);
  if (i >= 0 && state.elements[i].src === 'text') {
    const [x, y] = preview.toMM(mx, my);
    const t = state.elements[i].text;
    drag = { i, t, sx: x, sy: y, x0: t.x, y0: t.y, moved: false };
    cv.setPointerCapture(ev.pointerId);
  }
  renderAll();
  if (i >= 0) document.querySelector(`.el[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
});
cv.addEventListener('pointermove', ev => {
  if (!drag) return;
  const r = cv.getBoundingClientRect();
  const [x, y] = preview.toMM(ev.clientX - r.left, ev.clientY - r.top);
  const nx = Math.round((drag.x0 + x - drag.sx) * 2) / 2, ny = Math.round((drag.y0 + y - drag.sy) * 2) / 2; // pasos de 0.5 mm
  if (nx === drag.t.x && ny === drag.t.y) return;
  drag.t.x = nx; drag.t.y = ny; drag.moved = true;
  const el = textElement(drag.t); el.paths = [];
  state.elements[drag.i] = el;
  $('tX').value = nx; $('tY').value = ny;
  drawOnly(true);
});
const endDrag = () => {
  if (!drag) return;
  const moved = drag.moved;
  drag.t.rev++; drag = null;
  if (moved) { assemble(); refresh(); }
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => drawOnly(), 120); });

/* ---------- salida ---------- */
$('copy').addEventListener('click', () => {
  const t = $('toast');
  if (!state.gcode) { t.textContent = 'Todavía no hay código.'; return; }
  navigator.clipboard.writeText(state.gcode).then(
    () => { t.textContent = 'Código copiado.'; },
    () => { const r = document.createRange(); r.selectNodeContents($('code')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); t.textContent = 'Selecciona y copia el texto marcado.'; },
  );
});
async function saveCode() {
  const t = $('toast');
  if (!state.gcode) { t.textContent = 'Todavía no hay código.'; return; }
  const name = `${(state.fileName || 'grabado').replace(/[^\w\-]+/g, '_')}_GM.txt`;
  if (isDesktop()) {
    try { const ruta = await saveTextDesktop(name, state.gcode); t.textContent = ruta ? `Guardado en ${ruta}` : 'Guardado cancelado.'; }
    catch (e) { t.textContent = ''; $('loadErr').textContent = `No se pudo guardar: ${e?.message || e}`; }
    return;
  }
  // dentro de un Artifact de Claude las descargas pasan por su capacidad; fuera, un enlace normal
  const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    try { await dl.save({ filename: name, data: state.gcode }); t.textContent = 'Archivo guardado.'; }
    catch (e) { t.textContent = e?.code === 'declined' ? 'Descarga cancelada.' : 'No se pudo descargar aquí; usa Copiar.'; }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([state.gcode], { type: 'text/plain' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  t.textContent = `Descargado como ${name}.`;
}
$('save').addEventListener('click', saveCode);
$('save2').addEventListener('click', saveCode);
document.addEventListener('keydown', ev => {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
  const k = ev.key.toLowerCase();
  if (k === 's') { ev.preventDefault(); saveCode(); } else if (k === 'o') { ev.preventDefault(); $('file').click(); }
});

/* ---------- inicio ---------- */
(async () => {
  restoreParams();
  $('fit').value = 'native';
  await loadShapes(() => parseSVG(DEMO_SVG, $('svghost')), false);
  Object.entries(DEMO_TEXT).forEach(([k, v]) => { const id = { text: 'tText', font: 'tFont', h: 'tH', sp: 'tSp', x: 'tX', y: 'tY' }[k]; $(id).value = v; });
  await addText(textFromForm({ id: ++state.textSeq }));
  select(-1);
  await refresh();
  $('toast').textContent = '';
})();
document.fonts?.ready.then(() => drawOnly());
