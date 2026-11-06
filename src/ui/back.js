// Atrás (botón del navegador o del ratón, gesto, Alt+←) cierra lo último que se abrió en vez de salir de la app:
// un diálogo, el menú, la ayuda, una herramienta de dibujo o la pestaña Código G. Cada capa abierta tiene una
// entrada en el historial; si se cierra de otro modo (✕, Esc, Listo), su entrada se quita para no dejar pasos fantasma.

/**
 * Qué cambiar en el historial para que refleje las capas abiertas.
 * @param {string[]} stack capas con entrada en el historial, la última arriba
 * @param {string[]} open capas abiertas ahora, en orden de prioridad
 * @returns {{stack:string[], push:string[], drop:number}} drop = entradas a quitar (se cerraron sin Atrás)
 */
export function reconcile(stack, open) {
  const kept = stack.filter(n => open.includes(n));
  const push = open.filter(n => !kept.includes(n));
  return { stack: kept.concat(push), push, drop: stack.length - kept.length };
}

/**
 * @param {{name:string, isOpen:()=>boolean, close:()=>void}[]} layers
 * @param {{guardExit?:boolean, onExitHint?:()=>void, win?:Window}} [o]
 *   guardExit: en la pantalla de inicio el primer Atrás no sale (en el navegador; la app de escritorio no tiene a dónde salir)
 */
export function createBack(layers, o = {}) {
  const win = o.win || window, h = win.history;
  let stack = [], skip = 0, armed = 0, queued = false, pendingAdd = null, rerun = false;
  const depth = () => stack.length + (o.guardExit ? 1 : 0);
  if (o.guardExit) h.pushState({ capa: 'inicio', n: 1 }, '');

  function sync() {
    queued = false;
    if (skip) { rerun = true; return; } // el historial todavía se está moviendo: se revisa al terminar
    const r = reconcile(stack, layers.filter(l => l.isOpen()).map(l => l.name));
    if (r.drop) { stack = r.stack.slice(0, r.stack.length - r.push.length); skip++; h.go(-r.drop); }
    // las nuevas se agregan cuando termina de quitar las cerradas (go es asíncrono)
    const add = () => r.push.forEach(n => { stack.push(n); h.pushState({ capa: n, n: depth() }, ''); });
    if (r.drop) pendingAdd = add; else add();
  }
  /** Llamar tras cualquier cambio de la interfaz; se agrupa en un solo paso por cuadro. */
  function schedule() { if (!queued) { queued = true; queueMicrotask(sync); } }

  win.addEventListener('popstate', ev => {
    if (skip) {
      skip--;
      if (skip) return;
      const a = pendingAdd; pendingAdd = null; if (a) a();
      if (rerun) { rerun = false; sync(); }
      return;
    }
    const n = ev.state && ev.state.n;
    if (n && n > depth()) { skip++; h.back(); return; } // Adelante: no reabre nada
    const top = stack.pop();
    if (top) { layers.find(l => l.name === top)?.close(); schedule(); return; }
    if (!o.guardExit) return;
    // en el inicio: el primer Atrás avisa, el segundo (antes de 2 s) sí sale
    if (Date.now() - armed < 2000) { h.back(); return; }
    armed = Date.now();
    h.pushState({ capa: 'inicio', n: 1 }, '');
    o.onExitHint?.();
  });
  return { schedule, sync };
}
