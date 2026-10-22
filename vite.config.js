import { defineConfig } from 'vite';

// o motor (npm run motor) serve o estado e recebe as ações; o escritório fala com ele pelo mesmo endereço
const MOTOR = process.env.MOTOR_URL || 'http://127.0.0.1:8787';

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': MOTOR, '/status.json': MOTOR },
    // o motor grava o estado e a conta Claude (motor/conta-claude) o tempo todo; não é código da tela
    watch: { ignored: ['**/motor/**'] },
  },
  build: { chunkSizeWarningLimit: 1200 },
});
