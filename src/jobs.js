// Trabajos pesados que puede hacer el worker (o la página, si no hay worker). Funciones puras: datos entran, datos salen.
// Cada una devuelve { result, transfer }: transfer son los búferes que se mandan de regreso sin copiarlos.
import { traceRGBA } from './input/trace.js';
import { carveStock } from './cam/stock.js';

export const JOBS = {
  /** Imagen ya escalada → figuras, máscara y resumen. */
  trace: ({ rgba, w, h, o }) => {
    const r = traceRGBA(rgba, w, h, o);
    return { result: r, transfer: [r.mask.buffer] };
  },
  /** Programa → placa tallada (simulación del material). */
  stock: ({ text, o }) => {
    const r = carveStock(text, o);
    return { result: r, transfer: [r.z.buffer] };
  },
};
