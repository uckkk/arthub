import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// 初始化控制台服务（必须在最早导入，以便拦截所有日志）
import './services/consoleService';
// 注意：initAutoSync 已移至 App.tsx 中认证成功后调用，避免未认证时写文件失败

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);