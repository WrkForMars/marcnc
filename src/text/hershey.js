// Texto de una sola línea con fuentes Hershey (trazos, no contornos): ideal para grabar.
// Unidades de la fuente: mayúscula de −12 a 9 (21 unidades), Y hacia abajo.
import HERSHEY from './hershey-data.json';

export const FONTS = { futural: 'Sencilla', scripts: 'Cursiva' };

// Las fuentes Hershey solo traen ASCII: los acentos se componen sobre la letra base.
const ACC = {
  'á': ['a', 'acute'], 'é': ['e', 'acute'], 'í': ['i', 'acute'], 'ó': ['o', 'acute'], 'ú': ['u', 'acute'],
  'Á': ['A', 'acute'], 'É': ['E', 'acute'], 'Í': ['I', 'acute'], 'Ó': ['O', 'acute'], 'Ú': ['U', 'acute'],
  'ñ': ['n', 'tilde'], 'Ñ': ['N', 'tilde'], 'ü': ['u', 'dia'], 'Ü': ['U', 'dia'],
  '¿': ['?', 'inv'], '¡': ['!', 'inv'], '°': ['o', 'deg'],
};

/** @returns {[number, [number,number][][]]} [avance, trazos] */
export function glyph(font, ch) {
  const F = HERSHEY[font];
  if (F[ch]) return F[ch];
  const a = ACC[ch];
  if (!a) return F['?'];
  let [w, st] = F[a[0]];
  st = st.map(s => s.map(p => p.slice()));
  if (a[1] === 'inv') return [w, st.map(s => s.map(([x, y]) => [w - x, -3 - y]))]; // girado 180°
  if (a[1] === 'deg') return [10, [[[2, -12], [2, -9], [5, -8], [8, -9], [8, -12], [5, -13], [2, -12]]]];
  if (a[0] === 'i') st = st.filter(s => Math.min(...s.map(p => p[1])) > -8); // quitar el punto de la i
  const ys = st.flat().map(p => p[1]), xs = st.flat().map(p => p[0]);
  const top = Math.min(...ys), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  if (a[1] === 'acute') st.push([[cx - 1.5, top - 3], [cx + 2, top - 7]]);
  if (a[1] === 'tilde') st.push([[cx - 4, top - 3], [cx - 2, top - 5], [cx + 2, top - 3], [cx + 4, top - 5]]);
  if (a[1] === 'dia') { st.push([[cx - 3, top - 3], [cx - 3, top - 4]]); st.push([[cx + 3, top - 3], [cx + 3, top - 4]]); }
  return [w, st];
}

/**
 * Trazos del texto en mm, centrados en (0, 0) (centro horizontal y centro de la altura de mayúscula), Y hacia arriba.
 * @param {{text:string, font:string, h:number, sp?:number}} t h = altura de mayúscula en mm, sp = espaciado extra en %
 * @returns {{pts:[number,number][], closed:false}[]}
 */
export function hersheyText(t) {
  const sp = (t.sp || 0) / 100;
  let x = 0;
  const strokes = [];
  for (const ch of t.text) {
    const [w, st] = glyph(t.font, ch);
    st.forEach(s => strokes.push(s.map(([gx, gy]) => [gx + x, gy])));
    x += w * (1 + sp);
  }
  const s = t.h / 21, cx = x / 2;
  return strokes.map(st => ({ pts: st.map(([gx, gy]) => [(gx - cx) * s, -(gy + 1.5) * s]), closed: false }));
}
