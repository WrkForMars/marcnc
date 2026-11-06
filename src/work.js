// Manda los trabajos pesados (jobs.js) al worker para que la página siga respondiendo: zoom, botones y la vista previa
// se mueven mientras se separa un objeto o se vectoriza una imagen. Si no se puede crear el worker (un equipo
// muy viejo, o las pruebas en node), el trabajo se hace aquí mismo, como antes.
import { JOBS } from './jobs.js';

let worker = null, failed = false, seq = 0;
const pending = new Map(); // id → { resolve, reject, lane }

/** Error de un trabajo que se canceló porque llegó uno más nuevo: quien lo pidió solo lo ignora. */
export class Cancelled extends Error { constructor() { super('cancelado'); this.cancelled = true; } }

function spawn() {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch { failed = true; return null; }
  worker.onmessage = ({ data: { id, result, error } }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error !== undefined) p.reject(new Error(error)); else p.resolve(result);
  };
  // si el worker no carga (o se cae), lo pendiente se hace en la página
  worker.onerror = ev => {
    ev.preventDefault?.();
    failed = true; worker.terminate(); worker = null;
    const all = [...pending.values()]; pending.clear();
    all.forEach(p => runHere(p.job, p.args).then(p.resolve, p.reject));
  };
  return worker;
}

/** Hace el trabajo en la página, cediendo un instante antes para que se pinte el aviso de "trabajando". */
async function runHere(job, args) {
  await new Promise(r => setTimeout(r, 0));
  return JOBS[job](args).result;
}

/**
 * @param {keyof JOBS} job
 * @param {object} args
 * @param {{lane?:string}} [o] lane: un trabajo nuevo en el mismo carril cancela el que sigue en curso
 *   (los datos se copian, no se transfieren: si el worker falla, la página los vuelve a usar)
 * @returns {Promise<any>}
 */
export function run(job, args, o = {}) {
  if (o.lane && [...pending.values()].some(p => p.lane === o.lane)) {
    // detener el cálculo viejo de verdad (no solo ignorarlo): se cierra el worker y se abre otro
    worker?.terminate(); worker = null;
    const all = [...pending.values()]; pending.clear();
    all.forEach(p => p.reject(new Cancelled()));
  }
  const w = spawn();
  if (!w) return runHere(job, args);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, lane: o.lane, job, args });
    w.postMessage({ id, job, args });
  });
}
