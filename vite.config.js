import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_URL || '/',
  // transformers.js bundles onnxruntime-web (ships its own WASM/worker assets);
  // excluding it from dep pre-bundling avoids esbuild choking on those binaries.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
