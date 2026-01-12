import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
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
      base: './', // 使用相对路径，可以直接打开 HTML 文件
      server: {
        port: 3000,
        host: '0.0.0.0',
        strictPort: true, // Tauri 需要固定端口
        hmr: {
          overlay: true, // 显示错误覆盖层
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.APP_VERSION': JSON.stringify(APP_VERSION),
        'window.__APP_VERSION__': JSON.stringify(APP_VERSION),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      optimizeDeps: {
        exclude: ['@google/genai'],
        include: ['react', 'react-dom', 'lucide-react'],
      },
      build: {
        commonjsOptions: {
          include: [/node_modules/],
          transformMixedEsModules: true
        },
        // 优化构建性能
        minify: 'esbuild', // 使用 esbuild 压缩，速度更快
        target: 'esnext', // 使用最新的 ES 特性
        cssCodeSplit: true, // CSS 代码分割
        sourcemap: false, // 生产环境不生成 sourcemap（提升性能）
        rollupOptions: {
          output: {
            // 手动代码分割
            manualChunks: {
              'react-vendor': ['react', 'react-dom'],
              'ui-vendor': ['lucide-react'],
            },
            // 优化 chunk 大小
            chunkFileNames: 'assets/js/[name]-[hash].js',
            entryFileNames: 'assets/js/[name]-[hash].js',
            assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
          },
        },
        // 提高构建性能
        chunkSizeWarningLimit: 1000,
      },
    };
});
