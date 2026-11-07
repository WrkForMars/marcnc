import { describe, expect, it } from 'vitest';
import { carveStock, shadeStock } from '../src/cam/stock.js';

const PROG = 'G21 G90\nT1 M06\nG00 Z3.00\nG00 X10.00 Y10.00\nG01 Z-1.00 F60\nG01 X20.00 F130\nG00 Z3.00\n';
const at = (s, x, y) => s.z[Math.floor(y / s.res) * s.gw + Math.floor(x / s.res)];

describe('simulación del material', () => {
  it('una fresa plana deja una ranura de fondo plano del ancho de su diámetro', () => {
    const s = carveStock(PROG, { W: 30, H: 20, res: 0.1, toolNum: 1, tools: [{ t: 1, type: 'flat', dia: 2 }] });
    expect(at(s, 15, 10)).toBeCloseTo(-1, 6);
    expect(at(s, 15, 10.85)).toBeCloseTo(-1, 6); // dentro del radio: mismo fondo
    expect(at(s, 15, 11.3)).toBe(0); // fuera del radio: la cara intacta
    expect(at(s, 5, 10)).toBe(0); // antes de empezar
    expect(s.deepest).toBeCloseTo(-1, 6);
  });
  it('una ball mill deja el fondo redondo: más hondo al centro que a la orilla', () => {
    const s = carveStock(PROG, { W: 30, H: 20, res: 0.1, toolNum: 1, tools: [{ t: 1, type: 'ball', dia: 2 }] });
    expect(at(s, 15, 10.05)).toBeLessThan(-0.99);
    expect(at(s, 15, 10.75)).toBeGreaterThan(-0.8); // a 0.75 mm del centro, una bola de radio 1 deja -0.66
  });
  it('usa la herramienta que está puesta en cada parte del programa', () => {
    const two = PROG + 'M05\nT2 M06\nS2200 M03\nG00 X10.00 Y15.00\nG01 Z-1.00 F60\nG01 X20.00 F130\nG00 Z3.00\n';
    const s = carveStock(two, { W: 30, H: 20, res: 0.1, toolNum: 1, tools: [{ t: 1, type: 'flat', dia: 1 }, { t: 2, type: 'flat', dia: 4 }] });
    expect(at(s, 15, 10.8)).toBe(0); // la de 1 mm no llega a 0.8
    expect(at(s, 15, 16.8)).toBeCloseTo(-1, 6); // la de 4 mm sí
  });
  it('los barrenos G81 también tallan', () => {
    const s = carveStock('G21 G90\nG00 Z3.00\nG98 G81 X5.00 Y5.00 Z-2.00 R1.00 F60\nG80\n', { W: 10, H: 10, res: 0.1, toolNum: 1, tools: [{ t: 1, type: 'flat', dia: 3 }] });
    expect(at(s, 5, 5)).toBeCloseTo(-2, 6);
  });
  it('la imagen va de la placa a lo hondo, con la fila de arriba primero', () => {
    const s = carveStock(PROG, { W: 30, H: 20, res: 0.5, toolNum: 1, tools: [{ t: 1, type: 'flat', dia: 2 }] });
    const img = shadeStock(s, [200, 200, 200], [20, 20, 20]);
    expect(img.length).toBe(s.gw * s.gh * 4);
    const px = (x, y) => img[4 * ((s.gh - 1 - Math.floor(y / s.res)) * s.gw + Math.floor(x / s.res))];
    expect(px(15, 10)).toBeLessThan(px(15, 18)); // lo tallado más oscuro que la cara
  });
});
