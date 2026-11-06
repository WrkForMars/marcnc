import { describe, expect, it } from 'vitest';
import { createBack, reconcile } from '../src/ui/back.js';

/** Historial de mentiras: pushState corta lo de adelante; go() avisa con popstate un momento después, como el navegador. */
function fakeWindow() {
  const entries = [{ state: null }], ls = [];
  let i = 0, left = false;
  const fire = () => ls.forEach(f => f({ state: entries[i].state }));
  const history = {
    pushState(state) { entries.splice(i + 1); entries.push({ state }); i++; },
    go(k) { setTimeout(() => { if (i + k < 0) { left = true; return; } i = Math.min(entries.length - 1, i + k); fire(); }, 0); },
    back() { this.go(-1); },
  };
  return { history, addEventListener: (t, f) => ls.push(f), get length() { return i; }, get left() { return left; } };
}
const wait = () => new Promise(r => setTimeout(r, 5));

/** Capas simuladas: un diálogo y una herramienta, cada una con su bandera. */
function setup(o = {}) {
  const win = fakeWindow(), ui = { dlg: false, tool: false };
  const back = createBack([
    { name: 'herramienta', isOpen: () => ui.tool, close: () => { ui.tool = false; } },
    { name: 'dialogo', isOpen: () => ui.dlg, close: () => { ui.dlg = false; } },
  ], { win, ...o });
  return { win, ui, back };
}

describe('Atrás', () => {
  it('reconcile agrega lo nuevo arriba y cuenta lo que se cerró por otro lado', () => {
    expect(reconcile([], ['a'])).toEqual({ stack: ['a'], push: ['a'], drop: 0 });
    expect(reconcile(['a', 'b'], ['a'])).toEqual({ stack: ['a'], push: [], drop: 1 });
    expect(reconcile(['b'], ['a', 'b'])).toEqual({ stack: ['b', 'a'], push: ['a'], drop: 0 });
  });
  it('cierra la última capa abierta y luego la anterior', async () => {
    const { win, ui, back } = setup();
    ui.tool = true; back.sync(); ui.dlg = true; back.sync();
    expect(win.length).toBe(2);
    win.history.back(); await wait();
    expect(ui).toEqual({ tool: true, dlg: false });
    win.history.back(); await wait();
    expect(ui).toEqual({ tool: false, dlg: false });
    expect(win.length).toBe(0);
  });
  it('si la capa se cierra con ✕ o Esc, su entrada se quita y Atrás no la busca', async () => {
    const { win, ui, back } = setup();
    ui.tool = true; back.sync(); ui.dlg = true; back.sync();
    ui.dlg = false; back.sync(); await wait();
    expect(win.length).toBe(1);
    win.history.back(); await wait();
    expect(ui.tool).toBe(false);
  });
  it('si se cierra la de abajo, Atrás cierra la que quedó arriba', async () => {
    const { win, ui, back } = setup();
    ui.tool = true; back.sync(); ui.dlg = true; back.sync();
    ui.tool = false; back.sync(); await wait();
    expect(win.length).toBe(1);
    win.history.back(); await wait();
    expect(ui.dlg).toBe(false);
  });
  it('cambios seguidos mientras el historial se mueve no duplican entradas', async () => {
    const { win, ui, back } = setup();
    ui.dlg = true; back.sync();
    ui.dlg = false; back.sync(); ui.tool = true; back.sync(); ui.dlg = true; back.sync(); await wait();
    expect(win.length).toBe(2);
    win.history.back(); await wait(); win.history.back(); await wait();
    expect(ui).toEqual({ tool: false, dlg: false });
  });
  it('cerrar una y abrir otra en el mismo paso deja una sola entrada', async () => {
    const { win, ui, back } = setup();
    ui.dlg = true; back.sync();
    ui.dlg = false; ui.tool = true; back.sync(); await wait();
    expect(win.length).toBe(1);
    win.history.back(); await wait();
    expect(ui.tool).toBe(false);
  });
  it('en el inicio, el primer Atrás avisa y el segundo sale', async () => {
    let hints = 0;
    const { win } = setup({ guardExit: true, onExitHint: () => hints++ });
    win.history.back(); await wait();
    expect(hints).toBe(1); expect(win.left).toBe(false);
    win.history.back(); await wait(); // vuelve a la entrada de antes de la app
    win.history.back(); await wait();
    expect(win.left).toBe(true);
  });
});
