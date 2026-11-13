// Verificador independiente de un programa G: lo lee como lo haría la máquina (sin usar explain.js ni simulate.js)
// y devuelve cada regla de seguridad que no se cumple. Lo usan audit.test.js y fuzz.test.js.

const HOME = 1e6; // Z en la referencia de la máquina (después de G28) o todavía desconocida: arriba de todo

/**
 * @param {string} text
 * @param {{dialect:'fanuc'|'grbl', W:number, H:number, retract:number, dec?:number, maxDepth:number, changer?:boolean,
 *   tools:{t:number, dia:number, fz:number, fxy:number}[]}} c maxDepth: lo más hondo que puede bajar (mm, positivo)
 * @returns {string[]} problemas (vacío = programa correcto)
 */
export function verifyProgram(text, c) {
  const P = [];
  const lines = text.replace(/\n$/, '').split('\n');
  const eps = 1e-6, R = Math.max(0.5, c.retract), maxR = Math.max(...c.tools.map(t => t.dia)) / 2;
  const arcLim = (c.dec ?? 2) >= 3 ? 0.002 : 0.005;
  let x = 0, y = 0, z = HOME, g = null, f = null, spin = false, abs = true, tool = null, ended = false, pct = 0;
  let needG80 = false, comp = false, toolChanges = 0;
  const deepest = new Map(); // "x,y" → Z más honda a la que ya se bajó cortando ahí (para el regreso rápido del picoteo)
  const key = (a, b) => `${a.toFixed(3)},${b.toFixed(3)}`;
  const T = () => c.tools.find(t => t.t === tool);

  lines.forEach((raw, idx) => {
    const n = idx + 1, bad = m => P.push(`línea ${n}: ${m} → ${raw}`);
    if (/NaN|Infinity|undefined|null/.test(raw)) bad('valor inválido');
    const opens = (raw.match(/\(/g) || []).length, closes = (raw.match(/\)/g) || []).length;
    if (opens > 1 || opens !== closes) bad('paréntesis anidados o sin cerrar');
    (raw.match(/\(([^)]*)\)/g) || []).forEach(cm => { if (!/^\([A-Z0-9 .,:;_\-+*/#="]*\)$/.test(cm)) bad('comentario con caracteres que un control puede rechazar'); });
    // sin cambiador, la herramienta puesta se anuncia en un comentario
    const manual = raw.match(/\((?:CAMBIO MANUAL A HERRAMIENTA|CAMBIA A) T(\d+)/);
    if (manual) tool = +manual[1];
    const body = raw.replace(/\([^)]*\)/g, '').trim();
    if (ended && body !== '%') { if (body) bad('código después del fin del programa'); return; }
    if (!body) return;
    if (body === '%') { pct++; if (c.dialect === 'grbl') bad('% en GRBL'); return; }
    if (body.replace(/([A-Z])(-?\d+(?:\.\d+)?)/g, '').trim()) bad('texto que no es una palabra de código');
    const words = [...body.matchAll(/([A-Z])(-?\d+(?:\.\d+)?)/g)].map(m => [m[1], +m[2]]);
    const get = L => { const w = words.find(q => q[0] === L); return w ? w[1] : undefined; };
    const gs = words.filter(w => w[0] === 'G').map(w => w[1]), ms = words.filter(w => w[0] === 'M').map(w => w[1]);

    if (needG80 && !gs.includes(80)) bad('falta G80 después del ciclo de taladrado');
    if (gs.includes(80)) needG80 = false;
    if (c.dialect === 'grbl') {
      if (get('O') !== undefined) bad('número de programa en GRBL');
      if (ms.includes(6)) bad('M06 en GRBL');
      if (gs.some(v => [28, 43, 81, 83, 98, 99].includes(v))) bad('código que GRBL no acepta');
    }
    if (get('O') !== undefined && !(get('O') >= 1 && get('O') <= 9999)) bad('número de programa fuera de 1–9999');
    if (get('F') !== undefined) { f = get('F'); if (!(f > 0)) bad('avance en cero'); }
    if (get('T') !== undefined) { tool = get('T'); if (!T()) bad('herramienta que no está en la lista'); }

    // regreso a la referencia: G28 G91 Z0, y la línea siguiente debe volver a absolutas
    if (gs.includes(28)) {
      if (!gs.includes(91) || get('Z') !== 0 || get('X') !== undefined || get('Y') !== undefined) bad('G28 que no es G28 G91 Z0');
      if (spin) bad('regreso a la referencia con el husillo encendido');
      z = HOME; abs = false; comp = false;
      return;
    }
    if (gs.includes(90)) abs = true;
    if (gs.includes(91)) abs = false;

    // husillo, cambio de herramienta, pausa y fin
    if (ms.includes(5)) spin = false;
    if (ms.includes(6)) {
      if (tool === null || get('T') === undefined) bad('M06 sin herramienta');
      if (spin) bad('cambio de herramienta con el husillo encendido');
      if (z < HOME) bad('cambio de herramienta sin subir antes a la referencia');
      toolChanges++; comp = false;
    }
    if (ms.includes(0)) {
      if (spin) bad('pausa con el husillo encendido');
      if (z < R - eps) bad('pausa con la herramienta abajo');
    }
    if (ms.includes(3)) {
      const S = get('S');
      if (!(S >= 100)) bad('husillo encendido sin velocidad');
      spin = true;
    }
    if (ms.includes(30) || ms.includes(2)) {
      if (spin) bad('fin del programa con el husillo encendido');
      if (z < R - eps) bad('fin del programa con la herramienta abajo');
      ended = true;
      return;
    }
    if (gs.includes(43)) {
      if (get('H') !== tool) bad('G43 con un H que no es el de la herramienta puesta');
      comp = true;
    }

    const X = get('X'), Y = get('Y'), Z = get('Z');
    if (X === undefined && Y === undefined && Z === undefined) return;
    if (!abs) { bad('movimiento en coordenadas incrementales'); return; }

    // ciclo de taladrado
    const cyc = gs.find(v => v === 81 || v === 83);
    if (cyc !== undefined) {
      const rp = get('R'), t = T();
      if (z < R - eps) bad('ciclo de taladrado que no empieza a la altura de retracción');
      if (!gs.includes(98)) bad('ciclo sin G98: no regresaría a la altura inicial');
      if (!spin) bad('barreno con el husillo apagado');
      if (!(rp > 0)) bad('plano R dentro del material');
      if (!(Z < 0) || Z < -c.maxDepth - eps) bad('profundidad del barreno fuera de lo pedido');
      if (cyc === 83 && !(get('Q') > 0)) bad('G83 sin Q');
      if (t && f !== t.fz) bad(`barreno a F${f} en vez de F${t.fz}`);
      x = X ?? x; y = Y ?? y;
      if (x < -eps || y < -eps || x > c.W + eps || y > c.H + eps) bad('barreno fuera de la pieza');
      deepest.set(key(x, y), Z);
      needG80 = true; g = null; // tras G80 hay que volver a dar el modo de movimiento
      return;
    }

    const m = gs.find(v => v >= 0 && v <= 3);
    if (m !== undefined) g = m;
    if (g === null) { bad('movimiento sin G00/G01/G02/G03 vigente'); return; }
    const nx = X ?? x, ny = Y ?? y, nz = Z ?? z;
    const dxy = Math.hypot(nx - x, ny - y), dz = nz - z;

    if (g === 0) {
      if (dxy > eps && (z < R - eps || nz < R - eps)) bad('rápido en X-Y por debajo de la altura de retracción');
      if (dxy <= eps && dz < 0 && nz < 0.5 - eps) {
        const d = deepest.get(key(x, y));
        if (d === undefined || nz < d + 0.19) bad('bajada rápida dentro del material');
      }
    } else {
      const t = T();
      if (!spin) bad('corte con el husillo apagado');
      if (!(f > 0)) bad('corte sin avance');
      if (tool === null && c.dialect === 'fanuc' && c.changer !== false) bad('corte sin herramienta');
      if (nz < -c.maxDepth - eps) bad(`Z${nz} más hondo que lo pedido (${c.maxDepth})`);
      if (z >= HOME) bad('corte sin haber bajado antes a la altura de retracción');
      if (t && nz < 0) {
        // bajadas (de punta o más empinadas que 30°) al avance de Z; lo demás, al avance X-Y
        const steep = dz < -eps && -dz > Math.tan(Math.PI / 6) * dxy;
        if (steep && f !== t.fz) bad(`bajada a F${f} en vez de F${t.fz}`);
        if (!steep && dxy > eps && f !== t.fxy) bad(`corte a F${f} en vez de F${t.fxy}`);
      }
      if (Math.min(z, nz) < 0) {
        const lim = maxR + 0.011;
        if (nx < -lim || ny < -lim || nx > c.W + lim || ny > c.H + lim) bad('corte fuera de la pieza');
      }
      if (g >= 2) {
        const I = get('I'), J = get('J');
        if (I === undefined || J === undefined) bad('arco sin I y J');
        else {
          const cx = x + I, cy = y + J, r0 = Math.hypot(I, J), r1 = Math.hypot(nx - cx, ny - cy);
          if (r0 < 1e-3) bad('arco de radio cero');
          if (Math.abs(r0 - r1) > arcLim + 1e-9) bad(`arco con radios ${r0.toFixed(4)} y ${r1.toFixed(4)}`);
        }
      }
      if (dxy <= eps && dz < 0) { const k = key(x, y), d = deepest.get(k); if (d === undefined || nz < d) deepest.set(k, nz); }
    }
    x = nx; y = ny; z = nz;
  });

  if (!ended) P.push('el programa no termina con M30');
  if (needG80) P.push('ciclo de taladrado sin cancelar al final');
  if (c.dialect === 'fanuc') {
    if (lines[0] !== '%' || lines[lines.length - 1] !== '%' || pct !== 2) P.push('faltan las marcas % de Fanuc');
    if (!/^O\d{4}\b/.test(lines[1] || '')) P.push('falta el número de programa O####');
    // con cambiador y más de una herramienta, cada una debe llevar su compensación de largo
    if (c.changer !== false && toolChanges > 1 && !/G43/.test(text)) P.push('varias herramientas con cambiador y sin G43: el largo de cada una no se compensa');
  }
  return P;
}
