
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  const backendTarget = env.VITE_BACKEND_URL || 'http://localhost:3000';
  
  return {
    plugins: [react()],
    server: {
      proxy: {
        // Redireciona chamadas /api para o servidor Express localmente ou URL remota configurada
        // Em produção Render, /api pode ser same-origin.
        // Em AI Studio/dev, VITE_BACKEND_URL deve apontar para o backend real.
        // apiClient deve priorizar VITE_BACKEND_URL.
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
        }
      }
    },
    define: {
      // API_KEY removida para segurança
    },
    build: {
      outDir: 'dist',
      // Otimização para performance
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: {
            // Separa bibliotecas comuns em um arquivo de cache separado
            vendor: ['react', 'react-dom', 'recharts', 'lucide-react', '@supabase/supabase-js']
          }
        }
      }
    }
  }
})
