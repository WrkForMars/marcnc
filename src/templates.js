// Plantillas para empezar: piezas típicas de taller hechas con el croquis (se pueden editar y acotar) y textos.
// Cada una enseña algo: el llavero, un hueco; la placa, marco y línea; el engrane, dientes de evolvente y una
// matriz circular de huecos; el posavasos, un patrón; la regla, trazos sueltos en modo Línea.

const RAD = Math.PI / 180;
const r3 = v => +v.toFixed(3);
const inv = a => Math.tan(a) - a; // función evolvente

/**
 * Contorno de un engrane recto con dientes de evolvente (ángulo de presión 20°), cerrado y antihorario.
 * @param {number} cx @param {number} cy centro @param {number} z dientes @param {number} m módulo (mm)
 * @returns {[number,number][]} puntos; radio de punta m·(z/2 + 1), de fondo m·(z/2 − 1.25)
 */
export function gearPts(cx, cy, z, m) {
  const rp = m * z / 2, rb = rp * Math.cos(20 * RAD), ra = rp + m, rf = Math.max(0.5 * rp, rp - 1.25 * m);
  const half = Math.PI / (2 * z) + inv(20 * RAD); // medio grueso del diente en la base, en ángulo
  const at = r => (r <= rb ? half : half - inv(Math.acos(rb / r))); // medio grueso a radio r
  const P = (r, a) => [r3(cx + r * Math.cos(a)), r3(cy + r * Math.sin(a))];
  const pitch = 2 * Math.PI / z, N = 6, pts = [];
  for (let k = 0; k < z; k++) {
    const c = k * pitch; // eje del diente
    // flanco derecho: del fondo (radial hasta la circunferencia base) a la punta por la evolvente
    const r0 = Math.max(rf, Math.min(rb, ra));
    pts.push(P(rf, c - at(r0)));
    for (let j = 0; j <= N; j++) { const r = r0 + (ra - r0) * j / N; pts.push(P(r, c - at(r))); }
    for (let j = N; j >= 0; j--) { const r = r0 + (ra - r0) * j / N; pts.push(P(r, c + at(r))); }
    pts.push(P(rf, c + at(r0)));
    // fondo entre este diente y el siguiente
    const a0 = c + at(r0), a1 = c + pitch - at(r0);
    for (let j = 1; j < 3; j++) pts.push(P(rf, a0 + (a1 - a0) * j / 3));
  }
  return pts;
}

/** Barreno redondo con cuñero arriba (para que el engrane no gire en la flecha), cerrado. */
export function keyedBore(cx, cy, r, keyW, keyH) {
  const h = Math.asin(keyW / 2 / r), pts = [];
  // del lado izquierdo del cuñero, alrededor del círculo, hasta el lado derecho; luego sube y cruza el cuñero
  for (let j = 0; j <= 24; j++) { const a = Math.PI / 2 + h + (2 * Math.PI - 2 * h) * j / 24; pts.push([r3(cx + r * Math.cos(a)), r3(cy + r * Math.sin(a))]); }
  pts.push([r3(cx + keyW / 2), r3(cy + r + keyH)], [r3(cx - keyW / 2), r3(cy + r + keyH)]);
  return pts;
}

/** Círculos iguales repartidos en una circunferencia (como una matriz circular). */
const ring = (cx, cy, R, n, r, a0 = 90) => Array.from({ length: n }, (_, k) => {
  const a = (a0 + 360 * k / n) * RAD;
  return { type: 'circle', cx: r3(cx + R * Math.cos(a)), cy: r3(cy + R * Math.sin(a)), r };
});

/** Regla de 10 cm: marca cada 5 mm, más larga cada centímetro, y el número del centímetro. */
function ruler(x0, top) {
  const ents = [], texts = [];
  for (let mm = 0; mm <= 100; mm += 5) {
    const long = mm % 10 === 0;
    ents.push({ type: 'line', pts: [[x0 + mm, top], [x0 + mm, top - (long ? 8 : 5)]], closed: false });
    if (long) texts.push({ text: String(mm / 10), h: 5, x: x0 + mm, y: top - 15 });
  }
  return { ents, texts };
}
const R = ruler(7, 26);

/**
 * @type {Record<string, {name:string, W:number, H:number, entities:object[], modes:string[], tip?:string,
 *   texts:{text:string, h:number, x:number, y:number}[]}>}
 *   modes: modo de cada figura, en el mismo orden (la de afuera manda cuando una tiene huecos)
 */
export const TEMPLATES = {
  llavero: {
    name: 'Llavero', W: 60, H: 30,
    entities: [{ type: 'rect', x: 2, y: 2, w: 56, h: 26, rr: 8 }, { type: 'circle', cx: 10, cy: 15, r: 3.5 }],
    modes: ['cut', 'cut'], // sale recortado, con el aro hueco
    texts: [{ text: 'NOMBRE', h: 5, x: 36, y: 15 }], // a la derecha del aro, sin tocarlo
  },
  placa: {
    name: 'Placa con nombre', W: 90, H: 50,
    entities: [
      { type: 'rect', x: 2, y: 2, w: 86, h: 46, rr: 5 }, { type: 'rect', x: 5, y: 5, w: 80, h: 40, rr: 3 }, // marco doble
      { type: 'line', pts: [[18, 23], [72, 23]], closed: false }, // raya entre el nombre y la escuela
    ],
    modes: ['contour', 'contour', 'line'],
    texts: [{ text: 'NOMBRE APELLIDO', h: 5, x: 45, y: 31 }, { text: 'TECNM ITL', h: 5, x: 45, y: 14 }],
  },
  engrane: {
    name: 'Engrane', W: 68, H: 68,
    entities: [
      { type: 'line', pts: gearPts(34, 34, 12, 4.5), closed: true },
      { type: 'line', pts: keyedBore(34, 34, 5, 3, 1.5), closed: true },
      ...ring(34, 34, 13, 4, 3.2, 45), // aligerado: cuatro huecos en matriz circular
    ],
    modes: ['cut', 'cut', 'cut', 'cut', 'cut', 'cut'], // sale recortado, con barreno y aligerados huecos
    texts: [],
  },
  prueba: {
    // para probar la máquina del taller en un retazo: cada cosa se mide y se anota en el registro de prueba
    name: 'Prueba de máquina', W: 70, H: 40,
    tip: 'Graba con la ball mill y agrega una fresa plana en Parámetros → Otras herramientas para recortar y barrenar. Al exportar, la Hoja de entrega trae el registro de prueba.',
    entities: [
      { type: 'rect', x: 2, y: 2, w: 66, h: 36, rr: 3 }, // se recorta: medir que salga de 66 × 36
      { type: 'circle', cx: 12, cy: 12, r: 1.6 }, // del tamaño de una fresa de 1/8": se barrena (G81)
      { type: 'circle', cx: 12, cy: 28, r: 4 }, // de 8 mm: se recorta por dentro (o en espiral si es un barreno)
      { type: 'line', pts: [[24, 12], [54, 12]], closed: false }, // raya de 30 mm: medir su ancho y su largo
    ],
    modes: ['cut', 'cut', 'cut', 'line'],
    texts: [{ text: 'PRUEBA', h: 5, x: 40, y: 27 }],
  },
  posavasos: {
    name: 'Posavasos', W: 90, H: 90,
    entities: [
      { type: 'circle', cx: 45, cy: 45, r: 43 }, { type: 'circle', cx: 45, cy: 45, r: 36 },
      ...ring(45, 45, 39.5, 24, 1.4), // cenefa de puntos entre los dos círculos
    ],
    modes: ['contour', 'contour', ...Array(24).fill('contour')],
    texts: [{ text: 'TALLER', h: 10, x: 45, y: 45 }],
  },
  regla: {
    name: 'Regla de 10 cm', W: 114, H: 30,
    entities: [{ type: 'rect', x: 2, y: 2, w: 110, h: 26, rr: 3 }, ...R.ents],
    modes: ['cut', ...R.ents.map(() => 'line')], // marcas grabadas, regla recortada
    texts: R.texts,
  },
};
