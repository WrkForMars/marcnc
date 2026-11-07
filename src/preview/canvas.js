// Vista previa: la pieza, el grabado con el ancho real de la herramienta, la selección y el recorrido.
import { area, fromC } from '../geometry/clipper.js';
import { distSeg, pointInPolygon } from '../geometry/simplify.js';

export const MODE_COLOR = { fill: '--m-fill', contour: '--m-contour', relief: '--m-relief', vcarve: '--m-vcarve', cut: '--m-cut', drill: '--m-drill', invert: '--m-invert', line: '--m-line', skip: '--m-skip' };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/** Contornos de un elemento en mm, para dibujar el borde y para la selección. */
export function outlines(e) {
  if (e.type === 'relief') { const r = e.relief; return [{ pts: [[r.x0, r.y0], [r.x0 + r.w, r.y0], [r.x0 + r.w, r.y0 + r.h], [r.x0, r.y0 + r.h]], closed: true }]; }
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
  let view = { k: 1, ox: 0, oy: 0, W: 90, H: 50, ox0: 0, oy0: 0 };
  // zoom y desplazamiento sobre el encuadre que ajusta la pieza (z = 1: pieza completa)
  const nav = { z: 1, px: 0, py: 0, W: 0, H: 0 };

  // si el lienzo cambió de ancho y todavía no se vuelve a dibujar, se ve escalado (sin deformarse): se corrige aquí
  const toMM = (mx, my) => {
    const s = view.cssW && cv.clientWidth ? view.cssW / cv.clientWidth : 1;
    return [(mx * s - view.ox) / view.k, view.H - (my * s - view.oy) / view.k];
  };

  /**
   * @param {{elements:any[], selected:number, W:number, H:number, toolWidth:number, plan:any, showPath:boolean, dragging?:boolean, simulating?:boolean}} s
   *   simulating: no dibuja el grabado terminado (lo va dibujando la simulación), solo el recorrido pendiente
   */
  function draw(s) {
    const { elements, selected, hovered = -1, W, H, toolWidth, plan, showPath, dragging, simulating, stock } = s;
    const dpr = window.devicePixelRatio || 1;
    // márgenes para las reglas (abajo y a la izquierda, donde está el cero) y altura máxima para piezas altas
    const cssW = cv.clientWidth || 900, pL = 40, pR = 12, pT = 12, pB = 32;
    const maxH = Math.max(240, (window.innerHeight || 800) * 0.62);
    const k0 = Math.min((cssW - pL - pR) / W, (maxH - pT - pB) / H), cssH = H * k0 + pT + pB;
    const ox0 = pL + Math.max(0, (cssW - pL - pR - W * k0) / 2);
    if (W !== nav.W || H !== nav.H) { nav.z = 1; nav.px = nav.py = 0; nav.W = W; nav.H = H; } // pieza nueva: vista completa
    const k = k0 * nav.z, ox = ox0 + nav.px, oy = pT + nav.py;
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); // alto automático: conserva la proporción
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view = { k, ox, oy, W, H, cssW, ox0, oy0: pT };
    const X = x => ox + x * k, Y = y => oy + (H - y) * k;
    ctx.clearRect(0, 0, cssW, cssH);

    // reglas en mm sobre el banco: marcas cada 1, 5 y 10 mm y números sin encimarse
    const rulerText = css('--stage-text');
    ctx.strokeStyle = rulerText; ctx.fillStyle = rulerText; ctx.lineWidth = 1;
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    const every = 10 * Math.max(1, Math.ceil(32 / (10 * k)));
    ctx.beginPath();
    for (let x = 0; x <= W + 1e-9; x += 1) {
      const len = x % 10 === 0 ? 8 : x % 5 === 0 ? 5 : 3;
      if (len === 3 && k < 4) continue;
      const px = Math.round(X(x)) + 0.5; ctx.moveTo(px, Y(0) + 4); ctx.lineTo(px, Y(0) + 4 + len);
    }
    for (let y = 0; y <= H + 1e-9; y += 1) {
      const len = y % 10 === 0 ? 8 : y % 5 === 0 ? 5 : 3;
      if (len === 3 && k < 4) continue;
      const py = Math.round(Y(y)) + 0.5; ctx.moveTo(X(0) - 4, py); ctx.lineTo(X(0) - 4 - len, py);
    }
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let x = 0; x <= W + 1e-9; x += every) ctx.fillText(String(x), X(x), Y(0) + 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = 0; y <= H + 1e-9; y += every) ctx.fillText(String(y), X(0) - 14, Y(y));
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    // la placa con su cuadrícula de 10 mm
    ctx.fillStyle = css('--plate'); ctx.fillRect(X(0), Y(H), W * k, H * k);
    ctx.strokeStyle = css('--plate-grid'); ctx.beginPath();
    for (let x = 10; x < W; x += 10) { ctx.moveTo(Math.round(X(x)) + 0.5, Y(0)); ctx.lineTo(Math.round(X(x)) + 0.5, Y(H)); }
    for (let y = 10; y < H; y += 10) { ctx.moveTo(X(0), Math.round(Y(y)) + 0.5); ctx.lineTo(X(W), Math.round(Y(y)) + 0.5); }
    ctx.stroke();
    ctx.strokeStyle = css('--plate-edge'); ctx.strokeRect(X(0) + 0.5, Y(H) + 0.5, W * k - 1, H * k - 1);
    // cero de la pieza: punto y ejes cortos
    const acc = css('--plate-accent');
    ctx.strokeStyle = acc; ctx.fillStyle = acc; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0) + 22, Y(0)); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0), Y(0) - 22); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(0), Y(0), 4, 0, 2 * Math.PI); ctx.fill();
    ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.fillText('X', X(0) + 25, Y(0) - 3); ctx.fillText('Y', X(0) + 4, Y(0) - 26);
    ctx.lineWidth = 1;

    const path = (pts, closed) => {
      ctx.beginPath();
      pts.forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      if (closed) ctx.closePath();
    };
    const outline = e => outlines(e).forEach(p => { path(p.pts, p.closed); ctx.stroke(); });
    const isDragged = e => dragging && e === elements[selected];

    // omitidos y elemento arrastrado: solo borde punteado
    ctx.setLineDash([4, 3]); ctx.strokeStyle = css('--plate-muted'); ctx.lineWidth = 1;
    elements.forEach(e => { if (e.mode === 'skip' || isDragged(e)) outline(e); });
    // lo que no se omitió pero no deja ningún corte (más fino que la herramienta): contorno en color de aviso
    ctx.strokeStyle = css('--plate-warn'); ctx.lineWidth = 1.5;
    elements.forEach(e => { if (e.mode !== 'skip' && !isDragged(e) && e.paths && !e.paths.length) outline(e); });
    ctx.setLineDash([]); ctx.lineWidth = 1;

    // resultado: la placa ya tallada por el programa (simulación del material), en vez del trazo de cada figura
    const showStock = stock && !simulating && !dragging;
    if (showStock) ctx.drawImage(stock, X(0), Y(H), W * k, H * k);

    // relieve: la imagen en grises sobre la placa (más oscuro = más hondo); su zigzag sería una mancha a esta escala
    if (!showStock) elements.forEach(e => {
      if (e.type !== 'relief' || e.mode === 'skip') return;
      const r = e.relief;
      if (!r.img) {
        const c = document.createElement('canvas'); c.width = r.gw; c.height = r.gh;
        const id = c.getContext('2d').createImageData(r.gw, r.gh);
        const [pr, pg, pb] = [1, 3, 5].map(i => parseInt(css('--plate').slice(i, i + 2), 16)), [cr, cg, cb] = [1, 3, 5].map(i => parseInt(css('--cut').slice(i, i + 2), 16));
        for (let i = 0; i < r.gw * r.gh; i++) { const t = r.data[i]; id.data[4 * i] = pr + (cr - pr) * t; id.data[4 * i + 1] = pg + (cg - pg) * t; id.data[4 * i + 2] = pb + (cb - pb) * t; id.data[4 * i + 3] = 255; }
        c.getContext('2d').putImageData(id, 0, 0);
        r.img = c;
      }
      ctx.drawImage(r.img, X(r.x0), Y(r.y0 + r.h), r.w * k, r.h * k);
    });

    // grabado simulado: cada trayectoria con el ancho real de la línea
    ctx.strokeStyle = css('--cut'); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, toolWidth * k);
    if (simulating) {
      ctx.lineWidth = 1; ctx.strokeStyle = css('--plate-edge');
      elements.forEach(e => (e.paths || []).forEach(p => { path(p.pts, false); ctx.stroke(); }));
    } else if (!showStock) elements.forEach(e => {
      if (isDragged(e) || e.type === 'relief') return;
      ctx.lineWidth = Math.max(1, (e.tl ? e.tl.w : toolWidth) * k); // cada figura con el ancho a su profundidad (un recorte, el diámetro)
      (e.paths || []).forEach(p => {
        if (p.w != null) ctx.lineWidth = Math.max(1, p.w * k); // tallado en V: cada vuelta con su ancho
        path(p.pts, false); ctx.stroke();
      });
    });

    if (plan && showPath && !dragging && !simulating) {
      ctx.lineWidth = 1; ctx.strokeStyle = css('--plate-accent'); ctx.globalAlpha = 0.9;
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

    // renglón de la lista bajo el cursor: su figura con un borde de acento punteado
    if (hovered >= 0 && hovered !== selected && elements[hovered]) {
      ctx.strokeStyle = css('--plate-accent'); ctx.lineWidth = 2; ctx.setLineDash([5, 3]); outline(elements[hovered]); ctx.setLineDash([]);
    }
    if (selected >= 0 && elements[selected]) {
      const e = elements[selected];
      ctx.strokeStyle = css('--plate-accent'); ctx.lineWidth = 2; outline(e);
      if (e.type === 'region') {
        ctx.fillStyle = css('--plate-accent'); ctx.globalAlpha = 0.12; ctx.beginPath();
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
      if (e.copyOf != null) return; // las copias no llevan número: se eligen y cambian con el original
      const lbl = e.src === 'text' ? 'T' : String(i + 1);
      const w = ctx.measureText(lbl).width + 8;
      ctx.fillStyle = css(MODE_COLOR[e.mode].replace('--m-', '--pm-')); // la placa es clara en ambos temas
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx - w / 2, ty - 12, w, 15, 3); else ctx.rect(tx - w / 2, ty - 12, w, 15);
      ctx.fill();
      ctx.fillStyle = css('--plate-on'); ctx.fillText(lbl, tx - w / 2 + 4, ty - 1);
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
      if (e.src === 'text' || e.type === 'relief') {
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

  /** Escala actual: px por mm (k), desplazamiento y tamaño de la pieza, para dibujar capas encima. */
  const getView = () => view;

  const cssScale = () => (view.cssW && cv.clientWidth ? view.cssW / cv.clientWidth : 1);
  /**
   * Acerca o aleja dejando fijo el punto bajo el cursor (como la rueda en un CAD). Se vuelve a dibujar después.
   * @returns {boolean} si cambió
   */
  function zoomAt(mx, my, f) {
    const s = cssScale(), x = mx * s, y = my * s;
    const z = Math.min(50, Math.max(1, nav.z * f)), r = z / nav.z;
    if (Math.abs(r - 1) < 1e-9) return false;
    nav.z = z;
    if (z === 1) { nav.px = nav.py = 0; return true; }
    nav.px = x - (x - view.ox) * r - view.ox0;
    nav.py = y - (y - view.oy) * r - view.oy0;
    return true;
  }
  /** Desplaza la vista (px de pantalla); solo con zoom, la vista completa no se mueve. */
  function pan(dx, dy) {
    if (nav.z === 1) return false;
    const s = cssScale();
    nav.px += dx * s; nav.py += dy * s;
    return true;
  }
  /** Zoom para ajustar: la pieza completa. @returns {boolean} si cambió */
  function fit() { const was = nav.z !== 1; nav.z = 1; nav.px = nav.py = 0; return was; }
  const zoom = () => nav.z;

  return { draw, hit, toMM, getView, zoomAt, pan, fit, zoom };
}
