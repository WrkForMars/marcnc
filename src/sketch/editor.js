// Editor del croquis, con la forma de trabajar de un CAD: herramientas de dibujo con inferencias (horizontal, vertical,
// alineado con otros puntos), cotas que mandan sobre la geometría, figuras azules mientras les falte alguna cota y negras
// cuando quedan definidas, geometría de construcción, selección múltiple (clic con Shift o recuadro), patrones y simetría.
// Dibuja en una capa aparte sobre la vista previa, así mover el cursor no recalcula el grabado.
import {
  applyDims, arcSweep, definedState, dimGeometry, dimensions, entityBox, entityPts, hitEntity, infer, measure, mirror,
  parseNum, parsePoint, rotate, snapPoints, translate,
} from './geometry.js';

const RAD = Math.PI / 180;
const ang = (c, p) => ((Math.atan2(p[1] - c[1], p[0] - c[0]) / RAD) + 360) % 360;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r3 = v => Math.round(v * 1000) / 1000;
/** Distancia del punto p a la recta que pasa por a y b. */
const toLine = (p, a, b) => { const L = dist(a, b) || 1e-9; return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L; };

/** Qué pide cada herramienta en cada paso. */
const PROMPTS = {
  select: () => 'Toca una figura (Shift suma) o arrastra un recuadro. Clic derecho: menú · rueda: zoom · Enter: repite el último comando.',
  line: n => (n ? 'Siguiente punto. Enter o doble clic termina; tocar el primer punto cierra la figura.' : 'Primer punto de la línea.'),
  rect: n => (n ? 'Esquina opuesta, o @ancho alto.' : 'Primera esquina del rectángulo.'),
  crect: n => (n ? 'Una esquina, o @medio ancho medio alto.' : 'Centro del rectángulo.'),
  circle: n => (n ? 'Un punto del borde, o escribe el radio.' : 'Centro del círculo.'),
  arc: n => ['Centro del arco.', 'Inicio del arco, o escribe el radio.', 'Final del arco (antihorario), o escribe el ángulo final en grados.'][n],
  poly: n => (n ? 'Un vértice, o escribe el radio.' : 'Centro del polígono.'),
  slot: n => ['Centro del primer extremo de la ranura.', 'Centro del otro extremo, o @largo<ángulo.', 'Ancho: un punto en la orilla, o escribe el ancho.'][n],
  dim: n => (n ? 'Toca un espacio vacío (o la misma figura) para su tamaño, otra figura para la distancia entre ambas, o un borde de la pieza.' : 'Cota inteligente: toca la figura que quieres acotar.'),
};
const DRAW_TOOLS = ['line', 'rect', 'crect', 'circle', 'arc', 'poly', 'slot'];

/**
 * @param {{onChange:()=>void, onRedraw:()=>void, onStatus:(s:{prompt:string, cursor:[number,number]|null, kind:string})=>void,
 *   css:(v:string)=>string, onDimCreated?:(id:number)=>void}} hooks
 */
export function createSketchEditor(hooks) {
  const S = {
    entities: [], modes: {}, nextId: 1, dims: [], nextDim: 1,
    tool: 'select', lastTool: 'line', pts: [], hover: null, sel: new Set(), drag: null, box: null, dimFirst: null, ghost: null,
    undo: [], redo: [], last: [0, 0],
    opt: { grid: 1, snap: true, sides: 6, W: 90, H: 50 },
  };

  const status = () => hooks.onStatus({ prompt: PROMPTS[S.tool](S.tool === 'dim' ? (S.dimFirst ? 1 : 0) : S.pts.length), cursor: S.hover && S.hover.p, kind: S.hover ? S.hover.kind : '' });
  const snapshot = () => JSON.stringify({ entities: S.entities, modes: S.modes, nextId: S.nextId, dims: S.dims, nextDim: S.nextDim });
  const restore = s => {
    const o = JSON.parse(s);
    S.entities = o.entities; S.modes = o.modes; S.nextId = o.nextId; S.dims = o.dims || []; S.nextDim = o.nextDim || 1;
    const ids = new Set(S.entities.map(e => e.id));
    S.sel.forEach(id => { if (!ids.has(id)) S.sel.delete(id); }); // sin elegir figuras que ya no existen
  };
  /** Las cotas mandan: después de cualquier cambio, cada una vuelve a poner su figura donde dice. */
  const enforce = () => { if (S.dims.length) S.entities = applyDims(S.entities, S.dims, S.opt.W, S.opt.H); };
  /** Toda modificación pasa por aquí: guarda para deshacer, hace cumplir las cotas y avisa. */
  function commit(fn) {
    S.undo.push(snapshot());
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
    fn();
    const ids = new Set(S.entities.map(e => e.id));
    S.dims = S.dims.filter(d => ids.has(d.ent) && (d.kind !== 'between' || ids.has(d.ref)));
    enforce();
    S.sel.forEach(id => { if (!ids.has(id)) S.sel.delete(id); });
    hooks.onChange(); status(); hooks.onRedraw();
  }
  const add = e => commit(() => { e.id = S.nextId++; S.entities.push(e); S.sel = new Set([e.id]); });
  const base = () => (S.pts.length ? S.pts[S.pts.length - 1] : S.last);
  const byId = () => new Map(S.entities.map(e => [e.id, e]));
  const selList = () => S.entities.filter(e => S.sel.has(e.id));

  /** Punto nuevo para la herramienta activa (de un clic o tecleado). */
  function point(p) {
    S.last = p;
    const P = S.pts, t = S.tool;
    if (t === 'line') {
      if (P.length >= 3 && dist(p, P[0]) < 1e-6) { finishLine(true); return; }
      if (P.length && dist(p, P[P.length - 1]) < 1e-6) return; // doble clic en el mismo punto
      P.push(p);
    } else if (t === 'rect') {
      if (!P.length) P.push(p);
      else if (Math.abs(p[0] - P[0][0]) > 1e-6 && Math.abs(p[1] - P[0][1]) > 1e-6) {
        S.pts = []; add({ type: 'rect', x: r3(Math.min(P[0][0], p[0])), y: r3(Math.min(P[0][1], p[1])), w: r3(Math.abs(p[0] - P[0][0])), h: r3(Math.abs(p[1] - P[0][1])) });
      }
    } else if (t === 'crect') {
      if (!P.length) P.push(p);
      else if (Math.abs(p[0] - P[0][0]) > 1e-6 && Math.abs(p[1] - P[0][1]) > 1e-6) {
        const [c] = P, hw = Math.abs(p[0] - c[0]), hh = Math.abs(p[1] - c[1]);
        S.pts = []; add({ type: 'rect', x: r3(c[0] - hw), y: r3(c[1] - hh), w: r3(2 * hw), h: r3(2 * hh) });
      }
    } else if (t === 'circle' || t === 'poly') {
      if (!P.length) P.push(p);
      else if (dist(p, P[0]) > 1e-6) {
        const c = P[0]; S.pts = [];
        add(t === 'circle'
          ? { type: 'circle', cx: c[0], cy: c[1], r: r3(dist(p, c)) }
          : { type: 'poly', cx: c[0], cy: c[1], r: r3(dist(p, c)), n: S.opt.sides, rot: r3(ang(c, p)) });
      }
    } else if (t === 'arc') {
      if (P.length < 2) { if (!P.length || dist(p, P[0]) > 1e-6) P.push(p); }
      else {
        const [c, s] = P; S.pts = [];
        add({ type: 'arc', cx: c[0], cy: c[1], r: r3(dist(s, c)), a1: r3(ang(c, s)), a2: r3(ang(c, p)) });
      }
    } else if (t === 'slot') {
      if (P.length < 2) { if (!P.length || dist(p, P[0]) > 1e-6) P.push(p); }
      else finishSlot(2 * toLine(p, P[0], P[1]));
    }
    status(); hooks.onRedraw();
  }
  function finishSlot(w) {
    const [a, b] = S.pts;
    S.pts = [];
    if (w > 1e-6) add({ type: 'slot', x1: r3(a[0]), y1: r3(a[1]), x2: r3(b[0]), y2: r3(b[1]), w: r3(w) });
  }
  function finishLine(closed = false) {
    const P = S.pts;
    S.pts = [];
    if (P.length >= 2) add({ type: 'line', pts: P.map(([x, y]) => [r3(x), r3(y)]), closed: closed && P.length >= 3 });
    else { status(); hooks.onRedraw(); }
  }

  /** Figura en curso con el cursor como siguiente punto, para dibujarla mientras se define. */
  function rubber() {
    const P = S.pts, h = S.hover && S.hover.p;
    if (!P.length || !h) return null;
    switch (S.tool) {
      case 'line': return { type: 'line', pts: [...P, h], closed: false };
      case 'rect': return { type: 'rect', x: P[0][0], y: P[0][1], w: h[0] - P[0][0], h: h[1] - P[0][1] };
      case 'crect': { const hw = Math.abs(h[0] - P[0][0]), hh = Math.abs(h[1] - P[0][1]); return { type: 'rect', x: P[0][0] - hw, y: P[0][1] - hh, w: 2 * hw, h: 2 * hh }; }
      case 'circle': return { type: 'circle', cx: P[0][0], cy: P[0][1], r: Math.max(1e-3, dist(h, P[0])) };
      case 'poly': return { type: 'poly', cx: P[0][0], cy: P[0][1], r: Math.max(1e-3, dist(h, P[0])), n: S.opt.sides, rot: ang(P[0], h) };
      case 'arc':
        if (P.length === 1) return { type: 'line', pts: [P[0], h], closed: false };
        return { type: 'arc', cx: P[0][0], cy: P[0][1], r: dist(P[1], P[0]), a1: ang(P[0], P[1]), a2: ang(P[0], h) };
      case 'slot':
        if (P.length === 1) return { type: 'line', pts: [P[0], h], closed: false };
        return { type: 'slot', x1: P[0][0], y1: P[0][1], x2: P[1][0], y2: P[1][1], w: Math.max(1e-3, 2 * toLine(h, P[0], P[1])) };
    }
    return null;
  }

  /**
   * Guarda una cota nueva. Reemplaza la que ya fije lo mismo (el mismo tamaño, o la posición en ese eje de esa figura),
   * para que nunca haya dos cotas peleando por la misma medida.
   */
  function putDim(d) {
    const same = q => q.ent === d.ent && (d.kind === 'size' ? q.kind === 'size' && q.axis === d.axis : q.kind !== 'size' && q.axis === d.axis);
    const dim = { ...d, id: S.nextDim++, value: r3(d.value) };
    commit(() => { S.dims = S.dims.filter(q => !same(q)).concat(dim); });
    return dim.id;
  }
  /** Herramienta Cota: tamaño, distancia a un borde de la pieza o distancia entre dos figuras. */
  function dimClick(p, tol) {
    const e = hitEntity(S.entities, p, tol);
    const { W, H } = S.opt;
    if (!S.dimFirst) { if (e) { S.dimFirst = e.id; S.sel = new Set([e.id]); } status(); hooks.onRedraw(); return; }
    const first = S.entities.find(q => q.id === S.dimFirst);
    S.dimFirst = null;
    if (!first) { status(); hooks.onRedraw(); return; }
    let id = null;
    const nearEdge = Math.min(Math.abs(p[0]), Math.abs(W - p[0]), Math.abs(p[1]), Math.abs(H - p[1])) <= Math.max(tol * 3, 2);
    if ((e && e.id === first.id) || (!e && !nearEdge)) {
      // tamaño (como la cota inteligente: tocar la figura y luego un lugar libre para colocarla)
      // tamaño: todas las medidas que le falten (o la primera, si ya tiene todas)
      const have = new Set(S.dims.filter(d => d.ent === first.id && d.kind === 'size').map(d => d.axis));
      const sizes = dimensions(first, W, H).filter(d => d.kind === 'size');
      const todo = sizes.filter(d => !have.has(d.axis));
      (todo.length ? todo : sizes.slice(0, 1)).forEach(d => { id = putDim({ kind: 'size', ent: first.id, axis: d.axis, value: d.value }); });
    } else if (e) {
      // entre dos figuras: en el eje en que están más separadas; se mueve la segunda
      const b1 = entityBox(first), b2 = entityBox(e);
      const dx = (b2[0] + b2[2]) / 2 - (b1[0] + b1[2]) / 2, dy = (b2[1] + b2[3]) / 2 - (b1[1] + b1[3]) / 2;
      const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      id = putDim({ kind: 'between', ent: e.id, ref: first.id, axis, value: Math.abs(axis === 'x' ? dx : dy) });
    } else {
      // un borde de la pieza: el más cercano al toque
      const sides = [['left', p[0]], ['right', W - p[0]], ['bottom', p[1]], ['top', H - p[1]]].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
      const side = sides[0][0], axis = side === 'left' || side === 'right' ? 'x' : 'y';
      const b = entityBox(first), value = { left: b[0], right: W - b[2], bottom: b[1], top: H - b[3] }[side];
      id = putDim({ kind: 'edge', ent: first.id, axis, side, value });
    }
    status(); hooks.onRedraw();
    if (id && hooks.onDimCreated) hooks.onDimCreated(id);
  }

  /**
   * Copias de la selección que haría una operación, sin agregarlas.
   * @param {{kind:'linear', n:number, dx:number, dy:number}|{kind:'circular', n:number, cx:number, cy:number, total?:number}|{kind:'mirror', axis:'x'|'y', c:number}} op
   *   linear: n copias más, cada una desplazada (dx, dy) respecto a la anterior; circular: n piezas en total alrededor de
   *   (cx, cy), repartidas en `total` grados (360 = vuelta completa); mirror: reflejo en x = c (axis 'x') o y = c (axis 'y')
   */
  function opCopies(op) {
    const src = selList();
    if (!src.length) return [];
    if (op.kind === 'linear') return Array.from({ length: op.n }, (_, k) => src.map(e => translate(e, op.dx * (k + 1), op.dy * (k + 1)))).flat();
    if (op.kind === 'circular') {
      const total = op.total ?? 360, step = total >= 360 ? 360 / op.n : total / Math.max(1, op.n - 1);
      return Array.from({ length: op.n - 1 }, (_, k) => src.map(e => rotate(e, op.cx, op.cy, step * (k + 1)))).flat();
    }
    if (op.kind === 'mirror') return src.map(e => mirror(e, op.axis, op.c));
    return [];
  }
  /** Agrega las copias de una operación en un solo paso de deshacer; quedan elegidas. Las cotas no se copian. */
  function addCopies(op) {
    const list = opCopies(op);
    S.ghost = null;
    if (!list.length) return 0;
    commit(() => {
      const added = [];
      list.forEach(e => { const c = { ...JSON.parse(JSON.stringify(e)), id: S.nextId++ }; S.entities.push(c); added.push(c.id); });
      S.sel = new Set(added);
    });
    return list.length;
  }

  const api = {
    get tool() { return S.tool; },
    /** Última herramienta de dibujo o de cota, para repetirla con Enter. */
    get lastTool() { return S.lastTool; },
    get entities() { return S.entities; },
    get modes() { return S.modes; },
    /** La figura elegida, si hay exactamente una. */
    get selected() { return S.sel.size === 1 ? S.entities.find(e => S.sel.has(e.id)) || null : null; },
    get selection() { return selList(); },
    /** La figura elegida tal como se ve ahora (con el arrastre en curso aplicado), para dibujar sus cotas. */
    get shown() { const e = api.selected; return e && S.drag ? translate(e, S.drag.dx, S.drag.dy) : e; },
    get busy() { return S.pts.length > 0 || !!S.drag || !!S.box; },
    get grid() { return S.opt.grid; },
    get dims() { return S.dims; },

    load(data) {
      if (!data || !Array.isArray(data.entities)) return;
      S.entities = data.entities; S.modes = data.modes || {}; S.nextId = data.nextId || (Math.max(0, ...S.entities.map(e => e.id)) + 1);
      S.dims = Array.isArray(data.dims) ? data.dims : []; S.nextDim = data.nextDim || (Math.max(0, ...S.dims.map(d => d.id)) + 1);
      S.undo = []; S.redo = [];
    },
    save: () => ({ entities: S.entities, modes: S.modes, nextId: S.nextId, dims: S.dims, nextDim: S.nextDim }),

    setTool(t) {
      if (S.tool === 'line' && S.pts.length >= 2) finishLine();
      S.tool = t; S.pts = []; S.drag = null; S.box = null; S.dimFirst = null;
      if (t !== 'select') S.lastTool = t;
      if (DRAW_TOOLS.includes(t)) S.sel = new Set();
      status(); hooks.onRedraw();
    },
    setOptions(o) { Object.assign(S.opt, o); hooks.onRedraw(); },
    /** Tamaño de la pieza: las cotas al borde derecho y al de arriba dependen de él. */
    setPiece(W, H) {
      if (W === S.opt.W && H === S.opt.H) return;
      S.opt.W = W; S.opt.H = H;
      if (S.dims.some(d => d.kind === 'edge')) { enforce(); hooks.onChange(); }
    },
    select(id) { S.sel = new Set(id ? [id] : []); status(); hooks.onRedraw(); },
    selectMany(ids) { S.sel = new Set(ids); status(); hooks.onRedraw(); },
    setMode(id, m) { S.modes[id] = m; },

    /** @param {[number,number]} p cursor en mm @param {number} tol radio de captura en mm */
    move(p, tol) {
      if (S.box) { S.box.cur = p; hooks.onRedraw(); return; }
      if (S.tool === 'select' || S.tool === 'dim') S.hover = { p, kind: '', guides: [] };
      else {
        const extra = S.tool === 'line' ? S.pts : [];
        S.hover = infer(p, S.entities, { ...S.opt, tol, extra, last: S.pts.length ? S.pts[S.pts.length - 1] : null });
      }
      if (S.drag) {
        const g = S.opt.snap ? S.opt.grid : 0;
        const rd = v => (g ? Math.round(v / g) * g : v);
        S.drag.dx = rd(p[0] - S.drag.start[0]); S.drag.dy = rd(p[1] - S.drag.start[1]);
      }
      status(); hooks.onRedraw();
    },
    leave() { S.hover = null; status(); hooks.onRedraw(); },

    /**
     * @param {boolean} [additive] Shift o Ctrl: suma o quita de la selección
     * @returns {boolean} si el croquis atendió el clic (si no, la vista previa selecciona como siempre)
     */
    down(p, tol, additive = false) {
      if (S.tool === 'dim') { dimClick(p, tol); return true; }
      if (S.tool !== 'select') { api.move(p, tol); point(S.hover.p); return true; }
      const e = hitEntity(S.entities, p, tol);
      if (!e) {
        if (!additive) S.sel = new Set();
        S.box = { start: p, cur: p, additive }; // posible recuadro de selección
        status(); hooks.onRedraw();
        return false;
      }
      if (additive) { if (S.sel.has(e.id)) S.sel.delete(e.id); else S.sel.add(e.id); }
      else if (!S.sel.has(e.id)) S.sel = new Set([e.id]);
      if (S.sel.has(e.id)) S.drag = { start: p, dx: 0, dy: 0 };
      status(); hooks.onRedraw();
      return true;
    },
    /** @returns {boolean} si terminó un recuadro de selección */
    up() {
      const b = S.box;
      S.box = null;
      if (b) {
        if (dist(b.start, b.cur) < 0.5) { hooks.onRedraw(); return false; }
        // de izquierda a derecha: lo que queda completo adentro; de derecha a izquierda: lo que toca
        const crossing = b.cur[0] < b.start[0];
        const x0 = Math.min(b.start[0], b.cur[0]), x1 = Math.max(b.start[0], b.cur[0]), y0 = Math.min(b.start[1], b.cur[1]), y1 = Math.max(b.start[1], b.cur[1]);
        S.entities.forEach(e => {
          const q = entityBox(e);
          const inside = q[0] >= x0 - 1e-6 && q[2] <= x1 + 1e-6 && q[1] >= y0 - 1e-6 && q[3] <= y1 + 1e-6;
          const touch = q[0] <= x1 && q[2] >= x0 && q[1] <= y1 && q[3] >= y0;
          if (crossing ? touch : inside) S.sel.add(e.id);
        });
        status(); hooks.onRedraw();
        return true;
      }
      const d = S.drag;
      S.drag = null;
      if (d && (d.dx || d.dy)) commit(() => { S.entities = S.entities.map(e => (S.sel.has(e.id) ? translate(e, r3(d.dx), r3(d.dy)) : e)); });
      else hooks.onRedraw();
      return false;
    },
    dblclick() { if (S.tool === 'line') finishLine(); },
    /** Clic derecho mientras se dibuja: termina la cadena de líneas o cancela lo que va a medias. @returns {boolean} si había algo en curso */
    endChain() {
      if (S.tool === 'line' && S.pts.length >= 2) { finishLine(); return true; }
      if (S.pts.length || S.dimFirst) { S.pts = []; S.dimFirst = null; status(); hooks.onRedraw(); return true; }
      return false;
    },

    /**
     * Coordenada o medida tecleada.
     * @returns {string} mensaje de error, o '' si se aceptó
     */
    submit(str) {
      if (S.tool === 'select' || S.tool === 'dim') return 'Elige una herramienta de dibujo para escribir coordenadas.';
      const n = parseNum(str), P = S.pts;
      if (n !== null) {
        if ((S.tool === 'circle' || S.tool === 'poly') && P.length === 1) {
          if (n <= 0) return 'El radio debe ser mayor que 0.';
          const c = P[0]; S.pts = [];
          add(S.tool === 'circle' ? { type: 'circle', cx: c[0], cy: c[1], r: n } : { type: 'poly', cx: c[0], cy: c[1], r: n, n: S.opt.sides, rot: 90 });
          return '';
        }
        if (S.tool === 'arc' && P.length === 1) { if (n <= 0) return 'El radio debe ser mayor que 0.'; point([P[0][0] + n, P[0][1]]); return ''; }
        if (S.tool === 'arc' && P.length === 2) {
          const c = P[0], r = dist(P[1], c);
          point([c[0] + r * Math.cos(n * RAD), c[1] + r * Math.sin(n * RAD)]);
          return '';
        }
        if (S.tool === 'slot' && P.length === 2) { if (n <= 0) return 'El ancho debe ser mayor que 0.'; finishSlot(n); return ''; }
      }
      const p = parsePoint(str, base());
      if (!p) return 'No entendí la coordenada. Usa "x y", "@dx dy" o "@distancia<ángulo".';
      point(p);
      return '';
    },
    /** Escape, Enter, Supr. @returns {boolean} si la tecla se usó */
    key(k) {
      if (k === 'Escape') {
        if (S.tool === 'line' && S.pts.length >= 2) finishLine();
        else if (S.pts.length || S.dimFirst) { S.pts = []; S.dimFirst = null; status(); hooks.onRedraw(); }
        else if (S.tool !== 'select') api.setTool('select');
        else if (S.sel.size) api.select(null);
        else return false;
        return true;
      }
      if (k === 'Enter' && S.tool === 'line' && S.pts.length) { finishLine(); return true; }
      if ((k === 'Delete' || k === 'Backspace') && S.sel.size && S.tool === 'select') { api.removeMany([...S.sel]); return true; }
      return false;
    },

    update(id, patch) { commit(() => { S.entities = S.entities.map(e => (e.id === id ? { ...e, ...patch } : e)); }); },
    /** Reemplaza la figura completa (p. ej. tras escribir una cota). */
    replace(id, ent) { commit(() => { S.entities = S.entities.map(e => (e.id === id ? { ...ent, id } : e)); }); },
    /** Agrega varias figuras de una vez (pegar): un solo paso de deshacer; quedan todas elegidas. */
    addMany(list) {
      if (!list.length) return;
      commit(() => { const ids = []; list.forEach(e => { const n = { ...JSON.parse(JSON.stringify(e)), id: S.nextId++ }; S.entities.push(n); ids.push(n.id); }); S.sel = new Set(ids); });
    },
    nudge(dx, dy) { if (S.sel.size) commit(() => { S.entities = S.entities.map(e => (S.sel.has(e.id) ? translate(e, dx, dy) : e)); }); },
    remove(id) { api.removeMany([id]); },
    removeMany(ids) { const s = new Set(ids); commit(() => { S.entities = S.entities.filter(e => !s.has(e.id)); ids.forEach(id => delete S.modes[id]); }); },
    duplicate(id) {
      const e = S.entities.find(q => q.id === id);
      if (e) add(translate(JSON.parse(JSON.stringify(e)), S.opt.grid * 5, -S.opt.grid * 5));
    },
    clear() { if (S.entities.length) commit(() => { S.entities = []; S.modes = {}; S.dims = []; S.sel = new Set(); }); },
    undoOne() { if (!S.undo.length) return false; S.redo.push(snapshot()); restore(S.undo.pop()); S.pts = []; hooks.onChange(); status(); hooks.onRedraw(); return true; },
    redoOne() { if (!S.redo.length) return false; S.undo.push(snapshot()); restore(S.redo.pop()); hooks.onChange(); status(); hooks.onRedraw(); return true; },
    refreshStatus: status,

    /* ----- cotas ----- */
    addDim(d) { return putDim(d); },
    setDimValue(id, v) { commit(() => { S.dims = S.dims.map(d => (d.id === id ? { ...d, value: r3(v) } : d)); }); },
    removeDim(id) { commit(() => { S.dims = S.dims.filter(d => d.id !== id); }); },
    /** Cotas guardadas listas para dibujar (con el arrastre en curso aplicado a la vista). */
    dimsView() {
      const ents = S.drag ? S.entities.map(e => (S.sel.has(e.id) ? translate(e, S.drag.dx, S.drag.dy) : e)) : S.entities;
      const map = new Map(ents.map(e => [e.id, e]));
      return S.dims.map(d => { const g = dimGeometry(d, map, S.opt.W, S.opt.H); return g && { ...d, ...g, persistent: true }; }).filter(Boolean);
    },
    /** Lo que le falta a cada figura para quedar definida. */
    defined() { return definedState(S.entities, S.dims); },
    /** Estado del croquis completo: cuántas figuras que se graban siguen sin definir. */
    sketchState() {
      const def = definedState(S.entities, S.dims), real = S.entities.filter(e => !e.construction);
      return { total: real.length, under: real.filter(e => !def.get(e.id)?.full).length };
    },
    measure(d) { return measure(d, byId(), S.opt.W, S.opt.H); },

    /* ----- operaciones sobre la selección ----- */
    setConstruction(on) { const s = new Set(S.sel); commit(() => { S.entities = S.entities.map(e => (s.has(e.id) ? { ...e, construction: on } : e)); }); },
    /** Matriz lineal: n copias más, cada una desplazada (dx, dy) respecto a la anterior. */
    linear(n, dx, dy) { return addCopies({ kind: 'linear', n, dx, dy }); },
    /** Matriz circular: n piezas en total alrededor de (cx, cy), repartidas en `total` grados (360 = vuelta completa). */
    circular(n, cx, cy, total = 360) { return addCopies({ kind: 'circular', n, cx, cy, total }); },
    /** Simetría: copia reflejada en x = c (axis 'x') o y = c (axis 'y'). */
    mirror(axis, c) { return addCopies({ kind: 'mirror', axis, c }); },
    /** Vista previa de una operación (como el PropertyManager antes de aceptar); null la quita. @returns {number} copias */
    previewOp(op) { S.ghost = op ? opCopies(op) : null; hooks.onRedraw(); return S.ghost ? S.ghost.length : 0; },
    /** Aplica la operación de la vista previa. @returns {number} copias agregadas */
    applyOp(op) { return addCopies(op); },
    /** Caja de toda la selección, para proponer centros de patrón y ejes de simetría. */
    selectionBox() {
      const b = selList().map(entityBox);
      return b.length ? [Math.min(...b.map(q => q[0])), Math.min(...b.map(q => q[1])), Math.max(...b.map(q => q[2])), Math.max(...b.map(q => q[3]))] : null;
    },

    /** Capa del croquis. X, Y: mm → px; k: px por mm; W, H: pieza en mm. */
    draw(ctx, X, Y, k, W, H) {
      const css = hooks.css, drawing = S.tool !== 'select';
      const path = (pts, closed) => { ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); if (closed) ctx.closePath(); ctx.stroke(); };
      const shape = (e, tol) => { const { pts, closed } = entityPts(e, tol); path(pts, closed); };
      const tol = 0.5 / k; // medio píxel

      if (drawing && S.tool !== 'dim') {
        // cuadrícula fina: la del imán, o múltiplos suyos si quedaría muy apretada
        let g = S.opt.grid;
        while (g * k < 8) g *= g < 1 ? 2 : 5;
        ctx.strokeStyle = css('--plate-edge'); ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = g; x < W - 1e-9; x += g) { ctx.moveTo(Math.round(X(x)) + 0.5, Y(0)); ctx.lineTo(Math.round(X(x)) + 0.5, Y(H)); }
        for (let y = g; y < H - 1e-9; y += g) { ctx.moveTo(X(0), Math.round(Y(y)) + 0.5); ctx.lineTo(X(W), Math.round(Y(y)) + 0.5); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }

      // cada figura según su estado: azul si le faltan cotas, negra si está definida, punteada si es de construcción
      const def = definedState(S.entities, S.dims);
      const off = e => (S.drag && S.sel.has(e.id) ? translate(e, S.drag.dx, S.drag.dy) : e);
      S.entities.forEach(e0 => {
        const e = off(e0), sel = S.sel.has(e.id) || S.dimFirst === e.id;
        ctx.setLineDash(e.construction ? [6, 4] : []);
        ctx.strokeStyle = css(e.construction ? '--plate-muted' : def.get(e.id)?.full ? '--cut' : '--plate-accent');
        ctx.lineWidth = sel ? 2.5 : 1.25;
        shape(e, tol);
      });
      ctx.setLineDash([]);

      // selección: tiradores en los puntos notables
      const sl = S.entities.filter(e => S.sel.has(e.id) || S.dimFirst === e.id).map(off);
      ctx.fillStyle = css('--plate-on'); ctx.strokeStyle = css('--plate-accent'); ctx.lineWidth = 1.5;
      sl.forEach(e => snapPoints(e).forEach(({ p }) => { ctx.fillRect(X(p[0]) - 3, Y(p[1]) - 3, 6, 6); ctx.strokeRect(X(p[0]) - 3, Y(p[1]) - 3, 6, 6); }));
      if (S.drag && (S.drag.dx || S.drag.dy)) label(ctx, css, X(S.drag.start[0]) + 12, Y(S.drag.start[1]) - 12, `Δ ${fmt(S.drag.dx)}, ${fmt(S.drag.dy)}`);

      // recuadro de selección: continuo = dentro, punteado = lo que toque
      if (S.box && dist(S.box.start, S.box.cur) >= 0.5) {
        const b = S.box, crossing = b.cur[0] < b.start[0];
        const x = Math.min(X(b.start[0]), X(b.cur[0])), y = Math.min(Y(b.start[1]), Y(b.cur[1]));
        const w = Math.abs(X(b.cur[0]) - X(b.start[0])), h = Math.abs(Y(b.cur[1]) - Y(b.start[1]));
        ctx.fillStyle = css('--plate-accent'); ctx.globalAlpha = 0.08; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
        ctx.setLineDash(crossing ? [5, 4] : []); ctx.strokeStyle = css('--plate-accent'); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
      }

      // líneas guía de las inferencias
      if (drawing && S.hover && S.hover.guides && S.hover.guides.length) {
        ctx.setLineDash([2, 4]); ctx.strokeStyle = css('--plate-accent'); ctx.lineWidth = 1;
        S.hover.guides.forEach(g => { ctx.beginPath(); ctx.moveTo(X(g.from[0]), Y(g.from[1])); ctx.lineTo(X(g.to[0]), Y(g.to[1])); ctx.stroke(); });
        ctx.setLineDash([]);
      }

      // vista previa de una matriz o simetría: punteada en el color de acento, hasta que se acepte
      if (S.ghost) {
        ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = css('--plate-accent');
        S.ghost.forEach(e => shape(e, tol));
        ctx.setLineDash([]);
      }

      const rb = rubber();
      if (rb) {
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = css('--plate-accent'); shape(rb, tol); ctx.setLineDash([]);
        const h = S.hover.p, P = S.pts;
        const o = P[P.length - 1];
        let txt = '';
        if (S.tool === 'line' || ((S.tool === 'arc' || S.tool === 'slot') && P.length === 1)) txt = `${fmt(dist(o, h))} mm · ${fmt(ang(o, h))}°`;
        else if (S.tool === 'crect') txt = `${fmt(2 * Math.abs(h[0] - P[0][0]))} × ${fmt(2 * Math.abs(h[1] - P[0][1]))} mm`;
        else if (S.tool === 'rect') txt = `${fmt(Math.abs(h[0] - P[0][0]))} × ${fmt(Math.abs(h[1] - P[0][1]))} mm`;
        else if (S.tool === 'circle' || S.tool === 'poly') txt = `R ${fmt(dist(h, P[0]))} mm`;
        else if (S.tool === 'arc') txt = `${fmt(arcSweep(rb))}°`;
        else if (S.tool === 'slot') txt = `ancho ${fmt(rb.w)} mm`;
        if (txt) label(ctx, css, X(h[0]) + 12, Y(h[1]) + 22, txt);
      }
      S.pts.forEach(p => { ctx.fillStyle = css('--plate-accent'); ctx.fillRect(X(p[0]) - 2.5, Y(p[1]) - 2.5, 5, 5); });

      if (drawing && S.tool !== 'dim' && S.hover) {
        const [x, y] = S.hover.p, px = X(x), py = Y(y);
        ctx.strokeStyle = css('--cut'); ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(px - 8, py + 0.5); ctx.lineTo(px + 8, py + 0.5); ctx.moveTo(px + 0.5, py - 8); ctx.lineTo(px + 0.5, py + 8); ctx.stroke();
        const kind = S.hover.kind;
        if (kind && kind !== 'cuadrícula') {
          ctx.strokeStyle = css('--plate-accent'); ctx.lineWidth = 2; ctx.strokeRect(px - 5, py - 5, 10, 10);
          label(ctx, css, px + 12, py - 10, kind === 'horizontal' ? '— horizontal' : kind === 'vertical' ? '| vertical' : kind);
        }
      }
    },
  };
  return api;
}

const fmt = v => String(+v.toFixed(2));

/** Etiqueta con fondo para medidas junto al cursor. */
function label(ctx, css, x, y, txt) {
  ctx.font = '500 12px "IBM Plex Mono", monospace';
  const w = ctx.measureText(txt).width + 8;
  ctx.fillStyle = css('--panel'); ctx.strokeStyle = css('--line-strong'); ctx.lineWidth = 1;
  ctx.fillRect(x, y - 13, w, 18); ctx.strokeRect(x + 0.5, y - 12.5, w - 1, 17);
  ctx.fillStyle = css('--ink'); ctx.fillText(txt, x + 4, y);
}
