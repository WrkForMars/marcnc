// Interfaz: une la carga de archivos, los textos, el cálculo y la vista previa.
import './styles.css';
import { buildDesign } from './design.js';
import { DEMO_SVG, DEMO_TEXT } from './demo.js';
import { explainProgram } from './cam/explain.js';
import { generateGcode } from './cam/gcode.js';
import { buildTimeline, clock, positionAt, segAt, segPoint, timeOfLine } from './cam/simulate.js';
import { computePlan } from './cam/plan.js';
import { isDesktop, saveTextDesktop } from './desktop.js';
import { toolGeometry } from './cam/tool.js';
import { parseSVG, SVG_QUALITY } from './input/svg.js';
import { traceImage } from './input/image.js';
import { bbox, createPreview } from './preview/canvas.js';
import { buildText, textElement, TEXT_FONTS } from './text/text.js';
import { renderList } from './ui/list.js';
import { KIND_NAME, markRow, renderCode } from './ui/code-view.js';
import { sheetHTML, sheetImage } from './ui/sheet.js';
import { renderSketchProps } from './ui/sketch-props.js';
import { createSketchEditor } from './sketch/editor.js';
import { applyDimension, dimensions, entityBox, sketchElements, translate } from './sketch/geometry.js';
import { dimAt, drawDims } from './preview/dims.js';
import { fromC } from './geometry/clipper.js';

const $ = id => document.getElementById(id);
const tick = () => new Promise(r => setTimeout(r, 0));

const state = {
  raw: null, rawId: 0, design: [], designNote: '', texts: [], elements: [],
  selected: -1, textOpen: false, ready: false, lastImage: null, imgCrop: null, imgMask: null, imgInfo: null, imgView: 'mask', lastSvg: '', fileName: '', designScale: 0, designSize: [0, 0], demoFit: false, gcode: '', plan: null, gen: 0, textSeq: 0,
  cache: new Map(), sketchEls: [], dims: null, dimHits: [], clip: null, explained: [], codeSel: 0, lastG: null,
};
const preview = createPreview($('cv'));

TEXT_FONTS.forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; $('tFont').append(o); });

/* ---------- parámetros del formulario ---------- */
const num = (id, def) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : def; };
// un número fuera del rango del campo (min/max del HTML) se corrige en cuanto se escribe, antes de usarse
document.addEventListener('change', ev => {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
  const v = parseFloat(el.value), lo = parseFloat(el.min), hi = parseFloat(el.max);
  let fixed = v;
  if (!Number.isFinite(v)) fixed = parseFloat(el.defaultValue);
  else if (Number.isFinite(lo) && v < lo) fixed = lo;
  else if (Number.isFinite(hi) && v > hi) fixed = hi;
  if (fixed !== v && Number.isFinite(fixed)) {
    el.value = String(fixed);
    const name = el.closest('label')?.firstChild?.textContent?.trim() || 'Ese valor';
    $('toast').textContent = `${name}: se ajustó a ${fixed}, el valor permitido más cercano.`;
  }
}, true);

function params() {
  return {
    W: num('pw', 90), H: num('ph', 50), margin: num('margin', 3), fit: $('fit').value, drawW: num('dw', 0), speck: num('speck', 0.5),
    toolType: $('ttype').value, dia: num('tdia', 3.175), depth: num('depth', 0.1), vAngle: num('vang', 60), vTip: num('vtip', 0.1),
    stepoverPct: num('stepover', 45), stepdown: num('stepdown', 0.2),
    toolNum: num('tnum', 1), rpm: num('rpm', 1000), fz: num('fz', 60), fxy: num('fxy', 130), retract: num('retract', 3),
    dialect: $('dialect').value, dec: +$('dec').value, tol: Math.max(0.002, num('tol', 0.05)), prog: num('prog', 1), arcs: $('arcs').checked,
  };
}

/* ---------- elementos ---------- */
function rebuildDesign() {
  const r = buildDesign(state.raw, params(), state.design);
  state.design = r.elements; state.designNote = r.note; state.designScale = r.scale; state.designSize = r.size; state.cache.clear();
  svgQualityLabel(); syncSize();
}
function rebuildSketch() {
  state.sketchEls = sketchElements(sketch.entities, sketch.modes);
}
function assemble() {
  state.elements = state.design.concat(state.sketchEls, state.texts.map(textElement).filter(Boolean));
  if (state.selected >= state.elements.length) state.selected = -1;
}
const keyOf = e => (e.src === 'text' ? `t${e.text.id}:${e.text.x}:${e.text.y}:${e.text.rev}`
  : e.src === 'sketch' ? `s${e.sketchId}:${e.sig}` : `d${state.rawId}:${state.design.indexOf(e)}`);

function select(i) {
  state.selected = i;
  const e = state.elements[i];
  const isText = !!(e && e.src === 'text');
  $('txtTitle').textContent = isText ? 'Editar texto' : 'Agregar texto';
  $('tAdd').hidden = isText; $('tDel').hidden = !isText; $('tNew').hidden = !isText;
  $('txtPanel').hidden = !(isText || state.textOpen);
  // una figura del croquis muestra sus medidas para editarlas
  // (si ya está elegido un hueco de esa figura, se queda el hueco)
  if (e && e.src === 'sketch') { if (!sketch.selected || !hasEntity(e, sketch.selected.id)) sketch.select(e.sketchId); } else if (sketch.selected) sketch.select(null);
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
    toolWidth: state.plan ? state.plan.tl.w : toolGeometry(p).w, plan: state.plan, showPath: $('showPath').checked, dragging, simulating: sim.on,
  });
  if (sim.on) { simResize(); simPaint(sim.t); }
  drawOverlay();
}
function renderAll() {
  drawOnly();
  $('elCount').textContent = state.elements.length ? String(state.elements.length) : '';
  $('empty').hidden = !state.ready || state.elements.length > 0 || sketch.tool !== 'select';
  renderList($('els'), $('allModes'), {
    elements: state.elements, selected: state.selected,
    onSelect: i => { select(i); renderAll(); },
    onMode: (i, m) => { const e = state.elements[i]; e.mode = m; if (e.src === 'text') e.text.mode = m; if (e.src === 'sketch') { sketch.setMode(e.sketchId, m); storeSketch(); } select(i); refresh(); },
    onModeAll: m => { state.elements.forEach(e => { if (e.type === 'region') { e.mode = m; if (e.src === 'text') e.text.mode = m; if (e.src === 'sketch') sketch.setMode(e.sketchId, m); } }); storeSketch(); refresh(); },
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
  if (out.length) ws.push(`${out.join(', ')} se sale${out.length > 1 ? 'n' : ''} de la pieza; ajusta su tamaño o su posición.`);
  if (thin.length > 3) {
    const tot = thin.reduce((a, { e }) => a + (parseFloat(e.warn) || 0), 0);
    ws.push(`${thin.length} figuras tienen detalles más finos que la línea de ${plan.tl.w.toFixed(2)} mm${tot ? ` (${tot.toFixed(1)} mm² en total)` : ''}; están marcadas con “No cabe todo”. Prueba una herramienta más fina, menos profundidad, una pieza más grande o el modo Contorno.`);
  } else {
    thin.forEach(({ e, i }) => ws.push(`${nm(e, i)}: ${e.warn}.`));
  }
  return ws;
}

async function refresh() {
  if (sim.on) simEnd();
  sim.tl = null;
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
    state.gcode = ''; state.explained = []; state.codeSel = 0; state.lastG = null;
    $('code').innerHTML = '<div class="more">Dibuja en la pieza, carga un SVG o una imagen, o agrega un texto, para generar el código.</div>';
    $('explain').hidden = true;
    $('stats').textContent = ''; $('warns').textContent = '';
  } else {
    busy('Escribiendo el código…');
    await tick();
    if (my !== state.gen) return;
    const g = generateGcode(plan, state.elements, p);
    state.gcode = g.text; state.lastG = g;
    state.explained = explainProgram(g.text);
    $('simTime').textContent = `0:00 / ${clock(simTimeline().total)}`;
    if (state.codeSel > state.explained.length) state.codeSel = 0;
    showCode();
    $('stats').textContent = '';
    [['Tiempo aprox.', `${Math.max(1, Math.round(g.mins))} min`], ['Corte', `${g.cutLen.toFixed(0)} mm`], ['Líneas', g.lines], ['Pasadas', g.passes]]
      .forEach(([a, b]) => { const s = document.createElement('span'); s.append(a + ' '); const bb = document.createElement('b'); bb.textContent = b; s.append(bb); $('stats').append(s); });
    const ws = warnings(p, plan);
    $('warns').textContent = '';
    if (ws.length) {
      // aviso: ícono, título y un punto por problema
      const d = document.createElement('div'); d.className = 'warnbox'; d.setAttribute('role', 'status');
      d.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-warn"/></svg><div><b>Revisa antes de cortar</b><ul></ul></div>';
      ws.forEach(w => { const li = document.createElement('li'); li.textContent = w; d.querySelector('ul').append(li); });
      $('warns').append(d);
    }
  }
  busy(null);
  simButtons();
  jobSummary();
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
    $('svgOpts').hidden = isImage;
    await refresh();
    $('toast').textContent = `Procesado en ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
  } catch (err) {
    busy(null);
    $('loadErr').textContent = err.message || String(err);
  }
}
function loadSvg() {
  if (!state.lastSvg) return;
  const txt = state.lastSvg;
  loadShapes(() => parseSVG(txt, $('svghost'), SVG_QUALITY[+$('svgQ').value - 1][0]), false);
}
/**
 * "Normal · ±0.013 mm · 8 412 puntos": cuánto se aparta la curva en la pieza y cuántos puntos salieron.
 * Mientras se arrastra el control (`moving`) los puntos todavía son los del nivel anterior: no se muestran.
 */
function svgQualityLabel(moving = false) {
  const [tol, name] = SVG_QUALITY[+$('svgQ').value - 1];
  let txt = name;
  if (state.raw && !state.lastImage) {
    if (state.designScale) txt += ` · ±${(tol * state.designScale).toFixed(3)} mm`;
    const n = moving ? 0 : state.raw.reduce((a, s) => a + (s.kind === 'fill' ? s.rings : s.lines.map(l => l.pts)).reduce((b, r) => b + r.length, 0), 0);
    if (n) txt += ` · ${n.toLocaleString('es-MX')} puntos`;
  }
  $('svgQVal').textContent = txt;
}
function loadImage() {
  if (!state.lastImage) return;
  if ($('fit').value === 'native') $('fit').value = 'fill'; // una imagen no tiene unidades físicas
  const opts = {
    mode: $('imgMode').value, thr: +$('thr').value, invert: $('imgInvert').checked, clean: +$('imgClean').value,
    how: $('imgHow').value, detail: +$('imgDetail').value, crop: state.imgCrop,
  };
  loadShapes(() => {
    const r = traceImage(state.lastImage, opts);
    state.imgMask = r.mask; state.imgInfo = r.info;
    return r;
  }, true).then(drawImgView);
}

/* ---------- archivos ---------- */
function openFile(f) {
  const isSvg = /svg/i.test(f.type) || /\.svg$/i.test(f.name);
  if (!isSvg && !/^image\//.test(f.type)) { $('loadErr').textContent = 'Ese archivo no es un SVG ni una imagen (PNG, JPG o WEBP).'; return; }
  state.fileName = f.name.replace(/\.[^.]+$/, ''); $('docName').value = state.fileName;
  // el ejemplo se ve a 1:1 porque está dibujado en mm; un archivo propio empieza ajustado a la pieza
  if (state.demoFit && $('fit').value === 'native') $('fit').value = 'fill';
  state.demoFit = false;
  const rd = new FileReader();
  if (isSvg) {
    rd.onload = () => { state.lastImage = null; state.lastSvg = String(rd.result); loadSvg(); };
    rd.readAsText(f);
  } else {
    rd.onload = () => {
      const im = new Image();
      im.onload = () => { state.lastImage = im; state.imgCrop = null; state.imgMask = null; loadImage(); };
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
$('demo').addEventListener('click', () => { state.lastImage = null; state.lastSvg = DEMO_SVG; state.fileName = 'Ejemplo'; $('docName').value = 'Ejemplo'; $('fit').value = 'native'; state.demoFit = true; loadSvg(); });
$('clear').addEventListener('click', () => {
  Object.assign(state, { raw: null, design: [], texts: [], lastImage: null, lastSvg: '', designNote: '', fileName: '', designSize: [0, 0] });
  $('docName').value = '';
  syncSize();
  sketch.clear(); // se puede deshacer con Ctrl+Z
  $('imgOpts').hidden = true; $('svgOpts').hidden = true; assemble(); select(-1); refresh();
});
$('thr').addEventListener('input', () => { $('thrVal').textContent = $('thr').value; });
$('thr').addEventListener('change', loadImage);
['imgMode', 'imgClean', 'imgDetail', 'imgInvert'].forEach(id => $(id).addEventListener('change', () => { $('thrLbl').hidden = $('imgMode').value !== 'manual'; loadImage(); }));

/* ---------- imagen: lo que detecta y recorte ---------- */
const iv = $('imgView'), ivx = iv.getContext('2d');
let ivDrag = null;
/** Dónde queda la imagen dentro del lienzo de vista (px CSS). */
function ivLayout() {
  const im = state.lastImage, W = iv.clientWidth || 320;
  const H = Math.round(Math.min(W * 0.75, W * im.naturalHeight / im.naturalWidth));
  const k = Math.min(W / im.naturalWidth, H / im.naturalHeight);
  return { W, H, k, ox: (W - im.naturalWidth * k) / 2, oy: (H - im.naturalHeight * k) / 2, iw: im.naturalWidth, ih: im.naturalHeight };
}
/** Muestra la imagen original o lo que la app toma como dibujo, con el recorte marcado. */
function drawImgView() {
  const im = state.lastImage;
  if (!im || $('imgOpts').hidden) return;
  const L = ivLayout(), dpr = window.devicePixelRatio || 1, css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  iv.width = Math.round(L.W * dpr); iv.height = Math.round(L.H * dpr); iv.style.height = L.H + 'px';
  ivx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ivx.clearRect(0, 0, L.W, L.H);
  const c = state.imgCrop || { x: 0, y: 0, w: 1, h: 1 };
  const rx = L.ox + c.x * L.iw * L.k, ry = L.oy + c.y * L.ih * L.k, rw = c.w * L.iw * L.k, rh = c.h * L.ih * L.k;
  if (state.imgView === 'orig' || !state.imgMask) {
    ivx.drawImage(im, L.ox, L.oy, L.iw * L.k, L.ih * L.k);
  } else {
    // lo detectado en tinta sobre papel, dentro del recorte; fuera del recorte la imagen apagada
    ivx.globalAlpha = 0.25; ivx.drawImage(im, L.ox, L.oy, L.iw * L.k, L.ih * L.k); ivx.globalAlpha = 1;
    const m = state.imgMask, off = document.createElement('canvas');
    off.width = m.w; off.height = m.h;
    const od = off.getContext('2d').createImageData(m.w, m.h), ink = css('--ink'), paper = css('--panel');
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [ir, ig, ib] = rgb(ink), [pr, pg, pb] = rgb(paper);
    for (let i = 0; i < m.w * m.h; i++) { const on = m.data[i]; od.data[4 * i] = on ? ir : pr; od.data[4 * i + 1] = on ? ig : pg; od.data[4 * i + 2] = on ? ib : pb; od.data[4 * i + 3] = 255; }
    off.getContext('2d').putImageData(od, 0, 0);
    ivx.imageSmoothingEnabled = false;
    ivx.drawImage(off, rx, ry, rw, rh);
    ivx.imageSmoothingEnabled = true;
  }
  ivx.strokeStyle = css('--accent'); ivx.lineWidth = 2; ivx.setLineDash(state.imgCrop ? [] : [6, 4]);
  if (state.imgCrop) ivx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
  ivx.setLineDash([]);
  if (ivDrag && ivDrag.cur) {
    const [a, b] = [ivDrag.start, ivDrag.cur];
    ivx.strokeStyle = css('--accent'); ivx.setLineDash([6, 4]);
    ivx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    ivx.setLineDash([]);
  }
  const info = state.imgInfo;
  const auto = $('imgMode').value === 'auto';
  $('imgInfo').textContent = info ? `Dibujo: ${(info.ink * 100).toFixed(1)} % de la imagen${auto && info.used === 'photo' ? ' · parece foto: se ignoran sombras' : ''}${info.inverted ? ' · invertida' : ''}${state.imgMask ? ` · ${state.imgMask.w} × ${state.imgMask.h} px` : ''}` : '';
  $('imgUncrop').hidden = !state.imgCrop;
}
const ivPos = ev => { const r = iv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
iv.addEventListener('pointerdown', ev => { if (!state.lastImage) return; ivDrag = { start: ivPos(ev), cur: null }; iv.setPointerCapture(ev.pointerId); });
iv.addEventListener('pointermove', ev => { if (ivDrag) { ivDrag.cur = ivPos(ev); drawImgView(); } });
iv.addEventListener('pointerup', () => {
  const d = ivDrag; ivDrag = null;
  if (!d || !d.cur) return;
  const L = ivLayout();
  const toImg = ([px, py]) => [Math.min(1, Math.max(0, (px - L.ox) / (L.iw * L.k))), Math.min(1, Math.max(0, (py - L.oy) / (L.ih * L.k)))];
  const [x0, y0] = toImg(d.start), [x1, y1] = toImg(d.cur);
  const crop = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  if (crop.w * L.iw < 8 || crop.h * L.ih < 8) { drawImgView(); return; } // un clic, no un recorte
  state.imgCrop = crop; loadImage();
});
$('imgUncrop').addEventListener('click', () => { state.imgCrop = null; loadImage(); });
$('ivMask').addEventListener('click', () => { state.imgView = 'mask'; $('ivMask').setAttribute('aria-pressed', 'true'); $('ivOrig').setAttribute('aria-pressed', 'false'); drawImgView(); });
$('ivOrig').addEventListener('click', () => { state.imgView = 'orig'; $('ivOrig').setAttribute('aria-pressed', 'true'); $('ivMask').setAttribute('aria-pressed', 'false'); drawImgView(); });
$('svgQ').addEventListener('input', () => svgQualityLabel(true));
$('svgQ').addEventListener('change', loadSvg);
$('imgHow').addEventListener('change', loadImage);

/* ---------- parámetros ---------- */
/* ---------- tamaño del dibujo ---------- */
const r1 = v => Math.round(v * 10) / 10;
/** Muestra ancho/alto o margen según el modo, y el tamaño real del dibujo. */
function syncSize() {
  const fit = $('fit').value, [w, h] = state.designSize;
  $('dwLbl').hidden = $('dhLbl').hidden = fit !== 'width';
  $('marginLbl').hidden = fit !== 'fill';
  if (fit === 'width' && w) $('dh').value = r1(h);
  const big = w > num('pw', 90) + 0.01 || h > num('ph', 50) + 0.01;
  $('sizeInfo').textContent = w ? `El dibujo mide ${r1(w)} × ${r1(h)} mm${big ? '. No cabe en la pieza: redúcelo o agranda la pieza' : ''}.` : '';
  $('sizeInfo').classList.toggle('err', big);
}
$('fit').addEventListener('change', () => {
  state.demoFit = false;
  // al pasar a medida libre se parte del tamaño que ya tenía, para que nada brinque
  if ($('fit').value === 'width' && state.designSize[0]) $('dw').value = r1(state.designSize[0]);
});
$('dh').addEventListener('change', () => {
  const [w, h] = state.designSize, v = num('dh', 0);
  if (w && h && v > 0) $('dw').value = r1(v * w / h);
  storeParams(); rebuildDesign(); assemble(); refresh();
});
['pw', 'ph', 'margin', 'speck', 'fit', 'dw'].forEach(id => $(id).addEventListener('change', () => { rebuildDesign(); assemble(); refresh(); }));
['depth', 'ttype', 'tdia', 'vang', 'vtip', 'tnum', 'rpm', 'fz', 'fxy', 'retract', 'stepdown', 'stepover', 'dialect', 'dec', 'tol', 'prog', 'arcs']
  .forEach(id => $(id).addEventListener('change', () => { $('vAngLbl').hidden = $('vTipLbl').hidden = $('ttype').value !== 'v'; refresh(); }));
$('showPath').addEventListener('change', () => drawOnly());

// los parámetros se recuerdan entre sesiones (cada taller tiene su máquina y su herramienta)
const SAVED = ['pw', 'ph', 'margin', 'speck', 'ttype', 'tdia', 'vang', 'vtip', 'tnum', 'depth', 'rpm', 'retract', 'fz', 'fxy',
  'stepdown', 'stepover', 'dialect', 'dec', 'tol', 'prog', 'arcs', 'imgHow', 'thr', 'svgQ', 'dw', 'imgMode', 'imgClean', 'imgDetail', 'imgInvert'];
const STORE = 'marcnc:parametros';
const getVal = id => ($(id).type === 'checkbox' ? $(id).checked : $(id).value);
const setVal = (id, v) => { if ($(id).type === 'checkbox') $(id).checked = !!v; else $(id).value = v; };
const DEFAULTS = Object.fromEntries(SAVED.map(id => [id, getVal(id)]));
const syncLabels = () => { $('vAngLbl').hidden = $('vTipLbl').hidden = $('ttype').value !== 'v'; $('thrVal').textContent = $('thr').value; $('thrLbl').hidden = $('imgMode').value !== 'manual'; svgQualityLabel(); };
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
  if (state.lastSvg) { loadSvg(); return; }
  rebuildDesign(); assemble(); refresh();
  $('toast').textContent = 'Parámetros de la tarea de referencia restablecidos.';
});

/* ---------- tema ---------- */
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('marcnc:tema', root.dataset.theme); } catch { /* solo esta sesión */ }
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
$('tNew').addEventListener('click', () => { state.textOpen = true; select(-1); renderAll(); $('tText').focus(); });

/* ---------- croquis ---------- */
const sketch = createSketchEditor({
  onChange: () => { rebuildSketch(); storeSketch(); assemble(); syncSketchSelection(); refresh(); },
  onRedraw: () => { drawOverlay(); renderSketchProps2(); },
  onDimCreated: id => { state.pendingDim = id; drawOverlay(); },
  onStatus: ({ prompt, cursor, kind }) => {
    if (!$('skPrompt').classList.contains('err')) $('skPrompt').textContent = prompt;
    $('skCursor').textContent = cursor ? `X ${cursor[0].toFixed(2)}  Y ${cursor[1].toFixed(2)}${kind && kind !== 'cuadrícula' ? `  · ${kind}` : ''}` : '';
  },
  css: v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(),
});
const SKETCH_STORE = 'marcnc:croquis';
function storeSketch() { try { localStorage.setItem(SKETCH_STORE, JSON.stringify(sketch.save())); } catch { /* solo esta sesión */ } }
function loadSketch() { try { sketch.load(JSON.parse(localStorage.getItem(SKETCH_STORE) || 'null')); } catch { /* croquis vacío */ } rebuildSketch(); }

/** Capa del croquis: mismo tamaño que la vista previa, se redibuja sola (rápido) al mover el cursor. */
const ov = $('ov'), octx = ov.getContext('2d');
function drawOverlay() {
  const cv = $('cv'), dpr = window.devicePixelRatio || 1, v = preview.getView();
  const w = cv.clientWidth, h = cv.clientHeight;
  if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) { ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); }
  ov.style.width = w + 'px'; ov.style.height = h + 'px';
  // misma escala que el lienzo de abajo si cambió de ancho y aún no se redibuja
  const sc = v.cssW ? w / v.cssW : 1;
  octx.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
  octx.clearRect(0, 0, w / sc, h / sc);
  const X = x => v.ox + x * v.k, Y = y => v.oy + (v.H - y) * v.k;
  sketch.draw(octx, X, Y, v.k, v.W, v.H);
  drawCodeHighlight(X, Y, v.k);
  state.dims = currentDims();
  state.dimHits = state.dims ? drawDims(octx, state.dims.list, X, Y, css, state.dims.editable) : [];
  if (state.pendingDim) {
    // la cota recién creada con la herramienta Cota pide su valor de inmediato
    const id = state.pendingDim; state.pendingDim = null;
    const hit = state.dimHits.find(h => state.dims.list[h.i].persistent && state.dims.list[h.i].id === id);
    if (hit) setTimeout(() => openDimEdit(hit), 0);
  }
}

/* ---------- cotas de lo seleccionado ---------- */
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
/** Cotas de la figura elegida: al borde más cercano y su tamaño. Las del croquis y los textos se editan tocándolas. */
function currentDims() {
  if (sim.on) return null;
  const p = params();
  // cotas guardadas del croquis: siempre a la vista, como en un CAD
  const saved = sketch.dimsView();
  if (sketch.tool !== 'select') return saved.length ? { list: saved, editable: true, target: { kind: 'sketch' } } : null;
  const e = sketch.shown;
  if (e) {
    // sugeridas: las de la figura elegida que todavía no están guardadas (se guardan al escribirles un valor)
    const has = d => saved.some(q => q.ent === e.id && (d.kind === 'size' ? q.kind === 'size' && q.axis === d.axis : q.kind !== 'size' && q.axis === d.axis));
    const hints = dimensions(e, p.W, p.H).filter(d => !has(d)).map(d => ({ ...d, ent: e.id, hint: true }));
    return { list: saved.concat(hints), editable: true, target: { kind: 'sketch', id: e.id } };
  }
  if (saved.length && state.selected < 0) return { list: saved, editable: true, target: { kind: 'sketch' } };
  const el = state.elements[state.selected];
  const bb = el && bbox(el);
  if (!bb) return null;
  const box = { id: -1, type: 'rect', x: bb[0], y: bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1] };
  const list = dimensions(box, p.W, p.H);
  return el.src === 'text'
    ? { list: list.filter(d => d.kind === 'edge'), editable: true, target: { kind: 'text', t: el.text, box } }
    : { list, editable: false, target: { kind: 'design' } };
}
/** Campo flotante sobre la etiqueta de la cota para escribir el valor nuevo. */
function openDimEdit(hit) {
  const info = state.dims, d = info.list[hit.i];
  if (!info.editable) { $('toast').textContent = 'Las figuras del archivo se acomodan con Tamaño del dibujo. Para moverla libre, cópiala (Ctrl+C) y pégala (Ctrl+V) como croquis.'; return; }
  let inp = $('dimEdit');
  if (!inp) { inp = document.createElement('input'); inp.id = 'dimEdit'; inp.type = 'text'; inp.inputMode = 'decimal'; inp.className = 'dim-edit'; inp.setAttribute('aria-label', 'Valor de la cota en mm'); $('stage').append(inp); }
  const cv = $('cv');
  inp.style.left = `${cv.offsetLeft + hit.x + hit.w / 2 - 48}px`; inp.style.top = `${cv.offsetTop + hit.y - 12}px`;
  inp.value = String(+d.value.toFixed(3)); inp.hidden = false; inp.focus(); inp.select();
  inp.title = d.persistent ? 'Enter aplica · vacío y Enter quita la cota · Esc cancela' : 'Enter guarda esta cota';
  const close = () => { inp.hidden = true; inp.onkeydown = inp.onblur = null; };
  inp.onkeydown = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (d.persistent && !inp.value.trim()) { close(); sketch.removeDim(d.id); $('toast').textContent = 'Cota quitada: esa medida vuelve a quedar libre.'; return; }
    const v = parseFloat(inp.value.replace(',', '.'));
    if (!(v >= 0) || (d.kind === 'size' && !(v > 0))) { $('toast').textContent = 'Escribe un número mayor que cero (en mm).'; return; }
    close();
    applyDimValue(info.target, d, v);
  };
  inp.onblur = close;
}
function applyDimValue(target, d, v) {
  const p = params();
  if (d.persistent) { sketch.setDimValue(d.id, v); return; }
  if (target.kind === 'sketch' && d.hint) {
    // una cota sugerida se vuelve cota guardada: desde ahora manda sobre la figura
    sketch.addDim({ kind: d.kind, ent: d.ent, axis: d.axis, side: d.side, value: v });
  } else if (target.kind === 'sketch') {
    const e = sketch.selected;
    if (e) sketch.replace(e.id, applyDimension(e, d, v, p.W, p.H));
  } else if (target.kind === 'text') {
    const nb = applyDimension(target.box, d, v, p.W, p.H), t = target.t;
    t.x = +(t.x + nb.x - target.box.x).toFixed(3); t.y = +(t.y + nb.y - target.box.y).toFixed(3); t.rev++;
    $('tX').value = t.x; $('tY').value = t.y;
    assemble(); select(state.elements.findIndex(x => x.text === t)); refresh();
  }
}
let propsFor = null;
/** Tarjeta de medidas de la figura seleccionada (solo se reconstruye si cambió, para no perder el foco). */
function renderSketchProps2() {
  const list = sketch.selection, e = sketch.selected;
  $('skProps').hidden = !list.length;
  $('skOps').hidden = !list.length;
  if (!list.length) { propsFor = null; return; }
  // estado de definición: qué cotas le faltan (como el azul/negro de un croquis de CAD)
  const def = sketch.defined();
  const st = list.map(x => def.get(x.id)).filter(Boolean);
  const full = st.every(s => s.full), cons = list.every(x => x.construction);
  $('skState').textContent = cons ? 'Construcción: sirve de referencia y no se graba.'
    : full ? 'Completamente definida: todas sus medidas y su posición están acotadas.'
      : list.length === 1 ? `Le falta: ${st[0].missing.join(', ')}. Toca una cota sugerida para fijarla.` : 'Algunas figuras todavía tienen medidas libres.';
  $('skState').className = `def-state ${cons ? 'cons' : full ? 'full' : 'under'}`;
  $('skCons').checked = cons;
  const sig = JSON.stringify(list) + JSON.stringify(sketch.dims);
  if (sig === propsFor) return;
  propsFor = sig;
  if (e) $('skTitle').textContent = renderSketchProps($('skFields'), e, patch => sketch.update(e.id, patch));
  else { $('skTitle').textContent = `${list.length} figuras`; $('skFields').textContent = ''; }
  // centro sugerido para el patrón circular y la simetría: el de la selección
  const b = sketch.selectionBox();
  if (b && document.activeElement?.closest?.('#skOps') == null) {
    $('pcCx').value = +((b[0] + b[2]) / 2).toFixed(2); $('pcCy').value = +((b[1] + b[3]) / 2).toFixed(2);
    $('mirC').value = $('mirAxis').value === 'x' ? +b[2].toFixed(2) : +b[3].toFixed(2);
  }
}
/** ¿El elemento viene de esa figura del croquis (como exterior o como hueco)? */
const hasEntity = (x, id) => x.src === 'sketch' && (x.sketchId === id || new RegExp(`"id":${id}[,}]`).test(x.sig));
/** Selecciona en la lista el elemento que contiene la figura elegida en el croquis. */
function syncSketchSelection() {
  const e = sketch.selected;
  if (!e) return;
  const i = state.elements.findIndex(x => hasEntity(x, e.id));
  state.selected = i;
}
function setTool(t) {
  sketch.setTool(t);
  document.querySelectorAll('#skTools button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  $('skSidesLbl').hidden = t !== 'poly';
  $('sketchbar').hidden = t === 'select';
  $('sketchbar').classList.toggle('dimmode', t === 'dim');
  $('skPrompt').classList.remove('err');
  if (t !== 'select') { state.selected = -1; renderAll(); } else $('empty').hidden = !state.ready || state.elements.length > 0;
}
document.querySelectorAll('#skTools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('skGrid').addEventListener('change', () => sketch.setOptions({ grid: +$('skGrid').value }));
$('skSnap').addEventListener('change', () => sketch.setOptions({ snap: $('skSnap').checked }));
$('skSides').addEventListener('change', () => sketch.setOptions({ sides: Math.min(64, Math.max(3, Math.round(num('skSides', 6)))) }));
$('skUndo').addEventListener('click', () => sketch.undoOne());
$('skRedo').addEventListener('click', () => sketch.redoOne());
$('skDel').addEventListener('click', () => { const l = sketch.selection; if (l.length) sketch.removeMany(l.map(x => x.id)); });
$('skCons').addEventListener('change', () => sketch.setConstruction($('skCons').checked));
const opNum = (id, def) => { const v = parseFloat(String($(id).value).replace(',', '.')); return Number.isFinite(v) ? v : def; };
const opDone = n => { $('toast').textContent = n ? `Se agregaron ${n} figura${n > 1 ? 's' : ''}.` : 'Elige primero las figuras a repetir.'; };
$('plGo').addEventListener('click', () => opDone(sketch.linear(Math.max(1, Math.round(opNum('plN', 3))), opNum('plDx', 10), opNum('plDy', 0))));
$('pcGo').addEventListener('click', () => opDone(sketch.circular(Math.max(2, Math.round(opNum('pcN', 6))), opNum('pcCx', 45), opNum('pcCy', 25), opNum('pcA', 360))));
$('mirGo').addEventListener('click', () => opDone(sketch.mirror($('mirAxis').value, opNum('mirC', 45))));
$('mirAxis').addEventListener('change', () => { const b = sketch.selectionBox(); if (b) $('mirC').value = $('mirAxis').value === 'x' ? +b[2].toFixed(2) : +b[3].toFixed(2); });
$('skDup').addEventListener('click', () => { if (copySelection(true)) paste(true); });
$('skInput').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    const err = sketch.submit($('skInput').value);
    $('skPrompt').classList.toggle('err', !!err);
    if (err) $('skPrompt').textContent = err; else { $('skInput').value = ''; sketch.refreshStatus(); }
  } else if (ev.key === 'Escape') { ev.preventDefault(); sketch.key('Escape'); $('skInput').blur(); }
});
$('skInput').addEventListener('input', () => { if ($('skPrompt').classList.contains('err')) { $('skPrompt').classList.remove('err'); sketch.refreshStatus(); } });
// atajos: herramientas con una letra, Esc/Enter/Supr y deshacer, salvo mientras se escribe en un campo
const TOOL_KEYS = { v: 'select', l: 'line', r: 'rect', c: 'circle', a: 'arc', p: 'poly', s: 'slot', d: 'dim' };
document.addEventListener('keydown', ev => {
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return; // con un diálogo abierto, las teclas son del diálogo
  const k = ev.key.toLowerCase();
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
    if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); sketch.undoOne(); } else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); sketch.redoOne(); }
    else if (k === 'c' && !getSelection().toString()) { if (copySelection()) { ev.preventDefault(); $('toast').textContent = 'Copiado. Ctrl+V para pegar.'; } }
    else if (k === 'x') { if (copySelection()) { ev.preventDefault(); deleteSelection(); $('toast').textContent = 'Cortado. Ctrl+V para pegar.'; } }
    else if (k === 'v') { if (state.clip) { ev.preventDefault(); paste(); } }
    else if (k === 'a' && sketch.entities.length) { ev.preventDefault(); setTool('select'); sketch.selectMany(sketch.entities.map(x => x.id)); state.selected = -1; renderAll(); }
    else if (k === 'd') { ev.preventDefault(); if (copySelection(true)) paste(true); }
    return;
  }
  if (ev.altKey) return;
  // flechas: mueven lo elegido un paso de cuadrícula (Shift: 10 pasos)
  const arrow = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] }[k];
  if (arrow && sketch.tool === 'select' && (sketch.selection.length || state.elements[state.selected]?.src === 'text')) {
    ev.preventDefault();
    const step = (ev.shiftKey ? 10 : 1) * (sketch.selection.length ? sketch.grid : 0.5);
    if (sketch.selection.length) sketch.nudge(arrow[0] * step, arrow[1] * step);
    else { const t = state.elements[state.selected].text; t.x += arrow[0] * step; t.y += arrow[1] * step; t.rev++; $('tX').value = t.x; $('tY').value = t.y; assemble(); select(state.elements.findIndex(x => x.text === t)); refresh(); }
    return;
  }
  if ((k === 'delete' || k === 'backspace') && sketch.tool === 'select' && !sketch.selected && state.selected >= 0) { ev.preventDefault(); deleteSelection(); return; }
  if (TOOL_KEYS[k] && !ev.shiftKey) { setTool(TOOL_KEYS[k]); return; }
  if (k === 't' && !ev.shiftKey) { ev.preventDefault(); openText(); return; }
  if (sketch.key(ev.key)) { ev.preventDefault(); if (sketch.tool === 'select') setTool('select'); }
});

/* ---------- copiar, cortar, pegar, eliminar ---------- */
/**
 * Guarda lo elegido en el portapapeles interno. Una figura de un SVG o una imagen se copia como croquis
 * (sus contornos como líneas cerradas), así al pegarla se puede mover y acotar libremente.
 * @param {boolean} [keep] no reemplaza el portapapeles (duplicar)
 */
function copySelection(keep = false) {
  let clip = null;
  const el = state.elements[state.selected];
  const e = sketch.selected || (el && el.src === 'sketch' ? sketch.entities.find(x => x.id === el.sketchId) : null);
  if (sketch.selection.length > 1) clip = { entities: JSON.parse(JSON.stringify(sketch.selection)), texts: [] };
  else if (e) clip = { entities: [JSON.parse(JSON.stringify(e))], texts: [] };
  else if (el && el.src === 'text') clip = { entities: [], texts: [{ ...el.text, local: null }] };
  else if (el) {
    const entities = el.type === 'region'
      ? el.parts.flatMap(p => [p.outer, ...p.holes].map(q => ({ type: 'line', pts: fromC(q), closed: true })))
      : el.parts.map(p => ({ type: 'line', pts: p.pts.map(q => q.slice()), closed: p.closed }));
    clip = { entities, texts: [] };
  }
  if (!clip) return false;
  clip.n = 0;
  if (keep) state.dup = clip; else state.clip = clip;
  return true;
}
/** Pega desplazado 5 mm (cada pegada se aleja un poco más, para no encimarse). */
async function paste(fromDup = false) {
  const clip = fromDup ? state.dup : state.clip;
  if (!clip) return;
  const off = 5 * ++clip.n, p = params();
  // la primera dirección (abajo-derecha, arriba-derecha, …) en la que lo pegado queda dentro de la pieza
  const boxes = clip.entities.map(entityBox).concat(clip.texts.map(t => [t.x - 1, t.y - 1, t.x + 1, t.y + 1]));
  const fits = (dx, dy) => boxes.every(b => b[0] + dx >= 0 && b[2] + dx <= p.W && b[1] + dy >= 0 && b[3] + dy <= p.H);
  const [dx, dy] = [[off, -off], [off, off], [-off, off], [-off, -off]].find(([a, b]) => fits(a, b)) || [off, -off];
  if (clip.entities.length) {
    if (sketch.tool !== 'select') setTool('select');
    sketch.addMany(clip.entities.map(e => translate(e, dx, dy)));
    syncSketchSelection(); select(state.selected); renderAll();
  }
  for (const src of clip.texts) {
    const t = { ...src, id: ++state.textSeq, x: src.x + dx, y: src.y + dy, rev: 0 };
    await addText(t);
    refresh();
  }
  $('toast').textContent = fromDup ? 'Duplicado.' : 'Pegado.';
}
/** Supr: borra la figura del croquis o el texto; una figura del archivo se omite (no se graba). */
function deleteSelection() {
  const el = state.elements[state.selected];
  if (sketch.selection.length > 1) { sketch.removeMany(sketch.selection.map(x => x.id)); return; }
  const e = sketch.selected || (el && el.src === 'sketch' ? sketch.entities.find(x => x.id === el.sketchId) : null);
  if (e) { sketch.remove(e.id); return; }
  if (!el) return;
  if (el.src === 'text') { state.texts = state.texts.filter(t => t !== el.text); assemble(); select(-1); refresh(); return; }
  el.mode = 'skip'; select(-1); refresh();
  $('toast').textContent = 'La figura del archivo quedó en Omitir: no se graba. Cambia su modo para recuperarla.';
}

/* ---------- vista previa: croquis, selección y arrastre de textos ---------- */
const cv = $('cv');
let drag = null;
const evMM = ev => { const r = cv.getBoundingClientRect(); return { mx: ev.clientX - r.left, my: ev.clientY - r.top }; };
/** Captura el puntero para seguir el arrastre fuera del lienzo (sin fallar si el navegador no lo permite). */
const capture = ev => { try { cv.setPointerCapture(ev.pointerId); } catch { /* puntero ya liberado */ } };
const pickTol = () => 8 / preview.getView().k; // 8 px en mm
cv.addEventListener('pointerdown', ev => {
  const { mx, my } = evMM(ev);
  const mm = preview.toMM(mx, my);
  const sx = (preview.getView().cssW || cv.clientWidth) / (cv.clientWidth || 1); // lienzo estirado mientras no se redibuja
  const dh = (sketch.tool === 'select' || sketch.tool === 'dim') && dimAt(state.dimHits, mx * sx, my * sx);
  if (dh) { ev.preventDefault(); openDimEdit(dh); return; }
  capture(ev); // también para el recuadro de selección
  if (sketch.down(mm, pickTol(), ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
    capture(ev);
    if (sketch.tool === 'select') { syncSketchSelection(); select(state.selected); renderAll(); }
    return;
  }
  const i = preview.hit(mx, my, state.elements, state.plan ? state.plan.tl.w : 1);
  select(i);
  if (i >= 0 && state.elements[i].src === 'text') {
    const [x, y] = mm;
    const t = state.elements[i].text;
    drag = { i, t, sx: x, sy: y, x0: t.x, y0: t.y, moved: false };
    capture(ev);
  }
  renderAll();
  if (i >= 0) document.querySelector(`.el[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
});
cv.addEventListener('pointermove', ev => {
  const { mx, my } = evMM(ev);
  const [x, y] = preview.toMM(mx, my);
  if (!drag) { sketch.move([x, y], pickTol()); return; }
  const nx = Math.round((drag.x0 + x - drag.sx) * 2) / 2, ny = Math.round((drag.y0 + y - drag.sy) * 2) / 2; // pasos de 0.5 mm
  if (nx === drag.t.x && ny === drag.t.y) return;
  drag.t.x = nx; drag.t.y = ny; drag.moved = true;
  const el = textElement(drag.t); el.paths = [];
  state.elements[drag.i] = el;
  $('tX').value = nx; $('tY').value = ny;
  drawOnly(true);
});
const endDrag = () => {
  // un recuadro de selección termina eligiendo figuras del croquis
  if (sketch.up()) { syncSketchSelection(); if (!sketch.selected) state.selected = -1; renderAll(); }
  if (!drag) return;
  const moved = drag.moved;
  drag.t.rev++; drag = null;
  if (moved) { assemble(); refresh(); }
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('pointerleave', () => { if (!drag) sketch.leave(); });
cv.addEventListener('dblclick', () => sketch.dblclick());
let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { drawOnly(); drawImgView(); }, 120); });
// también cuando cambia el ancho sin que la ventana cambie (panel que se abre, ventana oculta que vuelve)
let lastW = 0;
new ResizeObserver(([en]) => { const w = Math.round(en.contentRect.width); if (w !== lastW) { lastW = w; clearTimeout(rt); rt = setTimeout(() => drawOnly(), 60); } }).observe($('stage'));

/* ---------- programa explicado ---------- */
const CODE_LIMIT = 4000;
function showCode() {
  renderCode($('code'), state.explained, { limit: CODE_LIMIT, explainAll: $('explainAll').checked, selected: state.codeSel });
  showLine();
}
/** Tarjeta con la explicación de la línea elegida; su movimiento se resalta en la vista previa. */
function showLine() {
  const e = state.explained[state.codeSel - 1];
  $('explain').hidden = !e;
  if (e) {
    $('exKind').textContent = KIND_NAME[e.kind];
    $('exKind').classList.toggle('danger', e.kind === 'danger');
    $('exWhere').textContent = `Línea ${e.n}${e.block ? ` · ${e.block.startsWith('FIGURA') ? 'figura ' + e.block.slice(7) : e.block.replace('TEXTO', 'texto')}` : ''}`;
    $('exCode').textContent = e.code;
    $('exText').textContent = e.text;
  }
  drawOverlay();
}
function selectLine(n) {
  const max = Math.min(state.explained.length, CODE_LIMIT);
  if (!max) return;
  state.codeSel = Math.max(1, Math.min(max, n));
  markRow($('code'), state.codeSel);
  if (sim.on) { simPause(); sim.t = Math.max(0, timeOfLine(simTimeline(), state.codeSel) - 1e-6); simUpdate(); return; }
  showLine();
}
$('code').addEventListener('click', ev => { const r = ev.target.closest('.row'); if (r) { selectLine(+r.dataset.n); $('code').focus({ preventScroll: true }); } });
$('code').addEventListener('keydown', ev => {
  const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 15, PageUp: -15 }[ev.key];
  if (step) { ev.preventDefault(); selectLine((state.codeSel || 0) + step); }
  else if (ev.key === 'Home') { ev.preventDefault(); selectLine(1); }
  else if (ev.key === 'End') { ev.preventDefault(); selectLine(state.explained.length); }
});
$('exPrev').addEventListener('click', () => selectLine(state.codeSel - 1));
$('exNext').addEventListener('click', () => selectLine(state.codeSel + 1));
$('explainAll').addEventListener('change', showCode);

/** Movimiento de la línea elegida sobre la vista previa: trazo, posición de la herramienta y su altura. */
function drawCodeHighlight(X, Y, k) {
  const e = state.explained[state.codeSel - 1];
  if (!e || !e.to) return;
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const [x0, y0] = e.from;
  const [x1, y1, z1] = sim.on && state.simPos ? state.simPos : e.to; // en la simulación, donde va la herramienta
  const col = css(e.kind === 'danger' ? '--plate-warn' : '--plate-accent');
  octx.save();
  octx.strokeStyle = col; octx.lineWidth = 3; octx.lineCap = 'round';
  if (e.kind === 'rapid' || e.kind === 'retract' || e.kind === 'danger') octx.setLineDash([6, 5]);
  octx.beginPath();
  const [ex, ey] = e.to;
  if (e.arc) {
    // en pantalla Y crece hacia abajo: el sentido antihorario de la máquina es horario en el lienzo
    const [cx, cy] = e.arc.c;
    octx.arc(X(cx), Y(cy), e.arc.r * k, -Math.atan2(y0 - cy, x0 - cx), -Math.atan2(ey - cy, ex - cx), e.arc.ccw);
  } else { octx.moveTo(X(x0), Y(y0)); octx.lineTo(X(ex), Y(ey)); }
  octx.stroke(); octx.setLineDash([]);
  const tw = state.plan ? state.plan.tl.w : 1;
  const r = Math.max(6, (tw * k) / 2);
  octx.beginPath(); octx.arc(X(x1), Y(y1), r, 0, 2 * Math.PI);
  octx.fillStyle = col; octx.globalAlpha = z1 < 0 ? 0.6 : 0.15; octx.fill(); octx.globalAlpha = 1; octx.stroke();
  const txt = `Z${z1.toFixed(2)}${z1 < 0 ? ' cortando' : ' arriba'}`;
  octx.font = '500 12px "IBM Plex Mono", monospace';
  const w = octx.measureText(txt).width + 8, lx = Math.min(X(x1) + r + 6, octx.canvas.clientWidth - w - 2) || X(x1) + r + 6;
  octx.fillStyle = css('--panel'); octx.fillRect(lx, Y(y1) - 9, w, 18);
  octx.strokeStyle = css('--line-strong'); octx.lineWidth = 1; octx.strokeRect(lx + 0.5, Y(y1) - 8.5, w - 1, 17);
  octx.fillStyle = css('--ink'); octx.fillText(txt, lx + 4, Y(y1) + 4);
  octx.restore();
}

/* ---------- simulación del recorrido ---------- */
const sim = { on: false, playing: false, t: 0, drawnT: 0, tl: null, raf: 0, last: 0 };
const simCv = $('sim'), sctx = simCv.getContext('2d');
const simTimeline = () => sim.tl || (sim.tl = buildTimeline(state.explained));
/** La capa de simulación copia el tamaño de la vista previa; si cambia, se vuelve a pintar desde cero. */
function simResize() {
  const cv = $('cv'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  simCv.style.width = w + 'px'; simCv.style.height = h + 'px';
  if (simCv.width !== Math.round(w * dpr) || simCv.height !== Math.round(h * dpr)) {
    simCv.width = Math.round(w * dpr); simCv.height = Math.round(h * dpr); sim.drawnT = 0;
  }
  const v = preview.getView(), sc = v.cssW ? w / v.cssW : 1;
  sctx.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
}
/** Pinta el grabado hecho hasta t; solo agrega lo nuevo desde la última vez (si se regresa, empieza de cero). */
function simPaint(t) {
  const tl = simTimeline(), v = preview.getView();
  if (t < sim.drawnT || sim.drawnT === 0) { sctx.clearRect(0, 0, simCv.width, simCv.height); sim.drawnT = 0; }
  const X = x => v.ox + x * v.k, Y = y => v.oy + (v.H - y) * v.k;
  sctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--cut').trim();
  sctx.lineWidth = Math.max(1, (state.plan ? state.plan.tl.w : 1) * v.k); sctx.lineCap = 'round'; sctx.lineJoin = 'round';
  const i0 = Math.max(0, segAt(tl, sim.drawnT)), i1 = segAt(tl, t);
  for (let i = i0; i <= i1 && i < tl.segs.length; i++) {
    const s = tl.segs[i];
    if (!(s.to[2] < 0 && s.from[2] < 0) && !(s.kind === 'plunge' && s.to[2] < 0)) continue; // solo lo que corta
    const u0 = Math.max(0, (sim.drawnT - s.t0) / s.dur), u1 = Math.min(1, (t - s.t0) / s.dur);
    if (u1 < u0) continue;
    const steps = s.arc ? Math.max(1, Math.ceil(Math.abs(s.arc.sweep) * s.arc.r * v.k * (u1 - u0) / 3)) : 1;
    sctx.beginPath();
    for (let j = 0; j <= steps; j++) {
      const p = segPoint(s, u0 + (u1 - u0) * j / steps);
      if (j) sctx.lineTo(X(p[0]), Y(p[1])); else sctx.moveTo(X(p[0]), Y(p[1]));
    }
    if (steps === 1 && s.kind === 'plunge') sctx.lineTo(X(s.to[0]) + 0.01, Y(s.to[1])); // la bajada deja un punto
    sctx.stroke();
  }
  sim.drawnT = t;
}
function simUpdate() {
  const tl = simTimeline();
  simPaint(sim.t);
  const pos = positionAt(tl, sim.t);
  state.simPos = pos ? pos.p : null;
  if (pos && pos.seg.n !== state.codeSel) { state.codeSel = pos.seg.n; markRow($('code'), state.codeSel); }
  showLine();
  $('simSeek').value = String(tl.total ? Math.round((sim.t / tl.total) * 1000) : 0);
  $('simTime').textContent = `${clock(sim.t)} / ${clock(tl.total)}`;
}
function simFrame(now) {
  const tl = simTimeline();
  sim.t = Math.min(tl.total, sim.t + ((now - sim.last) / 1000) * +$('simSpeed').value);
  sim.last = now;
  simUpdate();
  if (sim.t >= tl.total) simPause(); else sim.raf = requestAnimationFrame(simFrame);
}
function simButtons() {
  document.querySelector('.playbar').hidden = !state.explained.length; // sin programa no hay nada que simular
  if (!state.explained.length) $('simTime').textContent = '0:00 / 0:00';
  $('simPlay').setAttribute('aria-pressed', String(sim.playing));
  $('simPlay').querySelector('use').setAttribute('href', sim.playing ? '#i-pause' : '#i-play');
  $('simPlay').querySelector('span').textContent = sim.playing ? 'Pausa' : sim.on ? 'Seguir' : 'Simular';
  $('simStop').hidden = !sim.on; $('simSeek').disabled = !state.explained.length;
}
function simBegin() {
  if (!state.explained.length || sim.on) return;
  sim.on = true; sim.drawnT = 0;
  drawOnly();
}
function simPlay() {
  simBegin();
  if (!sim.on) return;
  if (sim.t >= simTimeline().total) { sim.t = 0; sim.drawnT = 0; }
  sim.playing = true; sim.last = performance.now();
  cancelAnimationFrame(sim.raf); sim.raf = requestAnimationFrame(simFrame);
  simButtons();
}
function simPause() { sim.playing = false; cancelAnimationFrame(sim.raf); simButtons(); }
function simEnd() {
  simPause();
  sim.on = false; sim.t = 0; sim.drawnT = 0; state.simPos = null;
  sctx.clearRect(0, 0, simCv.width, simCv.height);
  $('simSeek').value = '0'; $('simTime').textContent = `0:00 / ${clock(state.explained.length ? simTimeline().total : 0)}`;
  simButtons(); drawOnly(); showLine();
}
$('simPlay').addEventListener('click', () => (sim.playing ? simPause() : simPlay()));
$('simStop').addEventListener('click', simEnd);
$('simSeek').addEventListener('input', () => {
  simBegin();
  if (!sim.on) return;
  simPause();
  sim.t = (+$('simSeek').value / 1000) * simTimeline().total;
  simUpdate();
});

/* ---------- hoja de entrega ---------- */
const SHEET_STORE = 'marcnc:entrega';
const SHEET_FIELDS = { name: 'shName', id: 'shId', group: 'shGroup', practice: 'shPractice', teacher: 'shTeacher', material: 'shMaterial' };
$('sheetBtn').addEventListener('click', () => {
  $('exportDlg').close();
  if (!state.gcode) { $('toast').textContent = 'Todavía no hay código para entregar.'; return; }
  let info = {};
  try { info = JSON.parse(localStorage.getItem(SHEET_STORE) || '{}'); } catch { /* vacío */ }
  Object.entries(SHEET_FIELDS).forEach(([k, id]) => { $(id).value = info[k] || ''; });
  $('sheetDlg').showModal();
});
$('shCancel').addEventListener('click', () => $('sheetDlg').close(''));
$('sheetForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  $('sheetDlg').close();
  if (!state.lastG) return;
  const info = Object.fromEntries(Object.entries(SHEET_FIELDS).map(([k, id]) => [k, $(id).value.trim()]));
  try { localStorage.setItem(SHEET_STORE, JSON.stringify(info)); } catch { /* solo esta vez */ }
  const p = params(), css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  busy('Preparando la hoja…'); await tick();
  const image = sheetImage({ elements: state.elements, W: p.W, H: p.H, toolWidth: state.plan.tl.w, css });
  $('sheet').innerHTML = sheetHTML({
    info, p, tl: state.plan.tl, g: state.lastG, ex: state.explained, elements: state.elements, image,
    fileName: `${safeName(state.fileName)}_GM.txt`, withProgram: $('shProgram').checked,
  });
  // la imagen ya está en memoria; el tope evita quedarse esperando si el navegador no la decodifica (ventana oculta)
  await new Promise(r => { const im = $('sheet').querySelector('img'); if (!im || im.complete) r(); else { im.onload = r; im.onerror = r; setTimeout(r, 1500); } });
  busy(null);
  window.print();
});
window.addEventListener('afterprint', () => { $('sheet').innerHTML = ''; });

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
  const name = `${safeName(state.fileName)}_GM.txt`;
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
$('save').addEventListener('click', () => $('exportDlg').close());
document.addEventListener('keydown', ev => {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
  const k = ev.key.toLowerCase();
  if (k === 's') { ev.preventDefault(); saveCode(); } else if (k === 'o') { ev.preventDefault(); $('file').click(); }
});

/** Nombre de archivo a partir del nombre del proyecto: sin acentos ni espacios raros. */
const safeName = n => (n || 'grabado').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'grabado';
/* ---------- interfaz: pestañas, diálogos, resumen del trabajo ---------- */
// el nombre del proyecto también nombra lo que se exporta
$('docName').addEventListener('input', () => { state.fileName = $('docName').value.trim(); });
$('docName').addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === 'Escape') $('docName').blur(); });
function showTab(code) {
  $('tabFigBtn').setAttribute('aria-selected', String(!code)); $('tabCodeBtn').setAttribute('aria-selected', String(code));
  $('tabFig').hidden = code; $('tabCode').hidden = !code;
}
$('tabFigBtn').addEventListener('click', () => showTab(false));
$('tabCodeBtn').addEventListener('click', () => showTab(true));
// al tocar el código o simular, el inspector muestra el programa
$('simPlay').addEventListener('click', () => showTab(true));

/** Un renglón con lo que define el trabajo: pieza, herramienta y velocidades. Tocarlo abre dónde se cambia. */
function jobSummary() {
  const p = params(), tl = toolGeometry(p), n = v => String(+(+v).toFixed(3));
  sketch.setPiece(p.W, p.H);
  const TOOL = { ball: 'Ball mill', flat: 'Fresa plana', v: 'V-bit' }[p.toolType];
  $('jobPieceTxt').textContent = `${n(p.W)} × ${n(p.H)} mm`;
  $('jobToolTxt').textContent = `T${p.toolNum} ${TOOL} Ø${n(p.dia)} · ${n(p.depth)} mm`;
  $('jobLineTxt').textContent = `${tl.w.toFixed(2)} mm`;
  $('jobFeedsTxt').textContent = `${p.dialect === 'fanuc' ? 'Fanuc' : 'GRBL'} · S${p.rpm} · F${p.fxy}`;
}
const openDlg = (id, focus) => { $(id).showModal(); if (focus) $(focus)?.scrollIntoView({ block: 'start' }); };
$('jobPiece').addEventListener('click', () => openDlg('jobDlg', 'secPiece'));
$('jobTool').addEventListener('click', () => openDlg('jobDlg', 'secTool'));
$('jobLine').addEventListener('click', () => openDlg('jobDlg', 'secTool'));
$('jobFeeds').addEventListener('click', () => openDlg('setDlg'));
$('setBtn').addEventListener('click', () => openDlg('setDlg'));
document.querySelectorAll('#jobDlg input, #jobDlg select, #setDlg input, #setDlg select').forEach(el => el.addEventListener('change', jobSummary));

function openExport() {
  if (!state.gcode) { $('toast').textContent = 'Todavía no hay nada que exportar: dibuja o abre algo primero.'; return; }
  const g = state.lastG, p = params();
  $('exportSum').textContent = `${g.lines} líneas · ~${Math.max(1, Math.round(g.mins))} min · ${p.dialect === 'fanuc' ? 'Fanuc / Haas' : 'GRBL'}`;
  $('exportDlg').showModal();
}
$('exportBtn').addEventListener('click', openExport);
$('save2').addEventListener('click', openExport);
$('copy2').addEventListener('click', () => { $('exportDlg').close(); $('copy').click(); });

/** Panel de texto: aparece con la herramienta Texto o al elegir un texto. */
function openText() {
  state.textOpen = true; setTool('select'); select(-1); showTab(false); renderAll();
  $('txtPanel').hidden = false; $('tText').focus(); $('tText').select();
}
$('textTool').addEventListener('click', openText);
$('textTool2').addEventListener('click', openText);
$('txtClose').addEventListener('click', () => { state.textOpen = false; select(-1); renderAll(); });

$('emptyDraw').addEventListener('click', () => setTool('rect'));
$('emptyOpen').addEventListener('click', () => $('file').click());
$('emptyDemo').addEventListener('click', () => $('demo').click());

// un error al abrir o procesar también sale flotando: la pestaña Figuras puede no estar a la vista
new MutationObserver(() => { const m = $('loadErr').textContent; if (m) $('toast').textContent = m; })
  .observe($('loadErr'), { childList: true, characterData: true, subtree: true });

// los avisos flotantes se van solos
let toastT;
new MutationObserver(() => { clearTimeout(toastT); if ($('toast').textContent) toastT = setTimeout(() => { $('toast').textContent = ''; }, 4000); })
  .observe($('toast'), { childList: true, characterData: true, subtree: true });

/* ---------- inicio ---------- */
(async () => {
  restoreParams();
  loadSketch();
  setTool('select');
  if (sketch.entities.length) { assemble(); state.ready = true; await refresh(); return; } // hay un croquis guardado: se abre ese, sin el ejemplo
  $('fit').value = 'native'; state.demoFit = true;
  state.lastSvg = DEMO_SVG; state.fileName = 'Ejemplo'; $('docName').value = 'Ejemplo';
  await loadShapes(() => parseSVG(DEMO_SVG, $('svghost'), SVG_QUALITY[+$('svgQ').value - 1][0]), false);
  Object.entries(DEMO_TEXT).forEach(([k, v]) => { const id = { text: 'tText', font: 'tFont', h: 'tH', sp: 'tSp', x: 'tX', y: 'tY' }[k]; $(id).value = v; });
  await addText(textFromForm({ id: ++state.textSeq }));
  select(-1);
  state.ready = true;
  await refresh();
  $('toast').textContent = '';
})();
document.fonts?.ready.then(() => drawOnly());
