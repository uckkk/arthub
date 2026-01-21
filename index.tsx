import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// 初始化控制台服务（必须在最早导入，以便拦截所有日志）
import './services/consoleService';
// 初始化自动同步（必须在最早导入，以便拦截所有 localStorage 操作）
import { initAutoSync } from './utils/autoSync';

// 初始化自动同步机制（必须在应用启动前初始化）
initAutoSync();

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