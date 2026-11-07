import { describe, expect, it } from 'vitest';
import { copyOffsets, shiftElement } from '../src/cam/copies.js';
import { fromC } from '../src/geometry/clipper.js';
import { regionEl, lineEl, square } from './helpers.js';

describe('varias copias en una placa', () => {
  it('acomoda en renglones desde el dibujo original, con su separación, y dice cuántas caben', () => {
    // llavero de 60 × 30 en una placa de 200 × 100, empezando en (2, 2), separación 3
    const r = copyOffsets([2, 2, 62, 32], 6, { W: 200, H: 100, gap: 3 });
    expect(r.fit).toBe(9); // 3 por renglón (2 + 3·63 = 191 ≤ 200), 3 renglones (2 + 3·33 = 101 > 100 → 3: 2+30+33+33=98)
    expect(r.offsets).toEqual([[63, 0], [126, 0], [0, 33], [63, 33], [126, 33]]);
  });
  it('si se piden más de las que caben, solo pone las que caben', () => {
    const r = copyOffsets([0, 0, 50, 50], 10, { W: 100, H: 100, gap: 0 });
    expect(r.fit).toBe(4); expect(r.offsets).toHaveLength(3);
  });
  it('la copia es la misma figura corrida, sin trayectorias calculadas', () => {
    const e = { ...regionEl(square(0, 0, 10)), paths: [1], warn: 'x' };
    const c = shiftElement(e, 20, 5);
    expect(fromC(c.parts[0].outer)[0]).toEqual([20, 5]);
    expect(c.paths).toBeUndefined(); expect(c.mode).toBe(e.mode);
    expect(fromC(e.parts[0].outer)[0]).toEqual([0, 0]); // el original no se mueve
    expect(shiftElement(lineEl([[1, 1], [2, 2]]), 1, 0).parts[0].pts).toEqual([[2, 1], [3, 2]]);
  });
});
