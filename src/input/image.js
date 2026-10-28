// Imagen con fondo blanco → contornos de las zonas oscuras, vía ImageTracer.
import ImageTracer from 'imagetracerjs';

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

/** Pasa a blanco y negro en el lugar: más oscuro que `thr` (0–255) cuenta como dibujo. */
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
 * @param {HTMLImageElement} img
 * @param {number} thr umbral 0–255
 * @returns {import('./svg.js').RawShape[]}
 */
export function traceImage(img, thr) {
  // 600 px en el lado mayor es suficiente para grabado y mantiene el trazado por debajo de ~0.3 s
  const max = 600;
  const k = Math.min(4, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); // lo transparente cuenta como fondo
  x.drawImage(img, 0, 0, w, h);
  const d = binarize(x.getImageData(0, 0, w, h), thr);
  return [{ kind: 'fill', white: false, rule: 'evenodd', rings: tracedRings(d) }];
}
