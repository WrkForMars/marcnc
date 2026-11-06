import { describe, expect, it } from 'vitest';
import { duration, inchName, jobRisks, setupSheet } from '../src/cam/checks.js';
import { toolGeometry } from '../src/cam/tool.js';

const P = { rpm: 2200, fz: 60, fxy: 130, toolNum: 3, W: 90, H: 50, dialect: 'fanuc' };
const G = { passes: 1, mins: 30, lines: 717 };
const ball = toolGeometry({ toolType: 'ball', dia: 3.175, depth: 0.1 });

describe('revisión antes de cortar', () => {
  it('la tarea de referencia no tiene avisos', () => {
    expect(jobRisks(P, ball, G)).toEqual([]);
  });
  it('avisa el husillo parado, Z más rápido que X-Y, demasiada profundidad, pasadas, horas y líneas', () => {
    expect(jobRisks({ ...P, rpm: 0 }, ball, G)[0]).toMatch(/S0/);
    expect(jobRisks({ ...P, fz: 200 }, ball, G)[0]).toMatch(/F200/);
    expect(jobRisks({ ...P, fz: 200 }, ball, G, { material: true })).toEqual([]); // el perfil de material ya lo dice
    expect(jobRisks(P, toolGeometry({ toolType: 'ball', dia: 3.175, depth: 25 }), G)[0]).toMatch(/filo/);
    expect(jobRisks(P, ball, { ...G, passes: 1000 })[0]).toMatch(/1000 pasadas/);
    expect(jobRisks(P, ball, { ...G, mins: 35764 })[0]).toMatch(/596 h 4 min/);
    expect(jobRisks(P, ball, { ...G, lines: 273111 })[0]).toMatch(/273,111 líneas/);
  });
  it('recortar con ball mill o V-bit avisa; con fresa plana no', () => {
    expect(jobRisks(P, ball, G, { cut: true })[0]).toMatch(/fresa plana/);
    expect(jobRisks(P, toolGeometry({ toolType: 'flat', dia: 3.175, depth: 3 }), G, { cut: true })).toEqual([]);
  });
  it('la ficha dice hasta dónde atraviesa el recorte y cuántos puentes quedan', () => {
    const s = setupSheet(P, ball, { ...G, tabs: 4 }, { depth: 3.2 });
    expect(s.find(r => r.k === 'Recorte').v).toMatch(/atraviesa 3\.2 mm con 4 puentes/);
  });
  it('el V-bit avisa cuando entra más que su punta', () => {
    const v = { ...P, vAngle: 90, vTip: 0 };
    expect(jobRisks(v, toolGeometry({ toolType: 'v', dia: 6, depth: 2, vAngle: 90 }), G)).toEqual([]);
    expect(jobRisks(v, toolGeometry({ toolType: 'v', dia: 6, depth: 4, vAngle: 90 }), G)[0]).toMatch(/punta \(3 mm\)/);
  });
  it('la ficha dice herramienta (con su medida en pulgadas), ceros, corte, husillo y duración', () => {
    const s = setupSheet({ ...P, materialName: 'Acrílico' }, ball, G);
    expect(s.map(r => r.k)).toEqual(['Herramienta', 'Pieza', 'Ceros', 'Corte', 'Husillo y avances', 'Duración']);
    expect(s[0].v).toBe('T3 · Ball mill de 3.175 mm (1/8")');
    expect(s[1].v).toBe('90 × 50 mm de acrílico, bien sujeta');
    expect(s[3].v).toBe('0.1 mm de profundidad en 1 pasada · línea de 1.11 mm');
    expect(s[4].v).toBe('S2200 a la derecha (M03) · F60 al bajar · F130 al cortar');
    expect(setupSheet({ ...P, dialect: 'grbl' }, ball, G)[0].v).toMatch(/cámbiala a mano/);
  });
  it('reconoce medidas en pulgadas y escribe duraciones', () => {
    expect(inchName(6.35)).toBe('1/4"'); expect(inchName(3)).toBe('');
    expect(duration(0.2)).toBe('1 min'); expect(duration(125)).toBe('2 h 5 min'); expect(duration(120)).toBe('2 h');
  });
});
