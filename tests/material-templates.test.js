import { describe, expect, it } from 'vitest';
import { feedRisks, suggestFeeds } from '../src/cam/material.js';
import { TEMPLATES, gearPts } from '../src/templates.js';
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
  it('el engrane es un contorno cerrado con sus dientes entre los dos radios', () => {
    const p = gearPts(0, 0, 12, 26, 21.5);
    expect(p).toHaveLength(48);
    p.forEach(([x, y]) => { const r = Math.hypot(x, y); expect(r).toBeGreaterThan(21.49); expect(r).toBeLessThan(26.01); });
  });
  it('cada plantilla cabe en su pieza y sus figuras de adentro quedan como huecos', () => {
    Object.values(TEMPLATES).forEach(t => {
      const ents = t.entities.map((e, i) => ({ ...e, id: i + 1 }));
      ents.forEach(e => { const b = entityBox(e); expect(b[0]).toBeGreaterThanOrEqual(0); expect(b[1]).toBeGreaterThanOrEqual(0); expect(b[2]).toBeLessThanOrEqual(t.W); expect(b[3]).toBeLessThanOrEqual(t.H); });
      expect(t.modes).toHaveLength(t.entities.length);
      t.texts.forEach(x => { expect(x.x).toBeLessThan(t.W); expect(x.y).toBeLessThan(t.H); });
    });
    const els = sketchElements(TEMPLATES.engrane.entities.map((e, i) => ({ ...e, id: i + 1 })));
    expect(els).toHaveLength(1);
    expect(els[0].parts[0].holes).toHaveLength(1);
  });
});
