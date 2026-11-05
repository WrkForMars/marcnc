// Editor del croquis: herramientas de dibujo, ajuste a puntos, coordenadas tecleadas, mover, deshacer.
// Dibuja en una capa aparte sobre la vista previa, así mover el cursor no recalcula el grabado.
import { arcSweep, entityPts, hitEntity, parseNum, parsePoint, snap, snapPoints, translate } from './geometry.js';

const RAD = Math.PI / 180;
const ang = (c, p) => ((Math.atan2(p[1] - c[1], p[0] - c[0]) / RAD) + 360) % 360;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r3 = v => Math.round(v * 1000) / 1000;

/** Qué pide cada herramienta en cada paso. */
const PROMPTS = {
  select: () => 'Toca una figura para editarla o arrástrala para moverla.',
  line: n => (n ? 'Siguiente punto. Enter o doble clic termina; tocar el primer punto cierra la figura.' : 'Primer punto de la línea.'),
  rect: n => (n ? 'Esquina opuesta, o @ancho alto.' : 'Primera esquina del rectángulo.'),
  circle: n => (n ? 'Un punto del borde, o escribe el radio.' : 'Centro del círculo.'),
  arc: n => ['Centro del arco.', 'Inicio del arco, o escribe el radio.', 'Final del arco (antihorario), o escribe el ángulo final en grados.'][n],
  poly: n => (n ? 'Un vértice, o escribe el radio.' : 'Centro del polígono.'),
};

/**
 * @param {{onChange:()=>void, onRedraw:()=>void, onStatus:(s:{prompt:string, cursor:[number,number]|null, kind:string})=>void, css:(v:string)=>string}} hooks
 */
export function createSketchEditor(hooks) {
  const S = {
    entities: [], modes: {}, nextId: 1,
    tool: 'select', pts: [], hover: null, selected: null, drag: null,
    undo: [], redo: [], last: [0, 0],
    opt: { grid: 1, snap: true, sides: 6 },
  };

  const status = () => hooks.onStatus({ prompt: PROMPTS[S.tool](S.pts.length), cursor: S.hover && S.hover.p, kind: S.hover ? S.hover.kind : '' });
  const snapshot = () => JSON.stringify({ entities: S.entities, modes: S.modes, nextId: S.nextId });
  const restore = s => { const o = JSON.parse(s); S.entities = o.entities; S.modes = o.modes; S.nextId = o.nextId; };
  /** Toda modificación pasa por aquí: guarda para deshacer y avisa. */
  function commit(fn) {
    S.undo.push(snapshot());
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
    fn();
    if (S.selected && !S.entities.some(e => e.id === S.selected)) S.selected = null;
    hooks.onChange(); status(); hooks.onRedraw();
  }
  const add = e => commit(() => { e.id = S.nextId++; S.entities.push(e); S.selected = e.id; });
  const base = () => (S.pts.length ? S.pts[S.pts.length - 1] : S.last);

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
    }
    status(); hooks.onRedraw();
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
      case 'circle': return { type: 'circle', cx: P[0][0], cy: P[0][1], r: Math.max(1e-3, dist(h, P[0])) };
      case 'poly': return { type: 'poly', cx: P[0][0], cy: P[0][1], r: Math.max(1e-3, dist(h, P[0])), n: S.opt.sides, rot: ang(P[0], h) };
      case 'arc':
        if (P.length === 1) return { type: 'line', pts: [P[0], h], closed: false };
        return { type: 'arc', cx: P[0][0], cy: P[0][1], r: dist(P[1], P[0]), a1: ang(P[0], P[1]), a2: ang(P[0], h) };
    }
    return null;
  }

  const api = {
    get tool() { return S.tool; },
    get entities() { return S.entities; },
    get modes() { return S.modes; },
    get selected() { return S.entities.find(e => e.id === S.selected) || null; },
    get busy() { return S.pts.length > 0 || !!S.drag; },

    load(data) {
      if (!data || !Array.isArray(data.entities)) return;
      S.entities = data.entities; S.modes = data.modes || {}; S.nextId = data.nextId || (Math.max(0, ...S.entities.map(e => e.id)) + 1);
      S.undo = []; S.redo = [];
    },
    save: () => ({ entities: S.entities, modes: S.modes, nextId: S.nextId }),

    setTool(t) {
      if (S.tool === 'line' && S.pts.length >= 2) finishLine();
      S.tool = t; S.pts = []; S.drag = null;
      if (t !== 'select') S.selected = null;
      status(); hooks.onRedraw();
    },
    setOptions(o) { Object.assign(S.opt, o); hooks.onRedraw(); },
    select(id) { S.selected = id; status(); hooks.onRedraw(); },
    setMode(id, m) { S.modes[id] = m; },

    /** @param {[number,number]} p cursor en mm @param {number} tol radio de captura en mm */
    move(p, tol) {
      const extra = S.tool === 'line' ? S.pts : [];
      S.hover = S.tool === 'select' && !S.drag ? { p, kind: '' } : snap(p, S.entities.filter(e => !S.drag || e.id !== S.drag.id), { ...S.opt, tol, extra });
      if (S.drag) {
        const g = S.opt.snap ? S.opt.grid : 0;
        const rd = v => (g ? Math.round(v / g) * g : v);
        S.drag.dx = rd(p[0] - S.drag.start[0]); S.drag.dy = rd(p[1] - S.drag.start[1]);
      }
      status(); hooks.onRedraw();
    },
    leave() { S.hover = null; status(); hooks.onRedraw(); },

    /** @returns {boolean} si el croquis atendió el clic (si no, la vista previa selecciona como siempre) */
    down(p, tol) {
      if (S.tool !== 'select') { api.move(p, tol); point(S.hover.p); return true; }
      const e = hitEntity(S.entities, p, tol);
      if (!e) { if (S.selected) { S.selected = null; status(); hooks.onRedraw(); } return false; }
      S.selected = e.id;
      S.drag = { id: e.id, start: p, dx: 0, dy: 0 };
      status(); hooks.onRedraw();
      return true;
    },
    up() {
      const d = S.drag;
      S.drag = null;
      if (d && (d.dx || d.dy)) commit(() => { S.entities = S.entities.map(e => (e.id === d.id ? translate(e, r3(d.dx), r3(d.dy)) : e)); });
      else hooks.onRedraw();
    },
    dblclick() { if (S.tool === 'line') finishLine(); },

    /**
     * Coordenada o medida tecleada.
     * @returns {string} mensaje de error, o '' si se aceptó
     */
    submit(str) {
      if (S.tool === 'select') return 'Elige una herramienta de dibujo para escribir coordenadas.';
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
        else if (S.pts.length) { S.pts = []; status(); hooks.onRedraw(); }
        else if (S.tool !== 'select') api.setTool('select');
        else if (S.selected) api.select(null);
        else return false;
        return true;
      }
      if (k === 'Enter' && S.tool === 'line' && S.pts.length) { finishLine(); return true; }
      if ((k === 'Delete' || k === 'Backspace') && S.selected && S.tool === 'select') { api.remove(S.selected); return true; }
      return false;
    },

    update(id, patch) { commit(() => { S.entities = S.entities.map(e => (e.id === id ? { ...e, ...patch } : e)); }); },
    remove(id) { commit(() => { S.entities = S.entities.filter(e => e.id !== id); delete S.modes[id]; }); },
    duplicate(id) {
      const e = S.entities.find(q => q.id === id);
      if (e) add(translate(JSON.parse(JSON.stringify(e)), S.opt.grid * 5, -S.opt.grid * 5));
    },
    clear() { if (S.entities.length) commit(() => { S.entities = []; S.modes = {}; S.selected = null; }); },
    undoOne() { if (!S.undo.length) return false; S.redo.push(snapshot()); restore(S.undo.pop()); S.pts = []; hooks.onChange(); status(); hooks.onRedraw(); return true; },
    redoOne() { if (!S.redo.length) return false; S.undo.push(snapshot()); restore(S.redo.pop()); hooks.onChange(); status(); hooks.onRedraw(); return true; },
    refreshStatus: status,

    /** Capa del croquis. X, Y: mm → px; k: px por mm; W, H: pieza en mm. */
    draw(ctx, X, Y, k, W, H) {
      const css = hooks.css, drawing = S.tool !== 'select';
      const path = (pts, closed) => { ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); if (closed) ctx.closePath(); ctx.stroke(); };
      const shape = (e, tol) => { const { pts, closed } = entityPts(e, tol); path(pts, closed); };
      const tol = 0.5 / k; // medio píxel

      if (drawing) {
        // cuadrícula fina: la del imán, o múltiplos suyos si quedaría muy apretada
        let g = S.opt.grid;
        while (g * k < 8) g *= g < 1 ? 2 : 5;
        ctx.strokeStyle = css('--plate-edge'); ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = g; x < W - 1e-9; x += g) { ctx.moveTo(Math.round(X(x)) + 0.5, Y(0)); ctx.lineTo(Math.round(X(x)) + 0.5, Y(H)); }
        for (let y = g; y < H - 1e-9; y += g) { ctx.moveTo(X(0), Math.round(Y(y)) + 0.5); ctx.lineTo(X(W), Math.round(Y(y)) + 0.5); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }

      // todas las figuras del croquis, finas, para verlas aunque estén omitidas o tapadas por el grabado
      ctx.lineWidth = 1; ctx.strokeStyle = css('--plate-accent'); ctx.globalAlpha = drawing ? 0.8 : 0.45;
      S.entities.forEach(e => { if (!S.drag || e.id !== S.drag.id) shape(e, tol); });
      ctx.globalAlpha = 1;

      const sel = api.selected;
      if (sel) {
        const e = S.drag ? translate(sel, S.drag.dx, S.drag.dy) : sel;
        ctx.lineWidth = 2; ctx.strokeStyle = css('--plate-accent'); shape(e, tol);
        ctx.fillStyle = css('--panel');
        snapPoints(e).forEach(({ p }) => { ctx.fillRect(X(p[0]) - 3, Y(p[1]) - 3, 6, 6); ctx.strokeRect(X(p[0]) - 3, Y(p[1]) - 3, 6, 6); });
        if (S.drag && (S.drag.dx || S.drag.dy)) label(ctx, css, X(S.drag.start[0]) + 12, Y(S.drag.start[1]) - 12, `Δ ${fmt(S.drag.dx)}, ${fmt(S.drag.dy)}`);
      }

      const rb = rubber();
      if (rb) {
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = css('--plate-accent'); shape(rb, tol); ctx.setLineDash([]);
        const h = S.hover.p, P = S.pts;
        const o = P[P.length - 1];
        let txt = '';
        if (S.tool === 'line' || (S.tool === 'arc' && P.length === 1)) txt = `${fmt(dist(o, h))} mm · ${fmt(ang(o, h))}°`;
        else if (S.tool === 'rect') txt = `${fmt(Math.abs(h[0] - P[0][0]))} × ${fmt(Math.abs(h[1] - P[0][1]))} mm`;
        else if (S.tool === 'circle' || S.tool === 'poly') txt = `R ${fmt(dist(h, P[0]))} mm`;
        else if (S.tool === 'arc') txt = `${fmt(arcSweep(rb))}°`;
        if (txt) label(ctx, css, X(h[0]) + 12, Y(h[1]) + 22, txt);
      }
      S.pts.forEach(p => { ctx.fillStyle = css('--plate-accent'); ctx.fillRect(X(p[0]) - 2.5, Y(p[1]) - 2.5, 5, 5); });

      if (drawing && S.hover) {
        const [x, y] = S.hover.p, px = X(x), py = Y(y);
        ctx.strokeStyle = css('--cut'); ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(px - 8, py + 0.5); ctx.lineTo(px + 8, py + 0.5); ctx.moveTo(px + 0.5, py - 8); ctx.lineTo(px + 0.5, py + 8); ctx.stroke();
        if (S.hover.kind && S.hover.kind !== 'cuadrícula') {
          ctx.strokeStyle = css('--plate-accent'); ctx.lineWidth = 2; ctx.strokeRect(px - 5, py - 5, 10, 10);
          label(ctx, css, px + 12, py - 10, S.hover.kind);
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
