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
    main_window_visible: Mutex<bool>, // 主窗口是否真的可见（在前台，非最小化）
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
    let state = app.state::<AppState>();
    let mut is_dragging = state.is_dragging.lock().unwrap();
    *is_dragging = true;
    
    // 保存鼠标初始位置和鼠标相对于窗口的偏移
    if let Some(icon_window) = app.get_window("icon") {
        if let Ok(current_pos) = icon_window.outer_position() {
            // 确保使用物理坐标
            let window_x = current_pos.x;
            let window_y = current_pos.y;
            
            // 计算鼠标相对于窗口左上角的偏移（在窗口内的位置）
            // 这个偏移在整个拖拽过程中保持不变
            let mut window_offset = state.drag_start_window.lock().unwrap();
            window_offset.x = x as i32 - window_x;
            window_offset.y = y as i32 - window_y;
            
            // 保存鼠标初始屏幕位置（用于验证）
            let mut mouse_start = state.drag_start_mouse.lock().unwrap();
            mouse_start.x = x as i32;
            mouse_start.y = y as i32;
        }
    }
}

// Tauri 命令：图标鼠标移动
#[tauri::command]
fn icon_mouse_move(app: tauri::AppHandle, x: f64, y: f64) {
    let state = app.state::<AppState>();
    let is_dragging = state.is_dragging.lock().unwrap();
    
    if *is_dragging {
        if let Some(icon_window) = app.get_window("icon") {
            // 获取鼠标相对于窗口的偏移（在 mouse_down 时保存，保持不变）
            let window_offset = state.drag_start_window.lock().unwrap();
            
            // 计算窗口新位置：鼠标屏幕位置 - 鼠标在窗口内的偏移 = 窗口左上角位置
            // 这样窗口会跟随鼠标移动，保持鼠标在窗口内的相对位置不变
            let new_x = x as i32 - window_offset.x;
            let new_y = y as i32 - window_offset.y;
            
            // 使用物理坐标设置窗口位置（避免 DPI 缩放问题）
            // 直接设置，不进行任何额外的计算或验证
            let _ = icon_window.set_position(PhysicalPosition::new(new_x, new_y));
        }
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
        let state = app.state::<AppState>();
        let mut window_visible = state.main_window_visible.lock().unwrap();
        
        // 先检查窗口当前状态（在恢复之前）
        let was_visible_before = main_window.is_visible().unwrap_or(false);
        
        // 总是先尝试显示和聚焦窗口（这会恢复最小化的窗口）
        let show_result = main_window.show();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let focus_result = main_window.set_focus();
        
        // 等待窗口响应
        std::thread::sleep(std::time::Duration::from_millis(100));
        
        // 检查窗口是否真的可见
        let is_visible_after = main_window.is_visible().unwrap_or(false);
        let focus_success = focus_result.is_ok();
        
        println!("Main window state - was_visible: {}, is_visible_after: {}, focus_success: {}, tracked: {}", 
                 was_visible_before, is_visible_after, focus_success, *window_visible);
        
        // 如果窗口之前就是可见的（且跟踪状态也是可见的），且现在聚焦成功，则切换为隐藏
        // 这样可以避免刚恢复的窗口立即被隐藏
        if *window_visible && was_visible_before && focus_success {
            // 窗口之前就是可见的，且聚焦成功，则隐藏（切换行为）
            println!("Main window was visible, hiding...");
                let _ = main_window.hide();
            *window_visible = false;
        } else {
            // 窗口之前不可见，或者需要恢复，则显示
            println!("Main window needs to be shown/restored...");
            // 确保窗口显示
            if show_result.is_err() {
                let _ = main_window.show();
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
            let _ = main_window.set_focus();
            *window_visible = true;
        }
    } else {
        println!("Main window not found!");
    }
}

// 窗口打开动画
fn animate_window_open(_app: &tauri::AppHandle, main_window: tauri::Window) {
    println!("Opening main window...");
    
    // 先检查当前状态
    let is_visible = main_window.is_visible().unwrap_or(false);
    println!("Main window state before show - visible: {}", is_visible);
    
    // 显示窗口（这会自动恢复最小化的窗口）
    match main_window.show() {
        Ok(_) => println!("Main window show() called successfully"),
        Err(e) => {
            println!("Error showing window: {:?}", e);
            return;
        }
    }
    
    // 等待窗口显示
    std::thread::sleep(std::time::Duration::from_millis(100));
    
    // 聚焦窗口（确保窗口在前台）
    match main_window.set_focus() {
        Ok(_) => println!("Main window focused successfully"),
        Err(e) => println!("Error focusing window: {:?}", e),
    }
    
    // 再次检查窗口可见性
    let final_visible = main_window.is_visible().unwrap_or(false);
    println!("Main window state after show - visible: {}", final_visible);
    
    // 如果窗口仍然不可见，尝试再次显示
    if !final_visible {
        println!("Window still not visible, trying show() again...");
        let _ = main_window.show();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = main_window.set_focus();
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

// Tauri 命令：打开控制台窗口
#[tauri::command]
async fn open_console_window(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::WindowUrl;
    
    // 检查窗口是否已存在
    if let Some(existing_window) = app.get_window("console") {
        let _ = existing_window.show();
        let _ = existing_window.set_focus();
        return Ok("console".to_string());
    }
    
    // 获取主窗口位置
    let (x, y) = if let Some(main_window) = app.get_window("main") {
        if let Ok(position) = main_window.outer_position() {
            (position.x + 50, position.y + 50)
        } else {
            (100, 100)
        }
    } else {
        (100, 100)
    };
    
    // 在开发模式下使用开发服务器，生产模式下使用应用资源
    // 注意：console.html 在 public 目录中，构建后会复制到 dist 根目录
    let console_url = if cfg!(debug_assertions) {
        WindowUrl::External("http://localhost:3000/console.html".parse().unwrap())
    } else {
        // 生产模式：使用 App URL，Tauri 会从 dist 目录加载
        // 使用相对路径，确保文件能被正确加载
        WindowUrl::App("console.html".into())
    };
    
    println!("Creating console window with URL: {:?}", console_url);
    
    // 创建控制台窗口
    match tauri::WindowBuilder::new(
        &app,
        "console",
        console_url.clone()
    )
    .title("错误日志控制台")
    .inner_size(1000.0, 700.0)
    .min_inner_size(600.0, 400.0)
    .resizable(true)
    .position(x as f64, y as f64)
    .decorations(true)
    .always_on_top(false)
    .skip_taskbar(false)
    .build() {
        Ok(window) => {
            println!("Console window created successfully");
            // 确保窗口显示
            let _ = window.show();
            let _ = window.set_focus();
            Ok("console".to_string())
        },
        Err(e) => {
            eprintln!("Failed to create console window: {:?}", e);
            eprintln!("Console URL was: {:?}", console_url);
            Err(format!("Failed to create console window: {:?}", e))
        }
    }
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
    
    let platform = std::env::consts::OS;
    println!("[{}] Opening AI tab: {} - {}", platform, title, url);
    
    // 使用前端传递的JSON内容（前端已经读取了文件）
    let json_content_final = json_content;
    
    if json_file_path.is_some() {
        println!("[{}] JSON file path provided: {:?}", platform, json_file_path);
    }
    
    if json_content_final.is_some() {
        let json_len = json_content_final.as_ref().unwrap().len();
        let json_preview = json_content_final.as_ref().unwrap().chars().take(100).collect::<String>();
        println!("[{}] JSON content length: {}, preview: {}...", platform, json_len, json_preview);
    } else {
        println!("[{}] WARNING: No JSON content provided!", platform);
    }
    
    // 生成唯一的窗口标签（包含平台信息，避免跨平台冲突）
    let platform = std::env::consts::OS;
    let window_label = format!("ai_tab_{}_{}", config_id, platform);
    
    // 检查窗口是否已存在
    if let Some(existing_window) = app.get_window(&window_label) {
        println!("[{}] Window {} already exists, reusing and injecting new JSON", platform, window_label);
        // 窗口已存在，聚焦并刷新，同时重新注入JSON
        let _ = existing_window.set_focus();
        
        // 如果有新的JSON内容，先清除旧的，然后刷新页面并注入新的JSON
        if let Some(json) = json_content_final {
            let json_clone = json.clone();
            let window_clone = existing_window.clone();
            let url_clone = url.clone();
            
            // 先清除旧的 JSON 数据
            let clear_script = r#"
                try {
                    localStorage.removeItem('arthub_injected_json');
                    delete window.arthubInjectedJSON;
                    delete window.arthubInjectedJSONString;
                    console.log('[ArtHub] Old JSON cleared');
                } catch(e) {
                    console.warn('[ArtHub] Failed to clear old JSON:', e);
                }
            "#;
            let _ = existing_window.eval(clear_script);
            
            // 刷新页面
            let _ = existing_window.eval(&format!("window.location.href = '{}';", url_clone));
            
            // 使用异步任务等待页面加载并注入新的JSON
            tauri::async_runtime::spawn(async move {
                // 等待页面刷新和加载
                tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
                
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

// Tauri 命令：打开开发者工具
#[tauri::command]
fn open_devtools(window: tauri::Window) -> Result<(), String> {
    // 在 Tauri v1 中，open_devtools 方法需要启用 devtools feature
    // 启用 devtools feature 后，Window 结构体会有 open_devtools 方法
    window.open_devtools();
    Ok(())
}

// Tauri 命令：打开文件夹（使用系统命令，最可靠的方法）
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    println!("[ArtHub] Opening folder: {}", path);
    
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        
        // 在 Windows 上使用 explorer 命令打开文件夹
        // explorer 命令会自动处理本地路径和网络路径
        // 注意：explorer 命令在后台运行，不会阻塞
        let result = Command::new("explorer")
            .arg(&path)
            .spawn();
        
        match result {
            Ok(mut child) => {
                // 不等待子进程完成，让它立即返回
                // explorer 会在后台打开文件夹
                let _ = child.wait(); // 分离进程，不阻塞
                println!("[ArtHub] Successfully spawned explorer for: {}", path);
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Failed to spawn explorer: {}", e);
                println!("[ArtHub] Error: {}", error_msg);
                Err(error_msg)
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        
        // 在 macOS 上使用 open 命令
        let output = Command::new("open")
            .arg(&path)
            .output();
        
        match output {
            Ok(_) => {
                println!("[ArtHub] Successfully opened folder: {}", path);
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Failed to open folder: {}", e);
                println!("[ArtHub] Error: {}", error_msg);
                Err(error_msg)
            }
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        
        // 在 Linux 上尝试使用 xdg-open
        let output = Command::new("xdg-open")
            .arg(&path)
            .output();
        
        match output {
            Ok(_) => {
                println!("[ArtHub] Successfully opened folder: {}", path);
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Failed to open folder: {}", e);
                println!("[ArtHub] Error: {}", error_msg);
                Err(error_msg)
            }
        }
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
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
            main_window_visible: Mutex::new(true), // 默认主窗口是可见的
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
            open_console_window,
            open_ai_window,
            open_ai_tab,
            simulate_paste,
            send_workflow_to_comfyui,
            open_devtools,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
