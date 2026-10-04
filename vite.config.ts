import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/**
 * Vite configuration for PeerPulse.
 *
 * The dev server is intentionally bound to 0.0.0.0 with `allowedHosts` open so the
 * app can be served through container/proxy preview hosts (e.g. *.e2b.app).
 * Tighten `server.allowedHosts` to your own domains for a private deployment.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: Number(env.PORT ?? 5173),
      strictPort: false,
      allowedHosts: true,
      hmr: { clientPort: undefined },
    },
    preview: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.spec.ts', 'tests/unit/**/*.spec.ts'],
      globals: true,
      setupFiles: ['tests/unit/setup.ts'],
    },
  }
})
