// Vista previa: la pieza, el grabado con el ancho real de la herramienta, la selección y el recorrido.
import { area, fromC } from '../geometry/clipper.js';
import { distSeg, pointInPolygon } from '../geometry/simplify.js';

export const MODE_COLOR = { fill: '--m-fill', contour: '--m-contour', invert: '--m-invert', line: '--m-line', skip: '--m-skip' };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/** Contornos de un elemento en mm, para dibujar el borde y para la selección. */
export function outlines(e) {
  return e.type === 'line'
    ? e.parts.map(p => ({ pts: p.pts, closed: p.closed }))
    : e.parts.flatMap(p => [p.outer, ...p.holes].map(q => ({ pts: fromC(q), closed: true })));
}

export function bbox(e) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  outlines(e).forEach(p => p.pts.forEach(([x, y]) => {
    if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
  }));
  return isFinite(a) ? [a, b, c, d] : null;
}

export function createPreview(cv) {
  const ctx = cv.getContext('2d');
  let view = { k: 1, ox: 0, oy: 0, H: 50 };

  const toMM = (mx, my) => [(mx - view.ox) / view.k, view.H - (my - view.oy) / view.k];

  /**
   * @param {{elements:any[], selected:number, W:number, H:number, toolWidth:number, plan:any, showPath:boolean, dragging?:boolean}} s
   */
  function draw(s) {
    const { elements, selected, W, H, toolWidth, plan, showPath, dragging } = s;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cv.clientWidth || 900, pad = 18;
    const k = (cssW - 2 * pad) / W, cssH = H * k + 2 * pad;
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); cv.style.height = cssH + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view = { k, ox: pad, oy: pad, H };
    const X = x => pad + x * k, Y = y => pad + (H - y) * k;
    ctx.clearRect(0, 0, cssW, cssH);

    // pieza y cuadrícula de 10 mm
    ctx.fillStyle = css('--plate'); ctx.strokeStyle = css('--plate-edge'); ctx.lineWidth = 1;
    ctx.fillRect(X(0), Y(H), W * k, H * k);
    ctx.strokeRect(X(0) + 0.5, Y(H) + 0.5, W * k - 1, H * k - 1);
    ctx.globalAlpha = 0.35; ctx.beginPath();
    for (let x = 10; x < W; x += 10) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(H)); }
    for (let y = 10; y < H; y += 10) { ctx.moveTo(X(0), Y(y)); ctx.lineTo(X(W), Y(y)); }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = css('--muted'); ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText('X0 Y0', X(0) + 3, Y(0) + 13);

    const path = (pts, closed) => {
      ctx.beginPath();
      pts.forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      if (closed) ctx.closePath();
    };
    const outline = e => outlines(e).forEach(p => { path(p.pts, p.closed); ctx.stroke(); });
    const isDragged = e => dragging && e === elements[selected];

    // omitidos y elemento arrastrado: solo borde punteado
    ctx.setLineDash([4, 3]); ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1;
    elements.forEach(e => { if (e.mode === 'skip' || isDragged(e)) outline(e); });
    ctx.setLineDash([]);

    // grabado simulado: cada trayectoria con el ancho real de la línea
    ctx.strokeStyle = css('--cut'); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, toolWidth * k);
    elements.forEach(e => { if (!isDragged(e)) (e.paths || []).forEach(p => { path(p.pts, false); ctx.stroke(); }); });

    if (plan && showPath && !dragging) {
      ctx.lineWidth = 1; ctx.strokeStyle = css('--accent'); ctx.globalAlpha = 0.9;
      elements.forEach(e => (e.paths || []).forEach(p => { path(p.pts, false); ctx.stroke(); }));
      ctx.setLineDash([3, 4]); ctx.globalAlpha = 0.6;
      let pos = [0, 0];
      ctx.beginPath();
      plan.order.forEach(({ seq }) => seq.forEach(p => {
        ctx.moveTo(X(pos[0]), Y(pos[1])); ctx.lineTo(X(p.pts[0][0]), Y(p.pts[0][1]));
        pos = p.pts[p.pts.length - 1];
      }));
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    if (selected >= 0 && elements[selected]) {
      const e = elements[selected];
      ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2; outline(e);
      if (e.type === 'region') {
        ctx.fillStyle = css('--accent'); ctx.globalAlpha = 0.12; ctx.beginPath();
        e.parts.forEach(p => [p.outer, ...p.holes].forEach(q => fromC(q).forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))))));
        ctx.fill('evenodd'); ctx.globalAlpha = 1;
      }
    }

    // etiqueta con el número (o T para textos) en la esquina superior derecha de cada elemento
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    elements.forEach((e, i) => {
      const bb = bbox(e);
      if (!bb) return;
      const tx = X(bb[2]) - 2, ty = Y(bb[3]) - 3;
      const lbl = e.src === 'text' ? 'T' : String(i + 1);
      const w = ctx.measureText(lbl).width + 8;
      ctx.fillStyle = css(MODE_COLOR[e.mode]);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx - w / 2, ty - 12, w, 15, 3); else ctx.rect(tx - w / 2, ty - 12, w, 15);
      ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(lbl, tx - w / 2 + 4, ty - 1);
    });
  }

  /** Índice del elemento bajo el cursor (el más pequeño si hay varios) o −1. */
  function hit(mx, my, elements, toolWidth) {
    const [x, y] = toMM(mx, my);
    const tol = Math.max(toolWidth, 1.5);
    let best = -1, bestA = Infinity;
    elements.forEach((e, i) => {
      const bb = bbox(e);
      if (!bb || x < bb[0] - tol || x > bb[2] + tol || y < bb[1] - tol || y > bb[3] + tol) return;
      if (e.src === 'text') {
        const a = (bb[2] - bb[0]) * (bb[3] - bb[1]);
        if (a < bestA) { best = i; bestA = a; }
        return;
      }
      if (e.type === 'line') {
        if (e.parts.some(p => p.pts.some((q, j) => j && distSeg([x, y], p.pts[j - 1], q) < tol)) && bestA > 0) { best = i; bestA = 0; }
        return;
      }
      const polys = e.parts.flatMap(p => [p.outer, ...p.holes]).map(fromC);
      let inside = false;
      polys.forEach(p => { if (pointInPolygon([x, y], p)) inside = !inside; });
      const a = Math.abs(e.parts.reduce((s, p) => s + area([p.outer]), 0));
      const near = !inside && polys.some(p => p.some((q, j) => j && distSeg([x, y], p[j - 1], q) < tol));
      if ((inside || near) && a < bestA) { best = i; bestA = a; }
    });
    return best;
  }

  return { draw, hit, toMM };
}
