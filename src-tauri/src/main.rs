// Prevents additional console window on Windows
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use tauri::{Manager, WindowBuilder, PhysicalPosition};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use winapi::um::winuser::{MonitorFromPoint, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST};
#[cfg(target_os = "windows")]
use winapi::shared::windef::POINT;
#[cfg(target_os = "windows")]
use winapi::um::winuser::MONITORINFO;
#[cfg(target_os = "windows")]
use winapi::um::synchapi::CreateMutexA;
#[cfg(target_os = "windows")]
use winapi::um::handleapi::{INVALID_HANDLE_VALUE, CloseHandle};
#[cfg(target_os = "windows")]
use winapi::um::errhandlingapi::GetLastError;
#[cfg(target_os = "windows")]
use winapi::shared::minwindef::FALSE;
#[cfg(target_os = "windows")]
use std::mem;
#[cfg(target_os = "windows")]
use std::ffi::CString;
#[cfg(target_os = "windows")]
use std::ptr;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IconPosition {
    x: i32,
    y: i32,
}

// 全局状态
struct AppState {
    icon_position: Mutex<IconPosition>,
    is_dragging: Mutex<bool>,
    drag_start_mouse: Mutex<IconPosition>,  // 拖拽开始时鼠标的屏幕坐标
    drag_start_window: Mutex<IconPosition>, // 拖拽开始时窗口的位置
    ai_tabs: Mutex<Vec<String>>, // 存储AI标签页窗口标签
}

const ICON_SIZE: i32 = 64;
const SNAP_THRESHOLD: i32 = 20;

// 创建悬浮图标窗口
fn create_icon_window(app: &tauri::AppHandle) -> Result<tauri::Window, Box<dyn std::error::Error>> {
    let state = app.state::<AppState>();
    let position = state.icon_position.lock().unwrap();
    
    // 确保初始位置在可见区域内（使用物理坐标）
    let (init_x, init_y) = if position.x == 0 && position.y == 0 {
        // 默认位置：屏幕右侧，垂直居中
        #[cfg(target_os = "windows")]
        {
            // 获取主屏幕尺寸（物理像素）
            if let Some((screen_x, screen_y, screen_width, screen_height)) = get_screen_bounds_for_position(100, 100) {
                let x = screen_x + screen_width - ICON_SIZE - 20; // 屏幕右边缘内侧 20px
                let y = screen_y + (screen_height / 2) - (ICON_SIZE / 2); // 垂直居中
                println!("Using default position (physical): x={}, y={}", x, y);
                (x, y)
            } else {
                // 如果获取屏幕信息失败，使用固定默认值
                (100, 300)
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            (100, 300)
        }
    } else {
        (position.x, position.y)
    };
    
    println!("Creating icon window at physical position: x={}, y={}", init_x, init_y);
    
    // 在开发模式下使用开发服务器，生产模式下使用应用资源
    let icon_url = if cfg!(debug_assertions) {
        tauri::WindowUrl::External("http://localhost:3000/icon.html".parse().unwrap())
    } else {
        tauri::WindowUrl::App("icon.html".into())
    };
    
    // 先创建窗口（使用临时位置）
    let mut builder = WindowBuilder::new(
        app,
        "icon",
        icon_url
    )
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(true)
    .inner_size(ICON_SIZE as f64, ICON_SIZE as f64)
    .title("");
    
    // Windows 上启用透明背景
    #[cfg(target_os = "windows")]
    {
        builder = builder.transparent(true);
    }
    
    let icon_window = builder.build()?;
    
    // 使用物理坐标设置正确的位置（避免 DPI 缩放问题）
    if let Err(e) = icon_window.set_position(PhysicalPosition::new(init_x, init_y)) {
        eprintln!("Warning: Failed to set icon position: {:?}", e);
    }
    
    // 显式显示窗口
    let _ = icon_window.show();
    let _ = icon_window.set_focus();
    
    println!("Icon window created and shown successfully at ({}, {})", init_x, init_y);
    
    Ok(icon_window)
}

// 获取包含指定坐标的屏幕边界（支持多屏幕）
#[cfg(target_os = "windows")]
fn get_screen_bounds_for_position(x: i32, y: i32) -> Option<(i32, i32, i32, i32)> {
    unsafe {
        let point = POINT { x, y };
        let hmonitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        
        if hmonitor.is_null() {
            return None;
        }
        
        let mut monitor_info: MONITORINFO = mem::zeroed();
        monitor_info.cbSize = mem::size_of::<MONITORINFO>() as u32;
        
        if GetMonitorInfoW(hmonitor, &mut monitor_info) != 0 {
            let rect = monitor_info.rcWork; // 工作区域（排除任务栏）
            return Some((
                rect.left,
                rect.top,
                rect.right - rect.left,  // width
                rect.bottom - rect.top,  // height
            ));
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn get_screen_bounds_for_position(_x: i32, _y: i32) -> Option<(i32, i32, i32, i32)> {
    None
}

// 边缘吸附逻辑（支持多屏幕）
fn snap_to_edge(x: i32, y: i32, icon_size: i32) -> (i32, i32) {
    let threshold = SNAP_THRESHOLD;
    
    // 获取当前坐标所在的屏幕边界
    if let Some((screen_x, screen_y, screen_width, screen_height)) = get_screen_bounds_for_position(x, y) {
        let mut new_x = x;
        let mut new_y = y;
        
        // 相对于屏幕的坐标
        let rel_x = x - screen_x;
        let rel_y = y - screen_y;
        
        // 吸附到左边缘
        if rel_x < threshold {
            new_x = screen_x;
        }
        
        // 吸附到右边缘
        if rel_x + icon_size > screen_width - threshold {
            new_x = screen_x + screen_width - icon_size;
        }
        
        // 吸附到上边缘
        if rel_y < threshold {
            new_y = screen_y;
        }
        
        // 吸附到下边缘
        if rel_y + icon_size > screen_height - threshold {
            new_y = screen_y + screen_height - icon_size;
        }
        
        (new_x, new_y)
    } else {
        // 如果无法获取屏幕信息，使用简化逻辑
        let mut new_x = x;
        let mut new_y = y;
        
        if x < threshold {
            new_x = 0;
        }
        if y < threshold {
            new_y = 0;
        }
        
        (new_x, new_y)
    }
}

// 确保图标在可见区域内（支持多屏幕）
fn constrain_to_visible_area(x: i32, y: i32, icon_size: i32) -> (i32, i32) {
    // 获取当前坐标所在的屏幕边界
    if let Some((screen_x, screen_y, screen_width, screen_height)) = get_screen_bounds_for_position(x, y) {
        let mut new_x = x.max(screen_x);
        let mut new_y = y.max(screen_y);
        
        // 确保窗口不完全超出屏幕
        new_x = new_x.min(screen_x + screen_width - icon_size);
        new_y = new_y.min(screen_y + screen_height - icon_size);
        
        (new_x, new_y)
    } else {
        // 如果无法获取屏幕信息，使用简化逻辑
        (x.max(0), y.max(0))
    }
}

// 保存图标位置
fn save_icon_position(app: &tauri::AppHandle, x: i32, y: i32) {
    let state = app.state::<AppState>();
    let mut position = state.icon_position.lock().unwrap();
    position.x = x;
    position.y = y;
    
    // 保存到文件（使用 Tauri 的 app_data_dir）
    if let Some(app_data_dir) = app.path_resolver().app_data_dir() {
        let config_path = app_data_dir.join("icon_position.json");
        if let Ok(json) = serde_json::to_string(&*position) {
            let _ = std::fs::write(config_path, json);
        }
    }
}

// 加载图标位置
fn load_icon_position(app: &tauri::AppHandle) -> IconPosition {
    if let Some(app_data_dir) = app.path_resolver().app_data_dir() {
        let config_path = app_data_dir.join("icon_position.json");
        if let Ok(content) = std::fs::read_to_string(config_path) {
            if let Ok(position) = serde_json::from_str::<IconPosition>(&content) {
                return position;
            }
        }
    }
    
    // 默认位置：屏幕左上角
    IconPosition { x: 0, y: 0 }
}

// Tauri 命令：图标鼠标按下
#[tauri::command]
fn icon_mouse_down(app: tauri::AppHandle, x: f64, y: f64) {
    println!("icon_mouse_down called: x={}, y={}", x, y);
    let state = app.state::<AppState>();
    let mut is_dragging = state.is_dragging.lock().unwrap();
    *is_dragging = true;
    println!("is_dragging set to true");
    
    // 保存鼠标初始位置和鼠标相对于窗口的偏移
    if let Some(icon_window) = app.get_window("icon") {
        if let Ok(current_pos) = icon_window.outer_position() {
            // 保存鼠标初始位置
            let mut mouse_start = state.drag_start_mouse.lock().unwrap();
            mouse_start.x = x as i32;
            mouse_start.y = y as i32;
            
            // 保存鼠标相对于窗口的偏移（用于后续拖动计算）
            let mut window_start = state.drag_start_window.lock().unwrap();
            window_start.x = x as i32 - current_pos.x;  // 鼠标相对于窗口的X偏移
            window_start.y = y as i32 - current_pos.y;  // 鼠标相对于窗口的Y偏移
            
            println!("Mouse start: ({}, {}), Window offset: ({}, {})", 
                     mouse_start.x, mouse_start.y, window_start.x, window_start.y);
        } else {
            println!("Failed to get icon window position");
        }
    } else {
        println!("Icon window not found!");
    }
}

// Tauri 命令：图标鼠标移动
#[tauri::command]
fn icon_mouse_move(app: tauri::AppHandle, x: f64, y: f64) {
    let state = app.state::<AppState>();
    let is_dragging = state.is_dragging.lock().unwrap();
    
    if *is_dragging {
        if let Some(icon_window) = app.get_window("icon") {
            // 获取鼠标相对于窗口的偏移（在 mouse_down 时保存）
            let window_offset = state.drag_start_window.lock().unwrap();
            
            // 计算窗口新位置（鼠标位置 - 鼠标相对于窗口的偏移）
            // 这样可以确保窗口始终跟随鼠标，保持固定的相对位置
            let new_x = x as i32 - window_offset.x;
            let new_y = y as i32 - window_offset.y;
            
            // 设置窗口新位置
            if let Err(e) = icon_window.set_position(PhysicalPosition::new(new_x, new_y)) {
                eprintln!("Failed to set icon position: {:?}", e);
            }
        } else {
            println!("Icon window not found in icon_mouse_move");
        }
    } else {
        println!("Not dragging in icon_mouse_move");
    }
}

// Tauri 命令：图标鼠标释放
#[tauri::command]
fn icon_mouse_up(app: tauri::AppHandle, x: f64, y: f64) {
    println!("icon_mouse_up called: x={}, y={}", x, y);
    let state = app.state::<AppState>();
    let mut is_dragging = state.is_dragging.lock().unwrap();
    *is_dragging = false;
    println!("is_dragging set to false");
    
    if let Some(icon_window) = app.get_window("icon") {
        if let Ok(current_pos) = icon_window.outer_position() {
            println!("Current window position before snap: ({}, {})", current_pos.x, current_pos.y);
            
            // 边缘吸附（使用当前窗口位置）
            let snapped = snap_to_edge(current_pos.x, current_pos.y, ICON_SIZE);
            println!("After snap: ({}, {})", snapped.0, snapped.1);
            
            // 确保在可见区域内
            let constrained = constrain_to_visible_area(snapped.0, snapped.1, ICON_SIZE);
            println!("After constrain: ({}, {})", constrained.0, constrained.1);
            
            if let Err(e) = icon_window.set_position(PhysicalPosition::new(constrained.0, constrained.1)) {
                eprintln!("Failed to set icon position: {:?}", e);
            } else {
                println!("Icon position set to: x={}, y={}", constrained.0, constrained.1);
                save_icon_position(&app, constrained.0, constrained.1);
            }
        } else {
            println!("Failed to get current window position in icon_mouse_up");
        }
    } else {
        println!("Icon window not found in icon_mouse_up");
    }
}

// Tauri 命令：点击图标
#[tauri::command]
fn icon_click(app: tauri::AppHandle) {
    println!("Icon clicked!");
    if let Some(main_window) = app.get_window("main") {
        match main_window.is_visible() {
            Ok(true) => {
                println!("Main window is visible, closing...");
                let _ = main_window.hide();
            }
            Ok(false) => {
                println!("Main window is hidden, opening...");
                animate_window_open(&app, main_window);
            }
            Err(e) => {
                println!("Error checking visibility: {:?}", e);
                // 尝试显示窗口
                animate_window_open(&app, main_window);
            }
        }
    } else {
        println!("Main window not found!");
    }
}

// 窗口打开动画
fn animate_window_open(_app: &tauri::AppHandle, main_window: tauri::Window) {
    println!("Opening main window...");
    
    // 先检查当前状态
    match main_window.is_visible() {
        Ok(visible) => println!("Main window visibility before show: {}", visible),
        Err(e) => println!("Error checking visibility before show: {:?}", e),
    }
    
    // 显示并聚焦窗口
    match main_window.show() {
        Ok(_) => println!("Main window show() called successfully"),
        Err(e) => {
            println!("Error showing window: {:?}", e);
            return;
        }
    }
    
    // 等待一小段时间确保窗口显示
    std::thread::sleep(std::time::Duration::from_millis(50));
    
    match main_window.set_focus() {
        Ok(_) => println!("Main window focused successfully"),
        Err(e) => println!("Error focusing window: {:?}", e),
    }
    
    // 再次检查窗口可见性
    match main_window.is_visible() {
        Ok(visible) => println!("Main window visibility after show: {}", visible),
        Err(e) => println!("Error checking visibility after show: {:?}", e),
    }
    
    // 尝试居中窗口
    if let Err(e) = main_window.center() {
        println!("Error centering window: {:?}", e);
    }
}

// 窗口关闭动画
#[allow(dead_code)]
fn animate_window_close(_app: &tauri::AppHandle, main_window: tauri::Window) {
    println!("Closing main window...");
    let _ = main_window.hide();
    println!("Main window hidden");
}

// Tauri 命令：退出应用
#[tauri::command]
fn app_exit(app: tauri::AppHandle) {
    println!("App exit requested");
    app.exit(0);
}

// Tauri 命令：打开AI标签页窗口
#[tauri::command]
async fn open_ai_tab(
    app: tauri::AppHandle,
    url: String,
    title: String,
    json_content: Option<String>,
    json_file_path: Option<String>,
    config_id: String,
) -> Result<String, String> {
    use tauri::WindowUrl;
    
    println!("Opening AI tab: {} - {}", title, url);
    
    // 使用前端传递的JSON内容（前端已经读取了文件）
    let json_content_final = json_content;
    
    if json_file_path.is_some() {
        println!("JSON file path provided: {:?}", json_file_path);
    }
    
    if json_content_final.is_some() {
        println!("JSON content length: {}", json_content_final.as_ref().unwrap().len());
    }
    
    // 生成唯一的窗口标签
    let window_label = format!("ai_tab_{}", config_id);
    
    // 检查窗口是否已存在
    if let Some(existing_window) = app.get_window(&window_label) {
        // 窗口已存在，聚焦并刷新，同时重新注入JSON
        let _ = existing_window.set_focus();
        let _ = existing_window.eval(&format!("window.location.href = '{}';", url));
        
        // 如果有新的JSON内容，重新注入（清除旧的并注入新的）
        if let Some(json) = json_content_final {
            let json_clone = json.clone();
            let window_clone = existing_window.clone();
            
            // 使用异步任务等待页面加载并注入新的JSON
            tauri::async_runtime::spawn(async move {
                // 等待页面刷新
                tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                
                // 使用base64编码JSON
                use base64::{Engine as _, engine::general_purpose};
                let json_base64 = general_purpose::STANDARD.encode(&json_clone);
                
                // 创建注入脚本 - 清除旧数据并注入新JSON
                let injection_script = format!(
                    r#"
                    (function() {{
                        // 清除旧的JSON数据
                        try {{
                            localStorage.removeItem('arthub_injected_json');
                            delete window.arthubInjectedJSON;
                            delete window.arthubInjectedJSONString;
                        }} catch(e) {{
                            console.warn('[ArtHub] Failed to clear old JSON:', e);
                        }}
                        
                        function injectJSON() {{
                            try {{
                                const jsonBase64 = "{}";
                                let jsonString, jsonData;
                                
                                try {{
                                    jsonString = atob(jsonBase64);
                                    jsonData = JSON.parse(jsonString);
                                    console.log('[ArtHub] New JSON decoded and parsed successfully');
                                }} catch(e) {{
                                    console.error('[ArtHub] Failed to decode/parse JSON:', e);
                                    jsonString = jsonBase64;
                                    jsonData = null;
                                }}
                                
                                // 注入新的JSON到localStorage和window对象
                                try {{
                                    if (jsonString) {{
                                        localStorage.setItem('arthub_injected_json', jsonString);
                                        window.arthubInjectedJSONString = jsonString;
                                        if (jsonData) {{
                                            window.arthubInjectedJSON = jsonData;
                                        }}
                                        console.log('[ArtHub] New JSON injected to storage');
                                    }}
                                }} catch(e) {{
                                    console.warn('[ArtHub] Storage injection failed:', e);
                                }}
                                
                                // 自动查找并填充输入框
                                function autoFillInput() {{
                                    const selectors = [
                                        'textarea',
                                        'input[type="text"]',
                                        'input[type="search"]',
                                        '[contenteditable="true"]',
                                        '[role="textbox"]',
                                        '.monaco-editor textarea',
                                        '.CodeMirror textarea',
                                        'pre[contenteditable]'
                                    ]}};
                                    
                                    for (const selector of selectors) {{
                                        const elements = document.querySelectorAll(selector);
                                        for (const el of elements) {{
                                            const style = window.getComputedStyle(el);
                                            if (style.display !== 'none' && style.visibility !== 'hidden') {{
                                                try {{
                                                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {{
                                                        (el as HTMLInputElement).value = jsonString;
                                                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                                                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                                        console.log('[ArtHub] New JSON filled into input/textarea');
                                                        return true;
                                                    }} else if (el.isContentEditable || el.tagName === 'PRE') {{
                                                        el.textContent = jsonString;
                                                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                                                        console.log('[ArtHub] New JSON filled into contenteditable');
                                                        return true;
                                                    }}
                                                }} catch(e) {{
                                                    console.warn('[ArtHub] Fill failed for element:', e);
                                                }}
                                            }}
                                        }}
                                    }}
                                    return false;
                                }}
                                
                                // 立即尝试填充
                                if (!autoFillInput()) {{
                                    // 如果失败，延迟重试
                                    setTimeout(() => autoFillInput(), 500);
                                    setTimeout(() => autoFillInput(), 1500);
                                    setTimeout(() => autoFillInput(), 3000);
                                    setTimeout(() => autoFillInput(), 5000);
                                }}
                                
                                console.log('%c[ArtHub] 新JSON已自动注入！', 'color: #00ff00; font-weight: bold;');
                            }} catch(e) {{
                                console.error('[ArtHub] JSON injection error:', e);
                            }}
                        }}
                        
                        // 立即尝试注入
                        injectJSON();
                        
                        // 监听页面加载事件
                        if (document.readyState === 'loading') {{
                            document.addEventListener('DOMContentLoaded', injectJSON);
                        }}
                        window.addEventListener('load', injectJSON);
                        
                        // 延迟注入，确保页面完全加载
                        setTimeout(injectJSON, 2000);
                        setTimeout(injectJSON, 5000);
                    }})();
                    "#,
                    json_base64
                );
                
                // 重试机制：尝试多次注入
                let mut retry_count = 0;
                let max_retries = 10;
                
                while retry_count < max_retries {
                    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
                    
                    match window_clone.eval(&injection_script) {
                        Ok(_) => {
                            println!("[ArtHub] JSON re-injection successful (attempt {})", retry_count + 1);
                            if retry_count >= 2 {
                                break;
                            }
                        }
                        Err(e) => {
                            println!("[ArtHub] Re-injection attempt {} failed: {:?}", retry_count + 1, e);
                        }
                    }
                    
                    retry_count += 1;
                }
            });
        }
        
        return Ok(window_label);
    }
    
    // 创建新窗口
    let window = tauri::WindowBuilder::new(
        &app,
        &window_label,
        WindowUrl::External(url.parse().map_err(|e| format!("Invalid URL: {}", e))?)
    )
    .title(&title)
    .inner_size(1200.0, 800.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to create window: {:?}", e))?;
    
    // 记录标签页
    if let Ok(mut tabs) = app.state::<AppState>().ai_tabs.lock() {
        tabs.push(window_label.clone());
    }
    
    // 如果有JSON内容，自动注入到页面
    if let Some(json_content) = json_content_final {
        let json_clone = json_content.clone();
        let window_clone = window.clone();
        
        // 使用异步任务等待页面加载并注入JSON
        tauri::async_runtime::spawn(async move {
            // 等待窗口显示和页面开始加载
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            
            // 使用base64编码JSON，避免转义问题
            use base64::{Engine as _, engine::general_purpose};
            let json_base64 = general_purpose::STANDARD.encode(&json_clone);
            
            // 创建注入脚本 - 自动查找输入框并填充JSON
            let injection_script = format!(
                r#"
                (function() {{
                    function injectJSON() {{
                        try {{
                            const jsonBase64 = "{}";
                            let jsonString, jsonData;
                            
                            try {{
                                jsonString = atob(jsonBase64);
                                jsonData = JSON.parse(jsonString);
                                console.log('[ArtHub] JSON decoded and parsed successfully');
                            }} catch(e) {{
                                console.error('[ArtHub] Failed to decode/parse JSON:', e);
                                jsonString = jsonBase64;
                                jsonData = null;
                            }}
                            
                            // 清除旧的JSON数据（确保使用新的）
                            try {{
                                localStorage.removeItem('arthub_injected_json');
                                delete window.arthubInjectedJSON;
                                delete window.arthubInjectedJSONString;
                            }} catch(e) {{
                                console.warn('[ArtHub] Failed to clear old JSON:', e);
                            }}
                            
                            // 注入新的JSON到localStorage和window对象
                            try {{
                                if (jsonString) {{
                                    localStorage.setItem('arthub_injected_json', jsonString);
                                    window.arthubInjectedJSONString = jsonString;
                                    if (jsonData) {{
                                        window.arthubInjectedJSON = jsonData;
                                    }}
                                    console.log('[ArtHub] JSON injected to storage');
                                }}
                            }} catch(e) {{
                                console.warn('[ArtHub] Storage injection failed:', e);
                            }}
                            
                            // 自动查找并填充输入框
                            function autoFillInput() {{
                                const selectors = [
                                    'textarea',
                                    'input[type="text"]',
                                    'input[type="search"]',
                                    '[contenteditable="true"]',
                                    '[role="textbox"]',
                                    '.monaco-editor textarea',
                                    '.CodeMirror textarea',
                                    'pre[contenteditable]'
                                ];
                                
                                for (const selector of selectors) {{
                                    const elements = document.querySelectorAll(selector);
                                    for (const el of elements) {{
                                        const style = window.getComputedStyle(el);
                                        if (style.display !== 'none' && style.visibility !== 'hidden') {{
                                            try {{
                                                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {{
                                                    (el as HTMLInputElement).value = jsonString;
                                                    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                                                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                                    console.log('[ArtHub] JSON filled into input/textarea');
                                                    return true;
                                                }} else if (el.isContentEditable || el.tagName === 'PRE') {{
                                                    el.textContent = jsonString;
                                                    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                                                    console.log('[ArtHub] JSON filled into contenteditable');
                                                    return true;
                                                }}
                                            }} catch(e) {{
                                                console.warn('[ArtHub] Fill failed for element:', e);
                                            }}
                                        }}
                                    }}
                                }}
                                return false;
                            }}
                            
                            // 立即尝试填充
                            if (!autoFillInput()) {{
                                // 如果失败，延迟重试
                                setTimeout(() => autoFillInput(), 500);
                                setTimeout(() => autoFillInput(), 1500);
                                setTimeout(() => autoFillInput(), 3000);
                                setTimeout(() => autoFillInput(), 5000);
                            }}
                            
                            console.log('%c[ArtHub] JSON已自动注入！', 'color: #00ff00; font-weight: bold;');
                        }} catch(e) {{
                            console.error('[ArtHub] JSON injection error:', e);
                        }}
                    }}
                    
                    // 立即尝试注入
                    injectJSON();
                    
                    // 监听页面加载事件
                    if (document.readyState === 'loading') {{
                        document.addEventListener('DOMContentLoaded', injectJSON);
                    }}
                    window.addEventListener('load', injectJSON);
                    
                    // 延迟注入，确保页面完全加载
                    setTimeout(injectJSON, 2000);
                    setTimeout(injectJSON, 5000);
                }})();
                "#,
                json_base64
            );
            
            // 重试机制：尝试多次注入
            let mut retry_count = 0;
            let max_retries = 10;
            
            while retry_count < max_retries {
                // 等待页面加载
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
                
                // 尝试执行注入脚本
                match window_clone.eval(&injection_script) {
                    Ok(_) => {
                        println!("[ArtHub] JSON injection script executed successfully (attempt {})", retry_count + 1);
                        if retry_count >= 2 {
                            break;
                        }
                    }
                    Err(e) => {
                        println!("[ArtHub] Injection attempt {} failed: {:?}", retry_count + 1, e);
                        // 如果是范围错误，说明需要配置远程域访问
                        if e.to_string().contains("Scope not defined") {
                            eprintln!("[ArtHub] Warning: Remote domain access not configured. Please configure tauri.conf.json");
                            break;
                        }
                    }
                }
                
                retry_count += 1;
            }
        });
    }
    
    Ok(window_label)
}

// Tauri 命令：模拟 Ctrl+V 粘贴操作
#[tauri::command]
async fn simulate_paste(delay_ms: u64) -> Result<(), String> {
    println!("[ArtHub] simulate_paste called with delay: {}ms", delay_ms);
    
    // 等待指定的延迟时间，让浏览器窗口加载
    tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
    
    println!("[ArtHub] Delay completed, attempting to send Ctrl+V...");
    
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winuser::{VK_CONTROL, keybd_event};
        
        // 定义虚拟键码
        const VK_V: u16 = 0x56;
        
        // 尝试多次发送，以确保成功
        for attempt in 0..3 {
            if attempt > 0 {
                println!("[ArtHub] Retry attempt {}", attempt + 1);
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            
            unsafe {
                // 方法1：使用 keybd_event（更兼容但已弃用）
                // 按下 Ctrl
                keybd_event(VK_CONTROL as u8, 0, 0, 0);
                std::thread::sleep(std::time::Duration::from_millis(50));
                
                // 按下 V
                keybd_event(VK_V as u8, 0, 0, 0);
                std::thread::sleep(std::time::Duration::from_millis(50));
                
                // 释放 V
                keybd_event(VK_V as u8, 0, 2, 0); // KEYEVENTF_KEYUP = 2
                std::thread::sleep(std::time::Duration::from_millis(50));
                
                // 释放 Ctrl
                keybd_event(VK_CONTROL as u8, 0, 2, 0);
                
                println!("[ArtHub] Sent Ctrl+V using keybd_event (attempt {})", attempt + 1);
            }
        }
        
        println!("[ArtHub] Simulated Ctrl+V paste operation completed");
        return Ok(());
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Keyboard simulation is only supported on Windows".to_string());
    }
}

// Tauri 命令：将工作流发送到 ComfyUI 服务器（绕过 CORS）
#[tauri::command]
async fn send_workflow_to_comfyui(
    comfy_url: String,
    workflow_json: String,
) -> Result<String, String> {
    println!("[ArtHub] Sending workflow to ComfyUI: {}", comfy_url);
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    // 方案1（最佳）：尝试 ArtHub 扩展 API
    let extension_url = format!("{}/arthub/load_workflow", comfy_url);
    println!("[ArtHub] Trying ArtHub extension API: {}", extension_url);
    
    match client.post(&extension_url)
        .header("Content-Type", "application/json")
        .body(workflow_json.clone())
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                println!("[ArtHub] Workflow sent to ArtHub extension successfully!");
                return Ok("extension".to_string());
            } else {
                println!("[ArtHub] ArtHub extension API returned status: {}", response.status());
            }
        }
        Err(e) => {
            println!("[ArtHub] ArtHub extension not installed or not reachable: {:?}", e);
        }
    }
    
    // 方案2：通过 userdata API 保存工作流
    let userdata_url = format!("{}/api/userdata/workflows/arthub_current.json", comfy_url);
    println!("[ArtHub] Trying userdata API: {}", userdata_url);
    
    match client.post(&userdata_url)
        .header("Content-Type", "application/json")
        .body(workflow_json.clone())
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                println!("[ArtHub] Workflow saved via userdata API");
                return Ok("userdata".to_string());
            } else {
                println!("[ArtHub] userdata API failed with status: {}", response.status());
            }
        }
        Err(e) => {
            println!("[ArtHub] userdata API request failed: {:?}", e);
        }
    }
    
    // 如果所有 API 方案都失败，返回剪贴板方案标识
    println!("[ArtHub] All API methods failed, falling back to clipboard");
    Ok("clipboard".to_string())
}

// Tauri 命令：打开AI窗口并注入JSON（保留以兼容旧代码）
#[tauri::command]
async fn open_ai_window(app: tauri::AppHandle, url: String, json_content: String) -> Result<(), String> {
    use tauri::WindowUrl;
    
    println!("Opening AI window: {}", url);
    println!("JSON content length: {}", json_content.len());
    
    // 注意：JSON内容应该已经在前端复制到剪贴板了
    // 这里我们只负责打开窗口，并尝试注入（作为辅助）
    
    // 生成唯一的窗口标签
    let window_label = format!("ai_window_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis());
    
    // 创建新窗口
    let window = tauri::WindowBuilder::new(
        &app,
        &window_label,
        WindowUrl::External(url.parse().map_err(|e| format!("Invalid URL: {}", e))?)
    )
    .title("AI工具")
    .inner_size(1200.0, 800.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to create window: {:?}", e))?;
    
    // 等待窗口加载完成后尝试注入JSON（作为辅助方法）
    let json_content_clone = json_content.clone();
    let window_clone = window.clone();
    
    // 使用异步任务等待页面加载并注入JSON
    tauri::async_runtime::spawn(async move {
        // 先等待窗口显示
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        // 使用base64编码JSON，避免转义问题
        use base64::{Engine as _, engine::general_purpose};
        let json_base64 = general_purpose::STANDARD.encode(&json_content_clone);
        
        // 创建注入脚本，使用事件监听器确保在页面加载后执行
        let injection_script = format!(
            r#"
            (function() {{
                // 定义注入函数
                function injectJSON() {{
                    try {{
                        // 使用base64解码JSON
                        const jsonBase64 = "{}";
                        let jsonString, jsonData;
                        
                        try {{
                            // 解码base64
                            jsonString = atob(jsonBase64);
                            // 解析JSON
                            jsonData = JSON.parse(jsonString);
                            console.log('[ArtHub] JSON decoded and parsed successfully');
                        }} catch(e) {{
                            console.error('[ArtHub] Failed to decode/parse JSON:', e);
                            jsonString = jsonBase64;
                            jsonData = null;
                        }}
                        
                        // 方法1: 通过localStorage注入
                        try {{
                            if (jsonString) {{
                                localStorage.setItem('arthub_injected_json', jsonString);
                                console.log('[ArtHub] JSON injected via localStorage');
                            }}
                        }} catch(e) {{
                            console.warn('[ArtHub] localStorage injection failed:', e);
                        }}
                        
                        // 方法2: 通过window对象注入
                        try {{
                            if (jsonData) {{
                                window.arthubInjectedJSON = jsonData;
                            }}
                            if (jsonString) {{
                                window.arthubInjectedJSONString = jsonString;
                            }}
                            console.log('[ArtHub] JSON injected via window object');
                        }} catch(e) {{
                            console.warn('[ArtHub] window injection failed:', e);
                        }}
                        
                        // 方法3: 触发自定义事件
                        try {{
                            const event = new CustomEvent('arthub-json-ready', {{
                                detail: jsonData || jsonString,
                                bubbles: true,
                                cancelable: true
                            }});
                            window.dispatchEvent(event);
                            document.dispatchEvent(event);
                            console.log('[ArtHub] JSON ready event dispatched');
                        }} catch(e) {{
                            console.warn('[ArtHub] Event dispatch failed:', e);
                        }}
                        
                        // 方法4: 尝试复制到剪贴板并自动粘贴
                        setTimeout(async function() {{
                            try {{
                                if (jsonString && navigator.clipboard && navigator.clipboard.writeText) {{
                                    await navigator.clipboard.writeText(jsonString);
                                    console.log('[ArtHub] JSON copied to clipboard');
                                    
                                    // 尝试自动粘贴
                                    setTimeout(function() {{
                                        try {{
                                            // 方法4a: 尝试使用 execCommand (已废弃但可能仍有效)
                                            const activeElement = document.activeElement;
                                            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {{
                                                try {{
                                                    document.execCommand('paste');
                                                    console.log('[ArtHub] Attempted paste via execCommand');
                                                }} catch(e) {{
                                                    console.warn('[ArtHub] execCommand paste failed:', e);
                                                }}
                                            }}
                                            
                                            // 方法4b: 尝试模拟键盘事件 Ctrl+V
                                            try {{
                                                const pasteEvent = new KeyboardEvent('keydown', {{
                                                    key: 'v',
                                                    code: 'KeyV',
                                                    ctrlKey: true,
                                                    bubbles: true,
                                                    cancelable: true
                                                }});
                                                document.dispatchEvent(pasteEvent);
                                                
                                                const pasteEvent2 = new KeyboardEvent('keyup', {{
                                                    key: 'v',
                                                    code: 'KeyV',
                                                    ctrlKey: true,
                                                    bubbles: true,
                                                    cancelable: true
                                                }});
                                                document.dispatchEvent(pasteEvent2);
                                                
                                                console.log('[ArtHub] Attempted paste via keyboard event');
                                            }} catch(e) {{
                                                console.warn('[ArtHub] Keyboard event paste failed:', e);
                                            }}
                                            
                                            // 方法4c: 尝试找到所有输入框并直接设置值（多次尝试）
                                            function trySetInputValue() {{
                                                try {{
                                                    // 查找所有可能的输入元素
                                                    const selectors = [
                                                        'input[type="text"]',
                                                        'input[type="search"]',
                                                        'textarea',
                                                        '[contenteditable="true"]',
                                                        '[contenteditable]',
                                                        '.monaco-editor textarea', // VS Code编辑器
                                                        '.CodeMirror', // CodeMirror编辑器
                                                        '[role="textbox"]'
                                                    ];
                                                    
                                                    let targetInput = null;
                                                    
                                                    // 优先使用当前焦点元素
                                                    if (document.activeElement) {{
                                                        const active = document.activeElement;
                                                        if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) {{
                                                            targetInput = active;
                                                        }}
                                                    }}
                                                    
                                                    // 如果焦点元素不可用，查找所有输入框
                                                    if (!targetInput) {{
                                                        for (const selector of selectors) {{
                                                            const elements = document.querySelectorAll(selector);
                                                            if (elements.length > 0) {{
                                                                // 优先选择可见且可交互的元素
                                                                for (const el of elements) {{
                                                                    const style = window.getComputedStyle(el);
                                                                    if (style.display !== 'none' && style.visibility !== 'hidden') {{
                                                                        targetInput = el;
                                                                        break;
                                                                    }}
                                                                }}
                                                                if (targetInput) break;
                                                                // 如果没有找到可见的，使用第一个
                                                                if (!targetInput && elements[0]) {{
                                                                    targetInput = elements[0];
                                                                }}
                                                            }}
                                                            if (targetInput) break;
                                                        }}
                                                    }}
                                                    
                                                    if (targetInput) {{
                                                        // 聚焦元素
                                                        try {{
                                                            targetInput.focus();
                                                        }} catch(e) {{
                                                            console.warn('[ArtHub] Focus failed:', e);
                                                        }}
                                                        
                                                        // 设置值
                                                        if (targetInput.tagName === 'INPUT' || targetInput.tagName === 'TEXTAREA') {{
                                                            targetInput.value = jsonString;
                                                            // 触发各种事件以确保应用响应
                                                            targetInput.dispatchEvent(new Event('input', {{ bubbles: true, cancelable: true }}));
                                                            targetInput.dispatchEvent(new Event('change', {{ bubbles: true, cancelable: true }}));
                                                            targetInput.dispatchEvent(new KeyboardEvent('keydown', {{ bubbles: true }}));
                                                            targetInput.dispatchEvent(new KeyboardEvent('keyup', {{ bubbles: true }}));
                                                            console.log('[ArtHub] JSON set directly to input/textarea field');
                                                        }} else if (targetInput.isContentEditable) {{
                                                            targetInput.textContent = jsonString;
                                                            targetInput.dispatchEvent(new Event('input', {{ bubbles: true, cancelable: true }}));
                                                            console.log('[ArtHub] JSON set directly to contenteditable element');
                                                        }}
                                                        
                                                        return true;
                                                    }}
                                                }} catch(e) {{
                                                    console.warn('[ArtHub] Direct input set failed:', e);
                                                }}
                                                return false;
                                            }}
                                            
                                            // 立即尝试
                                            if (!trySetInputValue()) {{
                                                // 如果失败，延迟后重试
                                                setTimeout(trySetInputValue, 1000);
                                                setTimeout(trySetInputValue, 2000);
                                                setTimeout(trySetInputValue, 3000);
                                            }}
                                        }} catch(e) {{
                                            console.warn('[ArtHub] Auto-paste failed:', e);
                                        }}
                                    }}, 500);
                                }}
                            }} catch(e) {{
                                console.warn('[ArtHub] Clipboard copy failed:', e);
                            }}
                        }}, 1000);
                        
                        // 方法5: 在控制台输出提示
                        console.log('%c[ArtHub] JSON数据已注入！', 'color: #00ff00; font-weight: bold; font-size: 14px;');
                        console.log('%c访问方式:', 'color: #00aaff; font-weight: bold;');
                        console.log('  - window.arthubInjectedJSON (对象)');
                        console.log('  - window.arthubInjectedJSONString (字符串)');
                        console.log('  - localStorage.getItem("arthub_injected_json")');
                        console.log('  - 监听 "arthub-json-ready" 事件');
                        console.log('%c自动粘贴已尝试，如果失败请手动按 Ctrl+V', 'color: #ffaa00; font-weight: bold;');
                    }} catch(e) {{
                        console.error('[ArtHub] JSON injection error:', e);
                    }}
                }}
                
                // 立即尝试注入
                injectJSON();
                
                // 如果页面已经加载完成，再次注入
                if (document.readyState === 'complete' || document.readyState === 'interactive') {{
                    setTimeout(injectJSON, 100);
                }}
                
                // 监听页面加载事件
                if (document.readyState === 'loading') {{
                    document.addEventListener('DOMContentLoaded', injectJSON);
                }}
                window.addEventListener('load', injectJSON);
                
                // 延迟注入，确保页面完全加载
                setTimeout(injectJSON, 2000);
                setTimeout(injectJSON, 5000);
            }})();
            "#,
            json_base64
        );
        
        // 等待窗口显示
        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
        
        // 重试机制：尝试多次注入
        let mut retry_count = 0;
        let max_retries = 15; // 增加重试次数
        
        while retry_count < max_retries {
            // 等待页面加载
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            
            // 尝试执行注入脚本
            match window_clone.eval(&injection_script) {
                Ok(_) => {
                    println!("[ArtHub] JSON injection script executed successfully (attempt {})", retry_count + 1);
                    // 不立即退出，继续尝试确保注入成功
                    if retry_count >= 3 {
                        break;
                    }
                }
                Err(e) => {
                    println!("[ArtHub] Injection attempt {} failed: {:?}", retry_count + 1, e);
                }
            }
            
            retry_count += 1;
        }
        
        if retry_count >= max_retries {
            eprintln!("[ArtHub] Warning: Reached max retries, but injection may still work via event listeners");
        }
    });
    
    Ok(())
}

// 单实例检查（Windows）
#[cfg(target_os = "windows")]
fn check_single_instance() -> Result<(), Box<dyn std::error::Error>> {
    let mutex_name = CString::new("ArtHub_SingleInstance_Mutex")?;
    
    unsafe {
        let handle = CreateMutexA(ptr::null_mut(), FALSE, mutex_name.as_ptr() as *const i8);
        
        if handle == INVALID_HANDLE_VALUE {
            return Err("Failed to create mutex".into());
        }
        
        // 检查是否已经存在实例（ERROR_ALREADY_EXISTS = 183）
        let last_error = GetLastError();
        if last_error == 183 {
            // 已经存在实例，关闭当前句柄并退出
            CloseHandle(handle);
            return Err("Another instance is already running".into());
        }
    }
    
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn check_single_instance() -> Result<(), Box<dyn std::error::Error>> {
    // 非 Windows 系统暂时不检查
    Ok(())
}

fn main() {
    // 单实例检查
    if let Err(e) = check_single_instance() {
        eprintln!("单实例检查失败: {}", e);
        eprintln!("应用程序已经在运行中，退出当前实例");
        std::process::exit(1);
    }
    
    tauri::Builder::default()
        .manage(AppState {
            icon_position: Mutex::new(IconPosition { x: 0, y: 0 }),
            is_dragging: Mutex::new(false),
            drag_start_mouse: Mutex::new(IconPosition { x: 0, y: 0 }),
            drag_start_window: Mutex::new(IconPosition { x: 0, y: 0 }),
            ai_tabs: Mutex::new(Vec::new()),
        })
        .setup(|app| {
            println!("=== Tauri setup started ===");
            
            // 检查主窗口
            if let Some(main_window) = app.get_window("main") {
                println!("Main window found, label: {}", main_window.label());
                let _ = main_window.set_title("ArtHub - 游戏美术工作台");
                println!("Main window title set");
            } else {
                println!("ERROR: Main window not found in setup!");
            }
            
            // 加载图标位置
            let app_handle = app.handle();
            let position = load_icon_position(&app_handle);
            println!("Loaded icon position: x={}, y={}", position.x, position.y);
            {
                let state = app.state::<AppState>();
                let mut pos = state.icon_position.lock().unwrap();
                *pos = position.clone();
            }
            
            // 创建悬浮图标窗口
            match create_icon_window(&app_handle) {
                Ok(_icon_window) => {
                    println!("Icon window created successfully");
                    // 注意：不在这里保存位置，避免 DPI 缩放导致位置飘移
                    // 位置只在用户拖拽后保存
                }
                Err(e) => {
                    println!("ERROR: Failed to create icon window: {:?}", e);
                    return Err(e);
                }
            }
            
            println!("=== Tauri setup completed ===");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            icon_mouse_down,
            icon_mouse_move,
            icon_mouse_up,
            icon_click,
            app_exit,
            open_ai_window,
            open_ai_tab,
            simulate_paste,
            send_workflow_to_comfyui
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
