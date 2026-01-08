/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.tsx",
    "./index.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./services/**/*.{js,ts,jsx,tsx}",
    "./utils/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ComfyUI 风格的深色主题
        comfy: {
          bg: {
            primary: '#0a0a0a',      // 最深背景
            secondary: '#0f0f0f',    // 次级背景
            tertiary: '#151515',     // 三级背景
            card: '#1a1a1a',         // 卡片背景
            hover: '#222222',        // 悬停背景
            elevated: '#252525',     // 提升背景
          },
          border: {
            DEFAULT: '#2a2a2a',      // 默认边框
            light: '#333333',        // 浅色边框
            focus: '#3b82f6',        // 聚焦边框
          },
          text: {
            primary: '#ffffff',      // 主要文字
            secondary: '#a0a0a0',    // 次要文字
            muted: '#666666',        // 静音文字
            accent: '#3b82f6',       // 强调文字
          },
          accent: {
            blue: '#3b82f6',
            purple: '#8b5cf6',
            green: '#22c55e',
            orange: '#f97316',
            pink: '#ec4899',
            cyan: '#06b6d4',
            red: '#ef4444',
            yellow: '#eab308',
          },
          // 标签颜色
          tag: {
            product: { bg: '#1e3a5f', text: '#60a5fa' },
            api: { bg: '#1e3a3a', text: '#2dd4bf' },
            replacement: { bg: '#3a1e5f', text: '#a78bfa' },
            image: { bg: '#3a2e1e', text: '#fbbf24' },
            video: { bg: '#1e3a2e', text: '#4ade80' },
            design: { bg: '#3a1e3a', text: '#f472b6' },
          }
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Microsoft YaHei',
          'PingFang SC',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      borderRadius: {
        'comfy': '8px',
        'comfy-lg': '12px',
        'comfy-xl': '16px',
      },
      boxShadow: {
        'comfy': '0 4px 12px rgba(0, 0, 0, 0.4)',
        'comfy-lg': '0 8px 24px rgba(0, 0, 0, 0.5)',
        'comfy-glow': '0 0 20px rgba(59, 130, 246, 0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
      },
    },
  },
  plugins: [],
}
