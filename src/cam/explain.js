// Explicación del programa línea por línea, en español llano, para aprender a leer G-code.
// Función pura: lee el programa con su estado (posición, modo G activo, avance) como lo haría la máquina.

/**
 * @typedef {{
 *   n:number, code:string,
 *   kind:'comment'|'setup'|'tool'|'spindle'|'rapid'|'plunge'|'retract'|'cut'|'arc'|'drill'|'end'|'danger'|'other',
 *   text:string,                                  // qué hace la línea
 *   from?:[number,number,number], to?:[number,number,number],
 *   g?:number, f?:number|null,                    // modo de movimiento y avance vigentes (mm/min) en las líneas que mueven
 *   arc?:{c:[number,number], r:number, ccw:boolean},
 *   block?:string,                                // figura o texto a la que pertenece (del comentario anterior)
 *   steps?:{from:[number,number,number], to:[number,number,number], g:number, f:number|null}[],  // ciclo de taladrado: sus movimientos
 * }} Explained
 */

const SETUP = {
  20: 'Unidades en pulgadas.',
  21: 'Unidades en milímetros.',
  90: 'Coordenadas absolutas: cada X, Y, Z se mide desde el cero de la pieza.',
  91: 'Coordenadas incrementales: cada X, Y, Z se mide desde la posición actual.',
  17: 'Plano de trabajo X-Y (en él se trazan los arcos).',
  40: 'Cancela la compensación de radio de la herramienta.',
  49: 'Cancela la compensación de longitud de la herramienta.',
  80: 'Cancela el ciclo de taladrado: las siguientes líneas ya no barrenan.',
  98: 'Al terminar el ciclo, la herramienta regresa a la altura donde empezó (no solo al plano R).',
  54: 'Usa el sistema de coordenadas de trabajo 1: el cero que se fijó en la máquina para esta pieza.',
};
const M_TEXT = {
  3: rpm => `Enciende el husillo${rpm ? ` a ${rpm} rpm` : ''}, girando en sentido horario.`,
  4: rpm => `Enciende el husillo${rpm ? ` a ${rpm} rpm` : ''}, girando en sentido antihorario.`,
  5: () => 'Apaga el husillo.',
  2: () => 'Fin del programa.',
  30: () => 'Fin del programa: la máquina se detiene y el programa regresa al inicio.',
  0: () => 'Pausa: la máquina espera a que el operador presione inicio de ciclo.',
};

const fx = v => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(2);
const pt = (x, y) => `X${fx(x)} Y${fx(y)}`;

/**
 * @param {string} text programa completo
 * @returns {Explained[]}
 */
export function explainProgram(text) {
  const lines = text.replace(/\n$/, '').split('\n');
  const out = [];
  let x = 0, y = 0, z = 0, g = null, f = null, abs = true, block = '', percent = 0;
  let modalSaid = false; // la nota de "G01 sigue activo" va solo en la primera línea que lo aprovecha

  lines.forEach((code, idx) => {
    const n = idx + 1;
    const comments = [...code.matchAll(/\(([^)]*)\)/g)].map(m => m[1]);
    const body = code.replace(/\([^)]*\)/g, '').trim().toUpperCase();
    const e = { n, code, kind: 'other', text: '', block };

    if (!body) {
      if (comments.length) {
        e.kind = 'comment';
        const c = comments.join(' ');
        const fig = c.match(/^(FIGURA \d+|TEXTO ".*?")\s*-\s*(.*)$/);
        if (fig) {
          block = fig[1]; e.block = block;
          e.text = `Comentario: aquí empieza ${fig[1].startsWith('FIGURA') ? 'la ' + fig[1].toLowerCase() : 'el ' + fig[1].replace('TEXTO', 'texto')} (modo ${fig[2].toLowerCase()}). La máquina ignora los comentarios.`;
        } else e.text = 'Comentario: la máquina lo ignora; sirve para quien lee el programa.';
      } else e.text = 'Línea vacía.';
      out.push(e);
      return;
    }
    if (body === '%') {
      e.kind = 'setup';
      e.text = percent++ === 0 ? 'Marca de inicio del programa (formato Fanuc).' : 'Marca de fin del archivo (formato Fanuc).';
      out.push(e);
      return;
    }

    const words = [...body.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)/g)].map(m => [m[1], parseFloat(m[2])]);
    const get = L => { const w = words.find(q => q[0] === L); return w ? w[1] : undefined; };
    const gs = words.filter(w => w[0] === 'G').map(w => w[1]);
    const ms = words.filter(w => w[0] === 'M').map(w => w[1]);
    const parts = [];

    const O = get('O');
    if (O !== undefined) { e.kind = 'setup'; parts.push(`Número de programa ${String(O).padStart(4, '0')}: con él se guarda en la memoria del control.`); }

    // regreso a home: G28 G91 Z0
    if (gs.includes(28)) {
      e.kind = 'end';
      parts.push('Regresa Z a la posición de referencia (home): aleja la herramienta de la pieza para retirarla con seguridad.');
      if (gs.includes(91)) abs = false;
      out.push({ ...e, text: parts.join(' ') });
      return;
    }

    gs.forEach(v => { if (SETUP[v]) { parts.push(SETUP[v]); if (v === 90) abs = true; if (v === 91) abs = false; if (e.kind === 'other') e.kind = 'setup'; } });
    const T = get('T');
    if (T !== undefined) { e.kind = 'tool'; parts.push(ms.includes(6) ? `Cambia a la herramienta ${T}.` : `Prepara la herramienta ${T}.`); }
    const S = get('S');
    ms.forEach(v => {
      if (v === 6) { if (T === undefined) { e.kind = 'tool'; parts.push('Cambia de herramienta.'); } return; }
      if (M_TEXT[v]) { parts.push(M_TEXT[v](S)); e.kind = v === 3 || v === 4 || v === 5 ? 'spindle' : 'end'; }
    });
    if (S !== undefined && !ms.some(v => v === 3 || v === 4)) parts.push(`Velocidad del husillo: ${S} rpm.`);

    // ciclos de taladrado: G81 (de un golpe) y G83 (con picoteo para sacar la viruta)
    const cyc = gs.find(v => v === 81 || v === 83);
    if (cyc !== undefined) {
      const cx = get('X') ?? x, cy = get('Y') ?? y, cz = get('Z'), rp = get('R') ?? z, q = get('Q');
      if (get('F') !== undefined) f = get('F');
      const z0 = z, steps = [], mv = (to, gg) => { const from = steps.length ? steps[steps.length - 1].to : [x, y, z]; steps.push({ from, to, g: gg, f: gg ? f : null }); };
      mv([cx, cy, z0], 0); mv([cx, cy, rp], 0);
      if (cyc === 81 || !q) mv([cx, cy, cz], 1);
      else {
        for (let d = q; ; d += q) {
          const zz = Math.max(cz, rp - d);
          mv([cx, cy, zz], 1);
          if (zz <= cz + 1e-9) break;
          mv([cx, cy, rp], 0); mv([cx, cy, zz + 0.2], 0);
        }
      }
      mv([cx, cy, gs.includes(99) ? rp : z0], 0);
      e.kind = 'drill';
      e.from = [x, y, z]; e.to = steps[steps.length - 1].to; e.g = 1; e.f = f; e.steps = steps;
      parts.unshift(cyc === 81
        ? `Barrena en ${pt(cx, cy)} (ciclo G81): va rápido arriba del barreno, baja rápido hasta R${fx(rp)}, barrena hasta Z${fx(cz)} a ${f} mm/min y sube rápido.`
        : `Barrena en ${pt(cx, cy)} con picoteo (ciclo G83): baja ${fx(q)} mm a la vez hasta Z${fx(cz)} a ${f} mm/min y sube a R${fx(rp)} entre cada bajada para sacar la viruta.`);
      [x, y, z] = e.to;
      out.push({ ...e, text: parts.join(' ') });
      return;
    }

    const motion = gs.find(v => v >= 0 && v <= 3);
    const X = get('X'), Y = get('Y'), Z = get('Z'), I = get('I'), J = get('J'), F = get('F');
    const moves = X !== undefined || Y !== undefined || Z !== undefined;
    if (motion !== undefined) { g = motion; modalSaid = false; }
    if (F !== undefined) f = F;

    if (moves && g !== null) {
      const from = [x, y, z];
      const nx = X === undefined ? x : abs ? X : x + X;
      const ny = Y === undefined ? y : abs ? Y : y + Y;
      const nz = Z === undefined ? z : abs ? Z : z + Z;
      const xy = nx !== x || ny !== y, dz = nz - z;
      const modal = motion === undefined && !modalSaid ? ` (G0${g} sigue activo de antes: no hace falta repetirlo)` : '';
      if (modal) modalSaid = true;
      const feed = F !== undefined ? ` a ${F} mm/min` : '';
      let txt = '';
      if (g === 0) {
        if (xy && z < 0) { e.kind = 'danger'; txt = `¡Cuidado! Movimiento rápido a ${pt(nx, ny)} con la herramienta dentro del material: puede romperla.`; }
        else if (xy) { e.kind = 'rapid'; txt = `Movimiento rápido (sin cortar) hasta ${pt(nx, ny)}, por encima de la pieza.`; }
        else if (dz > 0) { e.kind = 'retract'; txt = `Sube rápido a Z${fx(nz)}: altura segura para moverse sin tocar la pieza.`; }
        else { e.kind = nz < 0 ? 'danger' : 'rapid'; txt = nz < 0 ? `¡Cuidado! Bajada rápida a Z${fx(nz)}, dentro del material.` : `Baja rápido a Z${fx(nz)}, todavía fuera del material.`; }
      } else if (g === 1) {
        if (!xy && dz < 0) {
          e.kind = 'plunge';
          txt = nz < 0
            ? `Baja la herramienta cortando hasta Z${fx(nz)}: entra ${fx(-nz)} mm en el material${feed}.`
            : nz === 0 ? `Baja hasta la cara de la pieza (Z0)${feed}; de ahí entra en rampa.` : `Baja cortando hasta Z${fx(nz)}${feed}.`;
        } else if (!xy && dz > 0) {
          e.kind = 'retract';
          txt = nz < 0 ? `Sube a Z${fx(nz)} sin salir del material: deja un puente para que la pieza no se suelte${feed}.` : `Sube cortando hasta Z${fx(nz)}${feed}.`;
        } else {
          e.kind = 'cut';
          const L = Math.hypot(nx - x, ny - y, dz);
          txt = dz < 0
            ? `Baja en rampa hasta ${pt(nx, ny)} Z${fx(nz)} (${fx(L)} mm): entra de lado, que es como mejor corta la herramienta${feed}${modal}.`
            : `Corta en línea recta hasta ${pt(nx, ny)}${dz ? ` Z${fx(nz)}` : ''} (${fx(L)} mm)${feed}${modal}.`;
        }
      } else {
        const ccw = g === 3;
        e.kind = 'arc';
        if (I !== undefined || J !== undefined) {
          const cx = x + (I || 0), cy = y + (J || 0), r = Math.hypot(x - cx, y - cy);
          e.arc = { c: [cx, cy], r, ccw };
          txt = `Corta un arco en sentido ${ccw ? 'antihorario' : 'horario'} hasta ${pt(nx, ny)}, con centro en ${pt(cx, cy)} y radio ${fx(r)} mm${feed}. I y J dicen dónde está el centro, medido desde el punto de partida${modal}.`;
        } else {
          const R = get('R');
          txt = `Corta un arco en sentido ${ccw ? 'antihorario' : 'horario'} hasta ${pt(nx, ny)}${R !== undefined ? ` con radio ${fx(R)} mm` : ''}${feed}${modal}.`;
        }
      }
      e.from = from; e.to = [nx, ny, nz]; e.g = g; e.f = f;
      x = nx; y = ny; z = nz;
      parts.push(txt);
    } else if (motion !== undefined) {
      parts.push(['Modo de movimiento rápido (G00).', 'Modo de corte en línea recta (G01).', 'Modo de arco horario (G02).', 'Modo de arco antihorario (G03).'][motion]);
    } else if (F !== undefined && !parts.length) parts.push(`Avance de corte: ${F} mm/min.`);

    e.text = parts.join(' ') || 'Instrucción que este explicador no reconoce; revísala en el manual de tu controlador.';
    if (comments.length && e.kind !== 'comment') e.text += ' El texto entre paréntesis es un comentario.';
    out.push(e);
  });
  return out;
}

/**
 * Rango de líneas de cada figura o texto, según los comentarios que escribe generateGcode.
 * @param {Explained[]} ex
 * @returns {{block:string, first:number, last:number}[]}
 */
export function blockRanges(ex) {
  const out = [];
  ex.forEach(e => {
    if (!e.block) return;
    const cur = out[out.length - 1];
    if (cur && cur.block === e.block) cur.last = e.n;
    else out.push({ block: e.block, first: e.n, last: e.n });
  });
  return out;
}
