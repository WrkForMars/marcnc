import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // rutas relativas: funciona en GitHub Pages bajo /marcnc/ y abriendo dist/ en cualquier servidor
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
