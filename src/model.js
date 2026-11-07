// Modelo de datos compartido. Todas las coordenadas de la pieza están en mm,
// con el origen en la esquina inferior izquierda y Y hacia arriba (como la máquina).

/**
 * Una región es un contorno exterior con sus huecos, como caminos de Clipper (enteros, µm).
 * @typedef {{outer: {X:number,Y:number}[], holes: {X:number,Y:number}[][]}} RegionPart
 *
 * Un trazo es una polilínea en mm.
 * @typedef {{pts: [number,number][], closed: boolean}} LinePart
 *
 * @typedef {'fill'|'contour'|'vcarve'|'cut'|'drill'|'invert'|'line'|'skip'} Mode
 *
 * Un elemento es lo que el usuario ve como una figura o un texto en la lista.
 * @typedef {{
 *   src: 'design'|'text',
 *   type: 'region'|'line',
 *   parts: (RegionPart|LinePart)[],
 *   mode: Mode,
 *   text?: TextItem,
 *   paths?: LinePart[],   // trayectorias calculadas (centro de la herramienta)
 *   opts?: {depth?:number, tabs?:number},  // lo que el usuario cambió de esta figura (profundidad propia, puentes)
 *   op?: {depth:number, tabTop?:number, tabW?:number, tabs?:number|null},  // cam/cut.js elementOp: cómo se corta
 *   tl?: object,          // herramienta a la profundidad de esta figura (tool.js)
 *   warn?: string|null,
 * }} Element
 *
 * @typedef {{
 *   id:number, text:string, font:string, h:number, sp:number, x:number, y:number,
 *   mode?: Mode, rev:number, local?: {type:'region'|'line', parts:any[]}|null
 * }} TextItem
 */

/** Modos disponibles por tipo de elemento, en el orden en que se muestran. */
export const MODES = {
  region: [['fill', 'Relleno'], ['contour', 'Contorno'], ['vcarve', 'Tallado V'], ['cut', 'Recortar'], ['drill', 'Barrenar'], ['invert', 'Invertir'], ['skip', 'Omitir']],
  line: [['line', 'Línea'], ['skip', 'Omitir']],
};

/** Nombre del modo en los comentarios del G-code (sin acentos: muchos controladores no los aceptan). */
export const MODE_NAME = { fill: 'RELLENO', contour: 'CONTORNO', vcarve: 'TALLADO V', cut: 'RECORTE', drill: 'BARRENO', invert: 'INVERTIR', line: 'LINEA', skip: 'OMITIR' };

export const MAX_ELEMENTS = 250;
