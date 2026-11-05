import { describe, expect, it } from 'vitest';
import { explainProgram } from '../src/cam/explain.js';
import { RAPID_MM_MIN, buildTimeline, clock, positionAt, segAt, timeOfLine } from '../src/cam/simulate.js';

const PROG = ['G90', 'G00 Z3', 'G00 X10 Y0', 'G01 Z-0.1 F60', 'G01 X20 F120', 'G03 X10 Y10 I-10 J0', 'G00 Z3'].join('\n');

describe('buildTimeline', () => {
  const tl = buildTimeline(explainProgram(PROG));

  it('cada movimiento dura su longitud entre su avance', () => {
    const [up, rapid, plunge, cut, arc, back] = tl.segs;
    expect(up.dur).toBeCloseTo((3 / RAPID_MM_MIN) * 60, 9);
    expect(rapid.dur).toBeCloseTo((10 / RAPID_MM_MIN) * 60, 9);
    expect(plunge.dur).toBeCloseTo((3.1 / 60) * 60, 9);
    expect(cut.dur).toBeCloseTo((10 / 120) * 60, 9);
    // cuarto de círculo de radio 10 a F120 (el avance sigue vigente)
    expect(arc.len).toBeCloseTo(Math.PI * 10 / 2, 9);
    expect(arc.dur).toBeCloseTo((Math.PI * 5 / 120) * 60, 9);
    expect(back.t0 + back.dur).toBeCloseTo(tl.total, 9);
  });

  it('interpola la posición en rectas y arcos', () => {
    const cut = tl.segs[3], arc = tl.segs[4];
    expect(positionAt(tl, cut.t0 + cut.dur / 2).p).toEqual([15, 0, -0.1]);
    const mid = positionAt(tl, arc.t0 + arc.dur / 2).p;
    expect(Math.hypot(mid[0] - 10, mid[1])).toBeCloseTo(10, 9); // sobre la circunferencia
    expect(mid[0]).toBeCloseTo(10 + 10 * Math.cos(Math.PI / 4), 9); // a 45°: antihorario desde 0°
    expect(mid[1]).toBeCloseTo(10 * Math.sin(Math.PI / 4), 9);
  });

  it('ubica el movimiento y la línea de cada instante', () => {
    expect(segAt(tl, 0)).toBe(0);
    expect(tl.segs[segAt(tl, tl.total)].n).toBe(7);
    expect(timeOfLine(tl, 4)).toBeCloseTo(tl.segs[2].t0 + tl.segs[2].dur, 9); // la línea 4 es la bajada
    expect(clock(75)).toBe('1:15');
    expect(clock(3725)).toBe('1:02:05');
  });

  it('un arco de 360° da la vuelta completa', () => {
    const t = buildTimeline(explainProgram('G00 X10 Y0\nG01 Z-1 F60\nG02 X10 Y0 I-10 J0 F100'));
    expect(Math.abs(t.segs.at(-1).arc.sweep)).toBeCloseTo(2 * Math.PI, 9);
  });
});
