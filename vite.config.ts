import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { readFileSync } from 'fs';

// 读取 package.json 获取版本号
function getVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
    return packageJson.version || '1.0.1';
  } catch (e) {
    console.warn('无法读取 package.json 版本号，使用默认值');
    return '1.0.1';
  }
}

const APP_VERSION = getVersion();

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
        strictPort: true,
        hmr: {
          overlay: true,
        },
      },
      plugins: [
        react(),
        wasm(),
        topLevelAwait(),
        // 为 WASM 文件设置正确的 MIME type，避免 instantiateStreaming 失败
        {
          name: 'wasm-content-type-fix',
          configureServer(server) {
            server.middlewares.use((_req, res, next) => {
              const url = (_req as { url?: string }).url || '';
              if (url.endsWith('.wasm')) {
                res.setHeader('Content-Type', 'application/wasm');
              }
              next();
            });
          },
        },
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.APP_VERSION': JSON.stringify(APP_VERSION),
        'window.__APP_VERSION__': JSON.stringify(APP_VERSION),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
        // 强制所有模块使用同一个 React 实例
        dedupe: [
          'react',
          'react-dom',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
        ],
      },
      optimizeDeps: {
        exclude: [
          '@google/genai',
          // WASM 包不能被 esbuild 预打包，否则 WASM 文件的 import.meta.url 路径会断裂
          'imagequant',
          '@jsquash/oxipng',
          '@jsquash/avif',
          // @gfx/zopfli 将 WASM 内联为 base64，无需排除（且是 CJS 必须被预打包）
        ],
        include: [
          'react', 
          'react-dom',
          'lucide-react',
        ],
      },
      worker: {
        format: 'es',
      },
      build: {
        commonjsOptions: {
          include: [/node_modules/],
          transformMixedEsModules: true,
        },
        minify: 'esbuild',
        target: 'es2020',
        cssCodeSplit: true,
        sourcemap: false,
        cssMinify: 'esbuild',
        // 不使用手动代码分割，让 Vite 自动处理
        // 这可以避免 React 多实例问题
        rollupOptions: {
          output: {
            chunkFileNames: 'assets/js/[name]-[hash:8].js',
            entryFileNames: 'assets/js/[name]-[hash:8].js',
            assetFileNames: 'assets/[ext]/[name]-[hash:8].[ext]',
          },
        },
        chunkSizeWarningLimit: 2000,
        reportCompressedSize: true,
        emptyOutDir: true,
      },
    };
});
