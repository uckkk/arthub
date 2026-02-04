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
        include: [
          'react', 
          'react-dom', 
          'lucide-react',
          'tldraw',
        ],
      },
      build: {
        commonjsOptions: {
          include: [/node_modules/],
          transformMixedEsModules: true
        },
        // 优化构建性能 - 更激进的压缩
        minify: 'esbuild', // 使用 esbuild 压缩，速度更快
        target: 'es2020', // 使用 ES2020（更好的兼容性和更小的体积）
        cssCodeSplit: true, // CSS 代码分割
        sourcemap: false, // 生产环境不生成 sourcemap（减少体积）
        cssMinify: 'esbuild', // CSS 也使用 esbuild 压缩
        // 更激进的 tree-shaking
        rollupOptions: {
          output: {
            // 手动代码分割 - 优化加载性能
            manualChunks: (id) => {
              // node_modules 中的依赖
              if (id.includes('node_modules')) {
                if (id.includes('react') || id.includes('react-dom')) {
                  return 'react-vendor';
                }
                if (id.includes('lucide-react')) {
                  return 'ui-vendor';
                }
                // tldraw 相关依赖单独打包
                if (id.includes('tldraw') || id.includes('@tldraw')) {
                  return 'tldraw-vendor';
                }
                // 其他第三方库
                return 'vendor';
              }
            },
            // 优化 chunk 大小和命名
            chunkFileNames: 'assets/js/[name]-[hash:8].js',
            entryFileNames: 'assets/js/[name]-[hash:8].js',
            assetFileNames: 'assets/[ext]/[name]-[hash:8].[ext]',
            // 压缩输出
            compact: true,
          },
          // 外部化不需要打包的依赖（如果有）
          external: [],
        },
        // 提高构建性能
        chunkSizeWarningLimit: 500, // 降低警告阈值，更严格
        // 启用压缩
        reportCompressedSize: true,
        // 减少不必要的输出
        emptyOutDir: true,
      },
    };
});
