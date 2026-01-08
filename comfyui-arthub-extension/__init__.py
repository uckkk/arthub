"""
ComfyUI ArtHub Extension
允许 ArtHub 应用直接加载工作流到 ComfyUI 界面
"""

import os
import json
import server
from aiohttp import web

# 存储待加载的工作流
pending_workflow = {"data": None, "loaded": False}

# API 路由：加载工作流
@server.PromptServer.instance.routes.post("/arthub/load_workflow")
async def load_workflow(request):
    """接收工作流 JSON 并标记为待加载"""
    global pending_workflow
    try:
        data = await request.json()
        pending_workflow["data"] = data
        pending_workflow["loaded"] = False
        print("[ArtHub Extension] Workflow received, waiting for frontend to load...")
        return web.json_response({"success": True, "message": "Workflow queued for loading"})
    except Exception as e:
        print(f"[ArtHub Extension] Error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=400)

# API 路由：获取待加载的工作流
@server.PromptServer.instance.routes.get("/arthub/get_pending_workflow")
async def get_pending_workflow(request):
    """前端轮询获取待加载的工作流"""
    global pending_workflow
    if pending_workflow["data"] and not pending_workflow["loaded"]:
        workflow = pending_workflow["data"]
        pending_workflow["loaded"] = True
        return web.json_response({"hasWorkflow": True, "workflow": workflow})
    return web.json_response({"hasWorkflow": False})

# API 路由：检查扩展状态
@server.PromptServer.instance.routes.get("/arthub/status")
async def status(request):
    """检查扩展是否安装"""
    return web.json_response({
        "installed": True, 
        "version": "1.0.0",
        "name": "ComfyUI ArtHub Extension"
    })

# 注册 Web 目录（用于前端 JavaScript）
WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

print("[ArtHub Extension] Loaded successfully! API endpoints:")
print("  - POST /arthub/load_workflow")
print("  - GET /arthub/get_pending_workflow")
print("  - GET /arthub/status")
