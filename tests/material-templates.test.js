import { describe, expect, it } from 'vitest';
import { feedRisks, suggestFeeds } from '../src/cam/material.js';
import { TEMPLATES, gearPts, keyedBore } from '../src/templates.js';
import { sketchElements, entityBox } from '../src/sketch/geometry.js';

describe('perfiles de material', () => {
  it('sugiere avances con la carga de viruta y el husillo de la máquina', () => {
    expect(suggestFeeds('aluminio', { rpm: 2200, dia: 3.175 })).toEqual({ fxy: 55, fz: 20, stepdown: 0.2 });
    expect(suggestFeeds('mdf', { rpm: 2200, dia: 3.175 })).toEqual({ fxy: 220, fz: 75, stepdown: 0.95 });
    expect(suggestFeeds('nada', { rpm: 2200, dia: 3.175 })).toBeNull();
  });
  it('la tarea de referencia (F130, F60, 0.1 mm) no da avisos en aluminio', () => {
    expect(feedRisks('aluminio', { rpm: 2200, dia: 3.175, fxy: 130, fz: 60, stepdown: 0.2, depth: 0.1 })).toEqual([]);
  });
  it('avisa de avances muy altos, Z mayor que X-Y, pasadas profundas y acrílico que se derrite', () => {
    const r = feedRisks('aluminio', { rpm: 2200, dia: 3.175, fxy: 600, fz: 700, stepdown: 2, depth: 2 });
    expect(r).toHaveLength(3);
    expect(r[0]).toMatch(/alto para aluminio/);
    expect(r[1]).toMatch(/mayor que en X-Y/);
    expect(r[2]).toMatch(/por pasada/);
    expect(feedRisks('acrilico', { rpm: 12000, dia: 3.175, fxy: 100, fz: 50, stepdown: 0.3, depth: 0.3 })[0]).toMatch(/derretir/);
    expect(feedRisks('', { rpm: 2200, dia: 3.175, fxy: 9999, fz: 9999, stepdown: 9, depth: 9 })).toEqual([]);
  });
});

describe('plantillas', () => {
  it('el engrane tiene dientes de evolvente entre el fondo y la punta, simétricos', () => {
    const m = 4.5, z = 12, p = gearPts(0, 0, z, m);
    const rs = p.map(([x, y]) => Math.hypot(x, y));
    expect(Math.min(...rs)).toBeCloseTo(m * (z / 2 - 1.25), 2);
    expect(Math.max(...rs)).toBeCloseTo(m * (z / 2 + 1), 2);
    // el diente 0 es simétrico respecto al eje X: cada punto tiene su reflejo
    const tooth = p.slice(0, 16);
    tooth.forEach(([x, y]) => expect(tooth.some(([u, v]) => Math.abs(u - x) < 2e-3 && Math.abs(v + y) < 2e-3)).toBe(true));
    // el grueso del diente en el círculo primitivo es medio paso (π·m/2)
    const rp = m * z / 2, flank = tooth.slice(1, 8);
    let ang = 0;
    for (let k = 1; k < flank.length; k++) {
      const [a, b] = [flank[k - 1], flank[k]], ra = Math.hypot(...a), rb = Math.hypot(...b);
      if (ra <= rp && rb >= rp) { const t = (rp - ra) / (rb - ra); ang = Math.abs(Math.atan2(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t)); }
    }
    expect(2 * ang * rp).toBeCloseTo(Math.PI * m / 2, 1);
  });
  it('el barreno con cuñero es un perfil cerrado del radio y el cuñero pedidos', () => {
    const p = keyedBore(0, 0, 5, 3, 1.5);
    expect(Math.max(...p.map(q => q[1]))).toBeCloseTo(6.5, 6);
    expect(Math.min(...p.map(q => q[1]))).toBeCloseTo(-5, 3);
    p.filter(q => q[1] <= 4.7).forEach(([x, y]) => expect(Math.hypot(x, y)).toBeCloseTo(5, 2));
  });
  it('cada plantilla cabe en su pieza y sus figuras de adentro quedan como huecos', () => {
    Object.values(TEMPLATES).forEach(t => {
      const ents = t.entities.map((e, i) => ({ ...e, id: i + 1 }));
      // grabado: medio ancho de la línea de la ball mill de 1/8" a 0.1 mm (0.56 mm) todavía adentro;
      // recortado: la herramienta pasa por fuera, a medio diámetro (1.59 mm)
      ents.forEach((e, k) => {
        const m = t.modes[k] === 'cut' ? 3.175 / 2 : 0.56, b = entityBox(e);
        expect(b[0]).toBeGreaterThanOrEqual(m); expect(b[1]).toBeGreaterThanOrEqual(m); expect(b[2]).toBeLessThanOrEqual(t.W - m); expect(b[3]).toBeLessThanOrEqual(t.H - m);
      });
      expect(t.modes).toHaveLength(t.entities.length);
      t.texts.forEach(x => { expect(x.x).toBeLessThan(t.W); expect(x.y).toBeLessThan(t.H); });
    });
    const els = sketchElements(TEMPLATES.engrane.entities.map((e, i) => ({ ...e, id: i + 1 })));
    expect(els).toHaveLength(1);
    expect(els[0].parts[0].holes).toHaveLength(5); // barreno y cuatro aligerados
  });
});
