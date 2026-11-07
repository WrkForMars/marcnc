// Trabajos pesados que puede hacer el worker (o la página, si no hay worker). Funciones puras: datos entran, datos salen.
// Cada una devuelve { result, transfer }: transfer son los búferes que se mandan de regreso sin copiarlos.
import { traceRGBA } from './input/trace.js';
import { carveStock } from './cam/stock.js';
import { generateGcode } from './cam/gcode.js';
import { explainProgram } from './cam/explain.js';
import { buildTimeline } from './cam/simulate.js';

const FULL_MAX = 20000, SHOWN = 4000;

export const JOBS = {
  /** Imagen ya escalada → figuras, máscara y resumen. */
  trace: ({ rgba, w, h, o }) => {
    const r = traceRGBA(rgba, w, h, o);
    return { result: r, transfer: [r.mask.buffer] };
  },
  /** Plan → programa G y su explicación línea por línea. */
  // con un programa enorme solo regresan las primeras líneas explicadas (las que muestra el visor) y la duración: pasar
  // cientos de miles de explicaciones a la página la trabaría; la simulación pide las completas cuando se usa
  program: ({ plan, elements, o }) => {
    const g = generateGcode(plan, elements, o), ex = explainProgram(g.text), total = buildTimeline(ex).total;
    return { result: ex.length > FULL_MAX ? { g, ex: ex.slice(0, SHOWN), partial: true, total } : { g, ex, partial: false, total }, transfer: [] };
  },
  /** Programa → explicación completa (para simular un programa enorme). */
  explain: ({ text }) => ({ result: explainProgram(text), transfer: [] }),
  /** Programa → placa tallada (simulación del material). */
  stock: ({ text, o }) => {
    const r = carveStock(text, o);
    return { result: r, transfer: [r.z.buffer] };
  },
};
