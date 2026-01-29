
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    server: {
      proxy: {
        // Redireciona chamadas /api para o servidor Express localmente
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        }
      }
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
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
