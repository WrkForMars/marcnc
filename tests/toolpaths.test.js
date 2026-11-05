import { describe, expect, it } from 'vitest';
import { toolGeometry } from '../src/cam/tool.js';
import { toolpaths } from '../src/cam/toolpaths.js';
import { CL, S, area, offset, toC, union, treeToPaths } from '../src/geometry/clipper.js';
import { BALL_1_8, hole, regionEl, square } from './helpers.js';

const tl = toolGeometry(BALL_1_8); // línea de 1.11 mm

/** Área que barre la herramienta siguiendo los caminos (mm²). */
function sweptArea(paths, w) {
  const co = new CL.ClipperOffset(2, 0.01 * S);
  paths.forEach(p => co.AddPath(toC(p.pts), CL.JoinType.jtRound, p.closed ? CL.EndType.etClosedLine : CL.EndType.etOpenRound));
  const out = new CL.Paths();
  co.Execute(out, (w / 2) * S);
  return area(treeToPaths(union(out)));
}
/**
 * Área barrida que cae fuera de la región (sobrecorte), sin contar la holgura de diseño:
 * el vaciado se desplaza 0.98·r para entrar en ranuras del ancho exacto de la línea,
 * así que puede pasarse 0.02·r (≈ 0.011 mm con la ball mill de 1/8" a 0.1 mm).
 */
function overcut(paths, w, region) {
  const allowed = offset(region.map(toC), 0.02 * (w / 2) + 0.002);
  const co = new CL.ClipperOffset(2, 0.01 * S);
  paths.forEach(p => co.AddPath(toC(p.pts), CL.JoinType.jtRound, CL.EndType.etOpenRound));
  const swept = new CL.Paths();
  co.Execute(swept, (w / 2) * S);
  const c = new CL.Clipper();
  c.AddPaths(swept, CL.PolyType.ptSubject, true);
  c.AddPaths(allowed, CL.PolyType.ptClip, true);
  const out = new CL.Paths();
  c.Execute(CL.ClipType.ctDifference, out, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return area(out);
}

describe('relleno', () => {
  it('vacía un cuadrado de 10 mm casi por completo y sin salirse', () => {
    const e = regionEl(square(0, 0, 10));
    const { paths, warn } = toolpaths(e, tl);
    expect(warn).toBeNull();
    // el vaciado solo deja sin cortar las cuatro esquinas (radio de la herramienta)
    expect(sweptArea(paths, tl.w)).toBeGreaterThan(100 - 4 * tl.r * tl.r);
    expect(overcut(paths, tl.w, [square(0, 0, 10)])).toBeLessThan(0.01);
  });

  it('respeta los huecos', () => {
    const e = regionEl(square(0, 0, 20), [hole(7, 7, 6)]);
    const { paths } = toolpaths(e, tl);
    const region = [square(0, 0, 20), hole(7, 7, 6)];
    expect(overcut(paths, tl.w, region)).toBeLessThan(0.01);
  });

  it('avisa cuando un detalle es más fino que la línea', () => {
    const e = regionEl([[0, 0], [20, 0], [20, 0.6], [0, 0.6]]); // ranura de 0.6 mm < 1.11 mm
    expect(toolpaths(e, tl).warn).toMatch(/más finos que la herramienta/);
  });
});

describe('contorno e invertir', () => {
  it('contorno sigue la orilla exterior y la de cada hueco', () => {
    const e = regionEl(square(0, 0, 20), [hole(5, 5, 4), hole(12, 12, 4)], 'contour');
    expect(toolpaths(e, tl).paths).toHaveLength(3);
  });

  it('invertir graba la orilla exterior y vacía solo los huecos', () => {
    const e = regionEl(square(0, 0, 20), [hole(7, 7, 6)], 'invert');
    const { paths } = toolpaths(e, tl);
    const outer = paths[0].pts;
    expect(Math.min(...outer.map(p => p[0]))).toBeCloseTo(0, 6);
    // el resto de los caminos queda dentro del hueco
    paths.slice(1).flatMap(p => p.pts).forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(7); expect(x).toBeLessThanOrEqual(13);
      expect(y).toBeGreaterThanOrEqual(7); expect(y).toBeLessThanOrEqual(13);
    });
  });

  it('invertir sin huecos avisa', () => {
    expect(toolpaths(regionEl(square(0, 0, 10), [], 'invert'), tl).warn).toMatch(/no tiene huecos/);
  });

  it('omitir no genera caminos', () => {
    expect(toolpaths(regionEl(square(0, 0, 10), [], 'skip'), tl).paths).toHaveLength(0);
  });
});

describe('simplifyPaths', () => {
  it('quita vértices sin alejarse más de la tolerancia', async () => {
    const { simplifyPaths, fromC } = await import('../src/geometry/clipper.js');
    const circle = Array.from({ length: 2000 }, (_, k) => [10 * Math.cos(k / 2000 * 2 * Math.PI), 10 * Math.sin(k / 2000 * 2 * Math.PI)]);
    const [s] = simplifyPaths([toC(circle)], 0.005);
    expect(s.length).toBeLessThan(200);
    // cada cuerda de un círculo de 10 mm se aleja del arco como mucho la tolerancia
    const pts = fromC(s);
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const mid = Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      expect(10 - mid).toBeLessThan(0.0055);
    });
  });
});
