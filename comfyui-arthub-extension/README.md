# ComfyUI ArtHub Extension

这是一个 ComfyUI 扩展，允许 ArtHub 应用直接加载工作流到 ComfyUI 界面。

## 安装方法

1. 将 `comfyui-arthub-extension` 文件夹复制到 ComfyUI 的 `custom_nodes` 目录下
2. 重启 ComfyUI

## 使用方法

ArtHub 会自动通过 HTTP API 将工作流发送到 ComfyUI，无需手动操作。

## API 端点

- `POST /arthub/load_workflow` - 加载工作流到界面
- `GET /arthub/status` - 检查扩展是否安装

## 技术原理

1. Python 后端注册 API 路由
2. JavaScript 前端监听消息并调用 `app.loadGraphData()`
3. 工作流自动加载到 ComfyUI 画布
