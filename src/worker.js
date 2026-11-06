// Segundo hilo: hace los trabajos de jobs.js sin congelar la página. Recibe { id, job, args } y responde
// { id, result } o { id, error } con el mensaje en español que se muestra al usuario.
import { JOBS } from './jobs.js';

self.onmessage = ({ data: { id, job, args } }) => {
  try {
    const { result, transfer } = JOBS[job](args);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
