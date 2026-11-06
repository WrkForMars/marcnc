// Vectorizado puro (sin DOM): píxeles → qué es dibujo (detect.js) u objeto (segment.js) → contornos con ImageTracer,
// o línea central de cada trazo. Corre en el worker (worker.js) o, si no hay, en la página.
import ImageTracer from 'imagetracerjs';
import { centerlines } from './centerline.js';
import { detectInk, maskToRGBA, clean } from './detect.js';
import { segmentObject } from './segment.js';

const TRACE_OPTS = {
  numberofcolors: 2, colorsampling: 0,
  pal: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }],
  ltres: 0.8, qtres: 0.8, pathomit: 8, linefilter: true, blurradius: 0,
};

/**
 * Lee los datos del trazado directamente (sin generar SVG ni tocar el DOM).
 * @param {ImageData} imgd imagen ya binarizada (negro = dibujo)
 * @returns {[number,number][][]} anillos en píxeles (contornos y huecos mezclados; usar regla par-impar)
 */
export function tracedRings(imgd) {
  const td = ImageTracer.imagedataToTracedata(imgd, TRACE_OPTS);
  const li = td.palette.findIndex(p => p.r < 128);
  const rings = [];
  (td.layers[li] || []).forEach(p => {
    const pts = [];
    p.segments.forEach((s, k) => {
      if (k === 0) pts.push([s.x1, s.y1]);
      if (s.type === 'Q') {
        for (let j = 1; j <= 3; j++) {
          const t = j / 3, u = 1 - t;
          pts.push([u * u * s.x1 + 2 * u * t * s.x2 + t * t * s.x3, u * u * s.y1 + 2 * u * t * s.y2 + t * t * s.y3]);
        }
      } else {
        pts.push([s.x2, s.y2]);
      }
    });
    if (pts.length > 2) rings.push(pts);
  });
  return rings;
}

/** Pasa a blanco y negro en el lugar: más oscuro que `thr` (0–255) cuenta como dibujo (lo usan los textos rellenos). */
export function binarize(imgd, thr) {
  const a = imgd.data;
  for (let i = 0; i < a.length; i += 4) {
    const v = (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) < thr ? 0 : 255;
    a[i] = a[i + 1] = a[i + 2] = v;
    a[i + 3] = 255;
  }
  return imgd;
}

/**
 * @param {Uint8ClampedArray} rgba @param {number} w @param {number} h
 * @param {{mode:string, thr?:number, invert?:boolean, clean?:number, how?:'area'|'center', seeds?:{x:number, y:number, fg:boolean}[]}} o
 *   seeds: en píxeles de esta imagen (modo 'object')
 * @returns {{shapes:import('./svg.js').RawShape[], regionMode:string, mask:Uint8Array, info:{inverted:boolean, ink:number, used:string}}}
 */
export function traceRGBA(rgba, w, h, o) {
  let det;
  if (o.mode === 'object') {
    const mask = clean(segmentObject(rgba, w, h, { seeds: o.seeds || [] }), w, h, o.clean || 0);
    det = { mask, inverted: false, ink: mask.reduce((a, v) => a + v, 0) / (w * h), used: 'object' };
  } else det = detectInk(rgba, w, h, o);
  if (!det.ink) throw new Error(o.mode === 'object' ? 'No pude separar el objeto: toca más partes de él.' : 'No encontré dibujo en la imagen. Prueba otro modo de detección o márcala como invertida.');
  let shapes;
  if (o.how === 'center') {
    const groups = centerlines(det.mask, w, h);
    if (!groups.length) throw new Error('No encontré trazos en la imagen. Prueba otro modo de detección.');
    shapes = groups.map(g => ({ kind: 'stroke', group: true, lines: g.lines }));
  } else {
    shapes = [{ kind: 'fill', white: false, rule: 'evenodd', rings: tracedRings(maskToRGBA(det.mask, w, h)) }];
  }
  return { shapes, regionMode: det.used === 'object' ? 'contour' : 'fill', mask: det.mask, info: { inverted: det.inverted, ink: det.ink, used: det.used } };
}
