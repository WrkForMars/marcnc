import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOBS } from '../src/jobs.js';

/** Imagen chica: un cuadro oscuro sobre blanco. */
function img(w = 40, h = 30) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 30; x++) d.fill(20, 4 * (y * w + x), 4 * (y * w + x) + 3);
  return { rgba: d, w, h, o: { mode: 'auto', how: 'area' } };
}

/** Worker de mentiras: hace el trabajo de jobs.js un momento después, o falla al cargar si `broken`. */
function fakeWorker({ broken = false } = {}) {
  const made = [];
  class W {
    constructor() { this.dead = false; made.push(this); }
    postMessage({ id, job, args }) {
      setTimeout(() => {
        if (this.dead) return;
        if (broken) { this.onerror?.({ preventDefault() {} }); return; }
        try { this.onmessage({ data: { id, result: JOBS[job](args).result } }); } catch (e) { this.onmessage({ data: { id, error: e.message } }); }
      }, 5);
    }
    terminate() { this.dead = true; }
  }
  return { W, made };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('trabajos en segundo plano', () => {
  it('sin Worker (node, equipo viejo) el trabajo se hace en la página', async () => {
    const { run } = await import('../src/work.js');
    const r = await run('trace', img());
    expect(r.info.ink).toBeGreaterThan(0.1);
    expect(r.shapes[0].rings.length).toBeGreaterThan(0);
  });
  it('con Worker devuelve lo mismo y pasa el error con su mensaje', async () => {
    const { W } = fakeWorker(); vi.stubGlobal('Worker', W);
    const { run } = await import('../src/work.js');
    expect((await run('trace', img())).info.ink).toBeCloseTo(JOBS.trace(img()).result.info.ink, 9);
    const blank = img(); blank.rgba.fill(255);
    await expect(run('trace', blank)).rejects.toThrow(/No encontré dibujo/);
  });
  it('un trabajo nuevo en el mismo carril cancela el anterior y detiene su cálculo', async () => {
    const { W, made } = fakeWorker(); vi.stubGlobal('Worker', W);
    const { run } = await import('../src/work.js');
    const a = run('trace', img(), { lane: 'imagen' });
    const b = run('trace', img(), { lane: 'imagen' });
    await expect(a).rejects.toMatchObject({ cancelled: true });
    expect((await b).info.ink).toBeGreaterThan(0);
    expect(made[0].dead).toBe(true); expect(made).toHaveLength(2);
  });
  it('si el worker no carga, lo pendiente se hace en la página', async () => {
    const { W } = fakeWorker({ broken: true }); vi.stubGlobal('Worker', W);
    const { run } = await import('../src/work.js');
    expect((await run('trace', img())).info.ink).toBeGreaterThan(0);
    expect((await run('trace', img())).info.ink).toBeGreaterThan(0); // y los siguientes ya no lo intentan
  });
});

describe('programa en segundo plano', () => {
  it('escribe el programa, lo explica y da la duración; uno enorme regresa solo sus primeras líneas explicadas', async () => {
    const { computePlan } = await import('../src/cam/plan.js');
    const { toolGeometry } = await import('../src/cam/tool.js');
    const { TAREA, regionEl, square } = await import('./helpers.js');
    const els = [regionEl(square(10, 10, 20), [], 'contour')];
    const small = await computePlan(els, toolGeometry({ toolType: 'ball', dia: 3.175, depth: 0.1 }), { tol: 0.05 });
    const r = JOBS.program({ plan: small, elements: els, o: TAREA }).result;
    expect(r.partial).toBe(false); expect(r.ex.length).toBe(r.g.lines); expect(r.total).toBeGreaterThan(0);
    // 5000 pasadas de un contorno: más de 20 000 líneas
    const deep = await computePlan(els, toolGeometry({ toolType: 'flat', dia: 3.175, depth: 50, stepdown: 0.01 }), { tol: 0.05 });
    const big = JOBS.program({ plan: deep, elements: els, o: TAREA }).result;
    expect(big.g.lines).toBeGreaterThan(20000);
    expect(big.partial).toBe(true); expect(big.ex).toHaveLength(4000);
    expect(JOBS.explain({ text: big.g.text }).result).toHaveLength(big.g.lines);
  }, 60000);
});
