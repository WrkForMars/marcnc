// Varias herramientas en un programa: cuál usa cada figura y en qué orden se cambian.

/** @typedef {{t:number, type:'ball'|'flat'|'v', dia:number}} ToolDef  t: número en el carrusel (T#) */

/**
 * Índice (en `tools`) de la herramienta con que se corta la figura: la que eligió el usuario; si no, para recortar o
 * barrenar la primera fresa plana que haya (corta bien de lado y deja la orilla recta); para lo demás, la principal (0).
 * @param {{mode:string, opts?:{tool?:number}}} e
 * @param {ToolDef[]} tools
 */
export function toolFor(e, tools) {
  const k = e.opts?.tool;
  if (k != null && k >= 0 && k < tools.length) return k;
  if (e.mode === 'cut' || e.mode === 'drill') {
    const flat = tools.findIndex(t => t.type === 'flat');
    if (flat >= 0) return flat;
  }
  return 0;
}

const NAME = { ball: 'Ball mill', flat: 'Fresa plana', v: 'V-bit' };
/** "T3 · Ball mill de 3.175 mm" */
export const toolLabel = t => `T${t.t} · ${NAME[t.type] || t.type} de ${+(+t.dia).toFixed(3)} mm`;
