/**
 * ComfyUI ArtHub Extension - Frontend Loader
 * 轮询检查是否有待加载的工作流，并自动加载到界面
 */

import { app } from "../../scripts/app.js";

// 配置
const POLL_INTERVAL = 500; // 轮询间隔（毫秒）
let isPolling = false;
let pollTimer = null;

/**
 * 检查并加载待处理的工作流
 */
async function checkAndLoadWorkflow() {
    try {
        const response = await fetch('/arthub/get_pending_workflow');
        const data = await response.json();
        
        if (data.hasWorkflow && data.workflow) {
            console.log('[ArtHub] Loading workflow from ArtHub...');
            
            // 使用 ComfyUI 的内置方法加载工作流
            await app.loadGraphData(data.workflow);
            
            console.log('[ArtHub] Workflow loaded successfully!');
            
            // 显示成功提示
            showNotification('✅ ArtHub 工作流已加载', 'success');
        }
    } catch (error) {
        // 如果扩展 API 不可用，静默失败
        if (!error.message.includes('404')) {
            console.warn('[ArtHub] Error checking for workflow:', error);
        }
    }
}

/**
 * 显示通知
 */
function showNotification(message, type = 'info') {
    // 尝试使用 ComfyUI 的通知系统
    if (app.ui && app.ui.dialog) {
        app.ui.dialog.show(message);
        setTimeout(() => app.ui.dialog.close(), 3000);
    } else {
        // 使用简单的 DOM 通知
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            background: ${type === 'success' ? '#4CAF50' : '#2196F3'};
            color: white;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
        `;
        
        // 添加动画样式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(notification);
        
        // 3秒后移除
        setTimeout(() => {
            notification.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

/**
 * 开始轮询
 */
function startPolling() {
    if (isPolling) return;
    isPolling = true;
    
    console.log('[ArtHub] Starting workflow polling...');
    
    pollTimer = setInterval(checkAndLoadWorkflow, POLL_INTERVAL);
}

/**
 * 停止轮询
 */
function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    isPolling = false;
}

/**
 * 注册扩展
 */
app.registerExtension({
    name: "ArtHub.WorkflowLoader",
    
    async setup() {
        console.log('[ArtHub] Extension initialized');
        
        // 检查扩展 API 是否可用
        try {
            const response = await fetch('/arthub/status');
            const data = await response.json();
            
            if (data.installed) {
                console.log(`[ArtHub] Backend connected: ${data.name} v${data.version}`);
                startPolling();
            }
        } catch (error) {
            console.log('[ArtHub] Backend not available, polling disabled');
        }
    },
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // 可以在这里添加自定义节点
    }
});

// 页面卸载时停止轮询
window.addEventListener('beforeunload', stopPolling);

console.log('[ArtHub] Workflow loader script loaded');
