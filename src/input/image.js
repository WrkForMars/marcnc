// Imagen → píxeles al tamaño de trabajo (necesita un canvas, o sea la página) → vectorizado en trace.js, que corre en el
// worker para que la página no se congele mientras separa un objeto o vectoriza una imagen grande.
import { run } from '../work.js';
import { traceRGBA } from './trace.js';

/**
 * @typedef {{
 *   mode: import('./detect.js').DetectMode, thr?: number, invert?: boolean, clean?: number,
 *   how?: 'area'|'center',             // áreas con contorno, o línea central de cada trazo
 *   detail?: number,                   // píxeles del lado mayor con los que se trabaja
 *   crop?: {x:number, y:number, w:number, h:number}|null,  // recorte, en fracciones de la imagen (0–1)
 *   seeds?: {x:number, y:number, fg:boolean}[],  // modo 'object': toques en fracciones de la imagen (0–1)
 * }} TraceOptions
 */

/**
 * Recorta y escala la imagen al tamaño de trabajo, y pasa los toques a píxeles de ese recorte.
 * @param {HTMLImageElement} img @param {TraceOptions} o
 */
function prepare(img, o) {
  // 600 px en el lado mayor bastan para la ball mill y trazan en ~0.3 s; con una V-bit fina conviene más detalle
  const c0 = o.crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = c0.x * img.naturalWidth, sy = c0.y * img.naturalHeight, sw = c0.w * img.naturalWidth, sh = c0.h * img.naturalHeight;
  const k = Math.min(4, (o.detail || 600) / Math.max(sw, sh));
  const w = Math.max(8, Math.round(sw * k)), h = Math.max(8, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); // lo transparente cuenta como fondo
  x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const opts = { mode: o.mode, thr: o.thr, invert: o.invert, clean: o.clean, how: o.how };
  if (o.mode === 'object') {
    // toques de la imagen completa → píxeles del recorte; los que caen fuera no cuentan
    opts.seeds = (o.seeds || []).map(s => ({ x: (s.x * img.naturalWidth - sx) * k, y: (s.y * img.naturalHeight - sy) * k, fg: s.fg }))
      .filter(s => s.x >= 0 && s.y >= 0 && s.x < w && s.y < h);
    if (!opts.seeds.some(s => s.fg)) throw new Error('Toca el objeto en la imagen (dentro del recorte).');
  }
  return { rgba: x.getImageData(0, 0, w, h).data, w, h, opts };
}

/** Lo que devuelve trace.js, como lo usa el resto de la app: las figuras con la máscara y el resumen pegados. */
const wrap = (r, w, h) => Object.assign(r.shapes, { regionMode: r.regionMode, mask: { w, h, data: r.mask }, info: r.info });

/**
 * Vectoriza en segundo plano. Un trabajo nuevo cancela el anterior (su promesa se rechaza con `cancelled`).
 * @param {HTMLImageElement} img
 * @param {TraceOptions} o
 * @returns {Promise<import('./svg.js').RawShape[] & {regionMode:string, mask:{w:number, h:number, data:Uint8Array}, info:{inverted:boolean, ink:number, used:string}}>}
 */
export async function traceImage(img, o) {
  const { rgba, w, h, opts } = prepare(img, o);
  return wrap(await run('trace', { rgba, w, h, o: opts }, { lane: 'imagen' }), w, h);
}

