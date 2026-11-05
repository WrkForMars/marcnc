import { describe, expect, it } from 'vitest';
import { fromC } from '../src/geometry/clipper.js';
import { applyDimension, applyDims, definedState, dimensions, entityBox, entityPts, hitEntity, infer, measure, mirror, parseNum, parsePoint, rotate, sketchElements, snap, translate } from '../src/sketch/geometry.js';
import { createSketchEditor } from '../src/sketch/editor.js';

const rect = (id, x, y, w, h) => ({ id, type: 'rect', x, y, w, h });
const circle = (id, cx, cy, r) => ({ id, type: 'circle', cx, cy, r });

describe('entityPts', () => {
  it('un rectángulo con ancho o alto negativo da las mismas esquinas', () => {
    expect(entityPts(rect(1, 10, 10, -4, -2)).pts).toEqual(entityPts(rect(1, 6, 8, 4, 2)).pts);
  });

  it('el círculo no se aleja de su radio más que la tolerancia', () => {
    const { pts, closed } = entityPts(circle(1, 5, 5, 10), 0.01);
    expect(closed).toBe(true);
    pts.forEach(([x, y]) => expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(10, 9));
    // la flecha de cada cuerda cabe en la tolerancia
    const a = pts[0], b = pts[1];
    expect(10 - Math.hypot((a[0] + b[0]) / 2 - 5, (a[1] + b[1]) / 2 - 5)).toBeLessThanOrEqual(0.01);
  });

  it('el arco va de a1 a a2 en sentido antihorario, aunque cruce 0°', () => {
    const { pts, closed } = entityPts({ id: 1, type: 'arc', cx: 0, cy: 0, r: 10, a1: 270, a2: 90 });
    expect(closed).toBe(false);
    expect(pts[0][0]).toBeCloseTo(0, 9); expect(pts[0][1]).toBeCloseTo(-10, 9);
    expect(pts.at(-1)[1]).toBeCloseTo(10, 9);
    expect(Math.max(...pts.map(p => p[0]))).toBeCloseTo(10, 6); // pasa por la derecha (0°)
  });

  it('el polígono regular pone su primer vértice en el ángulo indicado', () => {
    const { pts } = entityPts({ id: 1, type: 'poly', cx: 0, cy: 0, r: 5, n: 6, rot: 90 });
    expect(pts).toHaveLength(6);
    expect(pts[0][0]).toBeCloseTo(0, 9); expect(pts[0][1]).toBeCloseTo(5, 9);
  });
});

describe('parsePoint', () => {
  it('lee coordenadas absolutas con espacio, punto y coma o coma', () => {
    expect(parsePoint('10 20')).toEqual([10, 20]);
    expect(parsePoint('10;20')).toEqual([10, 20]);
    expect(parsePoint('10.5,20')).toEqual([10.5, 20]);
    expect(parsePoint('10,5 20')).toEqual([10.5, 20]); // coma decimal
  });

  it('lee relativas y polares a partir del último punto', () => {
    expect(parsePoint('@5 -2', [10, 10])).toEqual([15, 8]);
    const [x, y] = parsePoint('@10<90', [1, 1]);
    expect(x).toBeCloseTo(1, 9); expect(y).toBeCloseTo(11, 9);
  });

  it('rechaza lo que no es un punto', () => {
    expect(parsePoint('')).toBeNull();
    expect(parsePoint('hola')).toBeNull();
    expect(parsePoint('1 2 3')).toBeNull();
    expect(parseNum('2,5')).toBe(2.5);
    expect(parseNum('2x')).toBeNull();
  });
});

describe('snap', () => {
  const ents = [rect(1, 10, 10, 20, 10)];
  it('prefiere un vértice cercano a la cuadrícula', () => {
    expect(snap([10.3, 9.8], ents, { grid: 1, snap: true, tol: 1 })).toEqual({ p: [10, 10], kind: 'extremo' });
  });
  it('si no hay nada cerca, redondea a la cuadrícula', () => {
    expect(snap([3.3, 7.8], ents, { grid: 0.5, snap: true, tol: 1 }).p).toEqual([3.5, 8]);
  });
  it('sin imán deja el punto tal cual', () => {
    expect(snap([3.3, 7.8], ents, { grid: 1, snap: false, tol: 1 }).p).toEqual([3.3, 7.8]);
  });
});

describe('hitEntity y translate', () => {
  it('encuentra la figura cuyo trazo está cerca', () => {
    const ents = [rect(1, 0, 0, 10, 10), circle(2, 30, 5, 3)];
    expect(hitEntity(ents, [10.2, 5], 0.5).id).toBe(1);
    expect(hitEntity(ents, [33, 5.1], 0.5).id).toBe(2);
    expect(hitEntity(ents, [5, 5], 0.5)).toBeNull(); // el centro del rectángulo no es su trazo
  });
  it('mueve cada tipo de figura', () => {
    expect(translate(rect(1, 0, 0, 2, 2), 3, 4)).toMatchObject({ x: 3, y: 4 });
    expect(translate(circle(1, 0, 0, 2), 3, 4)).toMatchObject({ cx: 3, cy: 4 });
    expect(translate({ id: 1, type: 'line', pts: [[0, 0], [1, 1]], closed: false }, 1, 1).pts).toEqual([[1, 1], [2, 2]]);
  });
});

describe('sketchElements', () => {
  it('un círculo dentro de un rectángulo es su hueco', () => {
    const els = sketchElements([rect(1, 0, 0, 40, 20), circle(2, 20, 10, 5)]);
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ src: 'sketch', type: 'region', sketchId: 1, mode: 'fill', label: 'Rectángulo' });
    expect(els[0].parts[0].holes).toHaveLength(1);
    expect(els[0].detail).toBe('40 × 20 mm · 1 hueco');
  });

  it('una figura dentro de un hueco vuelve a ser figura (isla)', () => {
    const els = sketchElements([rect(1, 0, 0, 40, 40), circle(2, 20, 20, 15), circle(3, 20, 20, 5)]);
    expect(els.map(e => e.sketchId).sort()).toEqual([1, 3]);
  });

  it('las figuras separadas son elementos aparte y las abiertas se graban como trazo', () => {
    const els = sketchElements([
      rect(1, 0, 0, 10, 10), rect(2, 20, 0, 10, 10),
      { id: 3, type: 'line', pts: [[0, 20], [30, 20]], closed: false },
      { id: 4, type: 'arc', cx: 50, cy: 10, r: 5, a1: 0, a2: 180 },
    ]);
    expect(els.map(e => [e.sketchId, e.type])).toEqual([[1, 'region'], [2, 'region'], [3, 'line'], [4, 'line']]);
  });

  it('conserva el modo elegido para cada figura', () => {
    const els = sketchElements([rect(7, 0, 0, 10, 10), { id: 8, type: 'line', pts: [[0, 20], [5, 20]], closed: false }], { 7: 'contour', 8: 'skip' });
    expect(els.map(e => e.mode)).toEqual(['contour', 'skip']);
  });

  it('las coordenadas del croquis son las de la pieza, en mm', () => {
    const [e] = sketchElements([rect(1, 5, 5, 10, 4)]);
    const xs = fromC(e.parts[0].outer).map(p => p[0]), ys = fromC(e.parts[0].outer).map(p => p[1]);
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).toEqual([5, 5, 15, 9]);
  });
});

describe('cotas', () => {
  const W = 90, H = 50;
  it('miden al borde más cercano de la pieza y el tamaño', () => {
    const d = dimensions(rect(1, 10, 30, 20, 8), W, H);
    expect(d.map(x => [x.kind, x.axis, x.side, +x.value.toFixed(6)])).toEqual([
      ['edge', 'x', 'left', 10], ['edge', 'y', 'top', 12], ['size', 'x', undefined, 20], ['size', 'y', undefined, 8],
    ]);
    const c = dimensions(circle(2, 80, 10, 4), W, H);
    expect(c.find(x => x.axis === 'x').side).toBe('right');
    expect(c.find(x => x.axis === 'x').value).toBeCloseTo(6, 9);
    expect(c.find(x => x.axis === 'd').label).toBe('Ø8');
  });

  it('escribir una distancia al borde mueve la figura', () => {
    const e = rect(1, 10, 30, 20, 8), d = dimensions(e, W, H);
    expect(applyDimension(e, d[0], 25, W, H)).toMatchObject({ x: 25, y: 30 });
    const top = applyDimension(e, d[1], 5, W, H); // 5 mm del borde de arriba
    expect(top.y + top.h).toBeCloseTo(45, 9);
    const c = circle(2, 80, 10, 4), dc = dimensions(c, W, H);
    expect(applyDimension(c, dc.find(x => x.side === 'right'), 2, W, H).cx).toBeCloseTo(84, 9);
  });

  it('escribir un tamaño estira la figura desde su esquina, o cambia el radio sin mover el centro', () => {
    const e = rect(1, 10, 30, 20, 8), d = dimensions(e, W, H);
    expect(applyDimension(e, d[2], 30, W, H)).toMatchObject({ x: 10, y: 30, w: 30, h: 8 });
    const c = circle(2, 40, 20, 4);
    expect(applyDimension(c, dimensions(c, W, H).find(x => x.axis === 'd'), 12, W, H)).toMatchObject({ cx: 40, cy: 20, r: 6 });
    const l = { id: 3, type: 'line', pts: [[0, 0], [10, 5]], closed: false };
    expect(applyDimension(l, dimensions(l, W, H).find(x => x.kind === 'size' && x.axis === 'y'), 10, W, H).pts).toEqual([[0, 0], [10, 10]]);
  });

  it('ignora valores inválidos', () => {
    const e = rect(1, 10, 30, 20, 8), d = dimensions(e, W, H);
    expect(applyDimension(e, d[2], 0, W, H)).toBe(e);
    expect(applyDimension(e, d[0], NaN, W, H)).toBe(e);
    expect(applyDimension(e, d[0], -3, W, H)).toBe(e);
  });
});

describe('figuras nuevas', () => {
  it('rectángulo con esquinas redondeadas: misma caja y esquinas a R del borde', () => {
    const e = { id: 1, type: 'rect', x: 0, y: 0, w: 20, h: 10, rr: 3 };
    expect(entityBox(e).map(v => +v.toFixed(6))).toEqual([0, 0, 20, 10]);
    // la esquina (0,0) ya no está: el punto más cercano queda a 3·(√2−1) ≈ 1.24 mm
    const d = Math.min(...entityPts(e).pts.map(([x, y]) => Math.hypot(x, y)));
    expect(d).toBeCloseTo(3 * (Math.SQRT2 - 1), 2);
  });

  it('ranura: largo entre centros + ancho, extremos redondos', () => {
    const s = { id: 1, type: 'slot', x1: 10, y1: 10, x2: 30, y2: 10, w: 6 };
    expect(entityBox(s).map(v => +v.toFixed(3))).toEqual([7, 7, 33, 13]);
    const dims = dimensions(s, 90, 50);
    expect(dims.find(x => x.axis === 'l').value).toBeCloseTo(20, 9);
    expect(applyDimension(s, dims.find(x => x.axis === 'l'), 30, 90, 50)).toMatchObject({ x2: 40, y2: 10 });
    expect(applyDimension(s, dims.find(x => x.axis === 'w'), 8, 90, 50).w).toBe(8);
  });

  it('girar y reflejar conservan la forma', () => {
    const r = { id: 1, type: 'rect', x: 0, y: 0, w: 10, h: 4 };
    expect(rotate(r, 0, 0, 90)).toMatchObject({ type: 'rect', w: 4, h: 10 });
    expect(rotate(r, 0, 0, 45).type).toBe('line'); // un rectángulo inclinado ya no es rectángulo
    const a = { id: 2, type: 'arc', cx: 10, cy: 0, r: 5, a1: 0, a2: 90 };
    const m = mirror(a, 'x', 0);
    expect(m.cx).toBe(-10);
    // el arco reflejado cubre el cuadrante espejo: de 90° a 180°
    expect(m).toMatchObject({ a1: 90, a2: 180 });
  });

  it('la geometría de construcción no se graba', () => {
    expect(sketchElements([{ id: 1, type: 'rect', x: 0, y: 0, w: 10, h: 10, construction: true }])).toHaveLength(0);
  });
});

describe('inferencias', () => {
  const ents = [{ id: 1, type: 'rect', x: 10, y: 10, w: 20, h: 10 }];
  it('se alinea con un punto de otra figura y deja una guía', () => {
    const r = infer([40.3, 20.2], ents, { grid: 1, snap: true, tol: 0.5 });
    expect(r.p).toEqual([40, 20]); // y = 20 de la esquina superior; x a la cuadrícula
    expect(r.kind).toBe('alineado');
    expect(r.guides).toHaveLength(1);
  });
  it('horizontal respecto al punto anterior', () => {
    const r = infer([55.2, 30.3], ents, { grid: 1, snap: true, tol: 0.5, last: [45, 30] });
    expect(r.p[1]).toBe(30);
    expect(r.kind).toBe('horizontal');
  });
});

describe('cotas que mandan', () => {
  const W = 90, H = 50;
  const base = [{ id: 1, type: 'rect', x: 10, y: 10, w: 20, h: 10 }, { id: 2, type: 'circle', cx: 60, cy: 30, r: 4 }];
  const dims = [
    { id: 1, kind: 'edge', ent: 1, axis: 'x', side: 'left', value: 5 },
    { id: 2, kind: 'size', ent: 1, axis: 'x', value: 30 },
    { id: 3, kind: 'between', ent: 2, ref: 1, axis: 'x', value: 40 },
  ];
  it('se cumplen en orden: borde, tamaño y distancia entre figuras', () => {
    const out = applyDims(base, dims, W, H);
    expect(out[0]).toMatchObject({ x: 5, w: 30 });
    expect(out[1].cx).toBeCloseTo(20 + 40, 9); // centro del rectángulo (20) + 40
    const byId = new Map(out.map(e => [e.id, e]));
    dims.forEach(d => expect(measure(d, byId, W, H)).toBeCloseTo(d.value, 9));
  });
  it('arrastrar una figura acotada la regresa en esa dirección', () => {
    const moved = applyDims([translate(base[0], 7, 3), base[1]], dims, W, H);
    expect(moved[0].x).toBe(5); // X fijo por la cota
    expect(moved[0].y).toBe(13); // Y libre
  });
  it('sabe qué le falta a cada figura para quedar definida', () => {
    const st = definedState(base, [...dims, { id: 4, kind: 'edge', ent: 1, axis: 'y', side: 'bottom', value: 10 }, { id: 5, kind: 'size', ent: 1, axis: 'y', value: 10 }]);
    expect(st.get(1)).toEqual({ full: true, missing: [] });
    expect(st.get(2).missing).toEqual(['posición Y', 'diámetro']); // X fija por la cota a la figura 1, que está fija
  });
});

describe('editor con hábitos de CAD', () => {
  const editor = () => {
    const ed = createSketchEditor({ onChange() {}, onRedraw() {}, onStatus() {}, css: () => '#000' });
    ed.setOptions({ snap: false });
    return ed;
  };
  const click = (ed, p) => { ed.down(p, 0.5); ed.up(); };
  it('rectángulo de centro: centro y una esquina', () => {
    const ed = editor();
    ed.setTool('crect');
    click(ed, [40, 25]); click(ed, [50, 30]);
    expect(ed.entities[0]).toMatchObject({ type: 'rect', x: 30, y: 20, w: 20, h: 10 });
  });
  it('cota inteligente: figura y luego un lugar libre acota su tamaño; cerca de un borde, la distancia a él', () => {
    const ed = editor();
    ed.setTool('circle'); click(ed, [45, 25]); click(ed, [50, 25]);
    ed.setTool('dim');
    click(ed, [50, 25]); click(ed, [70, 40]);
    expect(ed.dims).toEqual([expect.objectContaining({ kind: 'size', axis: 'd', value: 10 })]);
    click(ed, [50, 25]); click(ed, [0.5, 30]);
    expect(ed.dims[1]).toMatchObject({ kind: 'edge', side: 'left', axis: 'x', value: 40 });
  });
  it('matrices y simetría: vista previa sin cambiar nada y un solo paso de deshacer al aceptar', () => {
    const ed = editor();
    ed.setTool('circle'); click(ed, [10, 10]); click(ed, [12, 10]);
    ed.setTool('select'); click(ed, [12, 10]);
    expect(ed.previewOp({ kind: 'linear', n: 3, dx: 10, dy: 0 })).toBe(3);
    expect(ed.entities).toHaveLength(1);
    expect(ed.applyOp({ kind: 'linear', n: 3, dx: 10, dy: 0 })).toBe(3);
    expect(ed.entities.map(e => e.cx)).toEqual([10, 20, 30, 40]);
    ed.undoOne();
    expect(ed.entities).toHaveLength(1);
    expect(ed.selection).toHaveLength(0); // las copias ya no existen
    click(ed, [12, 10]);
    expect(ed.previewOp({ kind: 'circular', n: 4, cx: 20, cy: 10 })).toBe(3);
    expect(ed.previewOp({ kind: 'mirror', axis: 'x', c: 45 })).toBe(1);
  });
  it('clic derecho termina la cadena de líneas y Enter repite el último comando', () => {
    const ed = editor();
    ed.setTool('line'); click(ed, [0, 0]); click(ed, [10, 0]); click(ed, [10, 10]);
    expect(ed.endChain()).toBe(true);
    expect(ed.entities[0].pts).toHaveLength(3);
    expect(ed.endChain()).toBe(false);
    ed.setTool('select');
    expect(ed.lastTool).toBe('line');
  });
  it('estado del croquis: cuenta las figuras sin definir, sin las de construcción', () => {
    const ed = editor();
    ed.setTool('rect'); click(ed, [0, 0]); click(ed, [10, 10]);
    ed.setTool('circle'); click(ed, [20, 20]); click(ed, [22, 20]);
    ed.setConstruction(true); // el círculo recién hecho queda elegido
    expect(ed.sketchState()).toEqual({ total: 1, under: 1 });
  });
});
