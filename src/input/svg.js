// Lectura de un SVG del usuario. Usa el DOM solo para estilos calculados y transformaciones;
// la geometría la discretiza parsePathD (rápido y sin getPointAtLength, que es O(n) por punto).
import { parsePathD, shapeToD } from './svg-path.js';

/** Luminancia 0–1 de un color CSS calculado; −1 si es transparente. */
export function luminance(c) {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return 0;
  const p = m[1].split(',').map(parseFloat);
  if (p.length > 3 && p[3] === 0) return -1;
  return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
}

function sanitize(svg) {
  svg.querySelectorAll('script,foreignObject,image,iframe,a').forEach(n => n.remove());
  svg.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => {
    if (/^on/i.test(a.name) || (/href/i.test(a.name) && /^\s*javascript/i.test(a.value))) n.removeAttribute(a.name);
  }));
}

/**
 * @typedef {{kind:'fill', white:boolean, rule:'evenodd'|'nonzero', rings:[number,number][][]}
 *          |{kind:'stroke', group?:boolean, lines:{pts:[number,number][], closed:boolean}[]}} RawShape
 * `group`: todas las líneas forman una sola figura (la línea central de una pieza de la imagen).
 * Las coordenadas salen en "unidades de lienzo": las del viewBox × `native.unit`.
 */

/**
 * @param {string} text contenido del SVG
 * @param {HTMLElement} host contenedor oculto donde se monta temporalmente
 * @returns {RawShape[] & {native:{unit:number,h:number}}}
 */
export function parseSVG(text, host) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const src = doc.documentElement;
  if (!src || src.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('El archivo no es un SVG válido.');
  }
  sanitize(src);
  host.textContent = '';
  const svg = document.importNode(src, true);
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width')) || 1000, h = parseFloat(svg.getAttribute('height')) || 1000;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  const vb = svg.viewBox.baseVal;
  const unit = 1000 / Math.max(vb.width || 1, vb.height || 1);
  // tamaño exacto al viewBox para que la transformación no agregue márgenes
  svg.setAttribute('width', String((vb.width || 1) * unit));
  svg.setAttribute('height', String((vb.height || 1) * unit));
  svg.setAttribute('preserveAspectRatio', 'none');
  host.appendChild(svg);

  const shapes = [];
  shapes.native = { unit, h: vb.height || 1 };
  svg.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line').forEach(el => {
    if (el.closest('defs,clipPath,mask,symbol,pattern,marker')) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    const m = el.getCTM();
    if (!m) return;
    const sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
    const tag = el.tagName.toLowerCase();
    const fl = cs.fill, st = cs.stroke;
    const fillOn = fl && fl !== 'none' && luminance(fl) >= 0 && parseFloat(cs.fillOpacity || 1) > 0 && tag !== 'line' && tag !== 'polyline';
    const strokeOn = st && st !== 'none' && luminance(st) >= 0 && parseFloat(cs.strokeWidth || 1) > 0;
    if (!fillOn && !strokeOn) return;
    const subs = parsePathD(shapeToD(el), 1.2 / sc);
    const T = ([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    const lines = subs.map(s => ({ pts: s.pts.map(T), closed: s.closed }));
    if (fillOn) {
      shapes.push({
        kind: 'fill',
        white: luminance(fl) > 0.9, // las figuras blancas recortan a las de abajo
        rule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        rings: lines.filter(l => l.pts.length > 2).map(l => l.pts),
      });
    } else {
      shapes.push({ kind: 'stroke', lines });
    }
  });
  host.textContent = '';
  if (!shapes.some(s => s.kind === 'stroke' || !s.white)) throw new Error('No encontré figuras oscuras ni trazos en el SVG.');
  return shapes;
}
