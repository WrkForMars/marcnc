import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // rutas relativas: funciona en GitHub Pages bajo /trazo-cnc/ y abriendo dist/ en cualquier servidor
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
