// Dibujo de ejemplo (original): etiqueta con tres huecos, estrella y un trazo.
// viewBox de 90 × 50 = la pieza de la tarea, para usarlo a escala 1:1.
export const DEMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 50">
 <path fill="#222" fill-rule="evenodd" d="M8 4h48a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z M18 20m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0z M46 20m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0z M27 16h10v8H27z"/>
 <polygon fill="#222" points="76,4 79.2,12.6 88.3,13 81.2,18.7 83.6,27.5 76,22.4 68.4,27.5 70.8,18.7 63.7,13 72.8,12.6"/>
 <path fill="none" stroke="#222" stroke-width="1.2" d="M66 34 C70 30, 74 38, 78 34 S86 30, 88 34"/>
</svg>`;

export const DEMO_TEXT = { text: 'LADO B', font: 'futural', h: 5, sp: 0, x: 24, y: 7 };
