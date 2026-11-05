// Plantillas para empezar: piezas típicas de taller hechas con el croquis (se pueden editar y acotar) y textos.

/**
 * Contorno de un engrane recto (dientes trapezoidales), cerrado y antihorario.
 * @param {number} cx @param {number} cy centro @param {number} n dientes
 * @param {number} ro radio de la punta @param {number} ri radio del fondo
 */
export function gearPts(cx, cy, n, ro, ri) {
  const pts = [], step = (2 * Math.PI) / n;
  const P = (r, a) => [+(cx + r * Math.cos(a)).toFixed(3), +(cy + r * Math.sin(a)).toFixed(3)];
  for (let k = 0; k < n; k++) {
    const a = k * step;
    // fondo, flanco que sube, punta, flanco que baja (la punta es más angosta que la base del diente)
    pts.push(P(ri, a), P(ro, a + step * 0.18), P(ro, a + step * 0.38), P(ri, a + step * 0.56));
  }
  return pts;
}

/**
 * @type {Record<string, {name:string, W:number, H:number, entities:object[], modes:string[],
 *   texts:{text:string, h:number, x:number, y:number}[]}>}
 *   modes: modo de cada figura, en el mismo orden (la de afuera manda cuando una tiene huecos)
 */
export const TEMPLATES = {
  llavero: {
    name: 'Llavero', W: 60, H: 30,
    entities: [{ type: 'rect', x: 2, y: 2, w: 56, h: 26, rr: 6 }, { type: 'circle', cx: 9, cy: 15, r: 3 }],
    modes: ['contour', 'contour'],
    texts: [{ text: 'NOMBRE', h: 5, x: 35, y: 15 }], // a la derecha del aro, sin tocarlo; 5 mm para que no se empaste
  },
  placa: {
    name: 'Placa con nombre', W: 90, H: 50,
    entities: [{ type: 'rect', x: 3, y: 3, w: 84, h: 44, rr: 4 }],
    modes: ['contour'],
    texts: [{ text: 'NOMBRE APELLIDO', h: 5, x: 45, y: 29 }, { text: 'TECNM ITL', h: 5, x: 45, y: 16 }],
  },
  engrane: {
    name: 'Engrane', W: 60, H: 60,
    entities: [{ type: 'line', pts: gearPts(30, 30, 12, 26, 21.5), closed: true }, { type: 'circle', cx: 30, cy: 30, r: 5 }],
    modes: ['contour', 'contour'],
    texts: [],
  },
};
