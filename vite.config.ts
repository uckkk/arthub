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
        },
        // 关键修复：强制所有依赖使用同一个 React 实例
        // 这可以防止 tldraw 及其依赖（radix-ui, tiptap 等）创建多个 React 实例
        dedupe: [
          'react',
          'react-dom',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
        ],
      },
      optimizeDeps: {
        exclude: ['@google/genai'],
        // 预优化 tldraw 及其核心依赖，确保它们正确解析 React
        include: [
          'react', 
          'react-dom', 
          'react/jsx-runtime',
          'lucide-react',
          // tldraw 核心
          'tldraw',
        ],
        // 强制重新优化依赖（解决缓存问题）
        force: false,
      },
      build: {
        commonjsOptions: {
          include: [/node_modules/],
          transformMixedEsModules: true
        },
        // 优化构建性能
        minify: 'esbuild',
        target: 'es2020',
        cssCodeSplit: true,
        sourcemap: false,
        cssMinify: 'esbuild',
        rollupOptions: {
          output: {
            // 修复代码分割策略：确保 React 不会被拆分到多个 chunk
            manualChunks: (id) => {
              if (id.includes('node_modules')) {
                // React 相关必须放在一起，确保单一实例
                if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
                  return 'react-vendor';
                }
                // tldraw 及其所有依赖放在一起
                // 这包括 radix-ui, tiptap, use-gesture 等
                if (
                  id.includes('tldraw') || 
                  id.includes('@tldraw') ||
                  id.includes('@radix-ui') ||
                  id.includes('@tiptap') ||
                  id.includes('@use-gesture') ||
                  id.includes('@floating-ui') ||
                  id.includes('use-sync-external-store')
                ) {
                  return 'tldraw-vendor';
                }
                if (id.includes('lucide-react')) {
                  return 'ui-vendor';
                }
                return 'vendor';
              }
            },
            chunkFileNames: 'assets/js/[name]-[hash:8].js',
            entryFileNames: 'assets/js/[name]-[hash:8].js',
            assetFileNames: 'assets/[ext]/[name]-[hash:8].[ext]',
            compact: true,
          },
          external: [],
        },
        chunkSizeWarningLimit: 1000, // tldraw 较大，提高警告阈值
        reportCompressedSize: true,
        emptyOutDir: true,
      },
    };
});
