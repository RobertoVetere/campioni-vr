import { defineConfig } from 'vite';

// La versión (commit) va dentro del juego, para saber con qué código se grabó cada registro
export default defineConfig({
  define: {
    __COMMIT__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7)),
  },
});
