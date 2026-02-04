// Prevents additional console window on Windows
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use tauri::{Manager, WindowBuilder, PhysicalPosition, PhysicalSize};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use winapi::um::winuser::{
    MonitorFromPoint, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST,
    EnumWindows, GetWindowTextW, SetForegroundWindow, ShowWindow, 
    SW_RESTORE, SW_MINIMIZE, IsWindowVisible, IsIconic, GetClassNameW
};
#[cfg(target_os = "windows")]
use winapi::shared::windef::{POINT, HWND};
#[cfg(target_os = "windows")]
use winapi::um::winuser::MONITORINFO;
#[cfg(target_os = "windows")]
use winapi::um::synchapi::CreateMutexA;
#[cfg(target_os = "windows")]
use winapi::um::handleapi::{INVALID_HANDLE_VALUE, CloseHandle};
#[cfg(target_os = "windows")]
use winapi::um::errhandlingapi::GetLastError;
#[cfg(target_os = "windows")]
use winapi::shared::minwindef::{FALSE, BOOL};
#[cfg(target_os = "windows")]
use std::mem;
#[cfg(target_os = "windows")]
use std::ffi::CString;
#[cfg(target_os = "windows")]
use std::ptr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStringExt;
#[cfg(target_os = "windows")]
use std::ffi::OsString;

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

const ICON_SIZE: i32 = 80; // 增大窗口大小，确保图标完整显示
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
    // 确保窗口大小与图标大小完全一致，热区与图标显示区域一致
    // 使用 inner_size 设置内容区域为 64x64，确保没有额外的边框或透明区域
    // Windows 上需要可变 builder（因为需要添加 transparent）
    #[cfg(target_os = "windows")]
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
    .min_inner_size(ICON_SIZE as f64, ICON_SIZE as f64)
    .max_inner_size(ICON_SIZE as f64, ICON_SIZE as f64)
    .title("");
    
    #[cfg(not(target_os = "windows"))]
    let builder = WindowBuilder::new(
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
    .min_inner_size(ICON_SIZE as f64, ICON_SIZE as f64)
    .max_inner_size(ICON_SIZE as f64, ICON_SIZE as f64)
    .title("");
    
    // Windows 上启用透明背景
    #[cfg(target_os = "windows")]
    let mut builder = builder.transparent(true);
    
    // macOS 上，decorations(false) 已经足够，透明背景通过 CSS 实现
    // Tauri v1 的 WindowBuilder 在 macOS 上不支持 transparent 方法
    
    #[cfg(target_os = "windows")]
    let icon_window = builder.build()?;
    
    #[cfg(not(target_os = "windows"))]
    let icon_window = builder.build()?;
    
    // macOS 上设置窗口透明背景和圆角
    #[cfg(target_os = "macos")]
    {
        use cocoa::base::id;
        use objc::{msg_send, sel, sel_impl, class};
        use std::ffi::c_void;
        
        // 获取 NSWindow 指针（返回 Result<*mut c_void, Error>）
        match icon_window.ns_window() {
            Ok(ns_window_ptr) => {
                unsafe {
                    // 将指针转换为 NSWindow 对象
                    let ns_window: id = ns_window_ptr as *mut c_void as id;
                    
                    // 获取透明颜色
                    let clear_color: id = msg_send![class!(NSColor), clearColor];
                    
                    // 设置窗口背景为透明
                    let _: () = msg_send![ns_window, setBackgroundColor: clear_color];
                    
                    // 设置窗口不透明为 false（允许透明背景）
                    let opaque: bool = false;
                    let _: () = msg_send![ns_window, setOpaque: opaque];
                    
                    // 启用窗口的 layer-backed 视图（必需才能设置圆角）
                    let wants_layer: bool = true;
                    let _: () = msg_send![ns_window, setWantsLayer: wants_layer];
                    
                    // 获取窗口的 layer
                    let layer: id = msg_send![ns_window, layer];
                    if !layer.is_null() {
                        // 设置圆角半径
                        let corner_radius: f64 = 16.0;
                        let _: () = msg_send![layer, setCornerRadius: corner_radius];
                        
                        // 设置 masksToBounds 以应用圆角裁剪
                        let masks_to_bounds: bool = true;
                        let _: () = msg_send![layer, setMasksToBounds: masks_to_bounds];
                    }
                }
            }
            Err(e) => {
                eprintln!("Warning: Failed to get NSWindow: {:?}", e);
            }
        }
    }
    
    // 获取窗口的缩放因子（DPI 缩放）
    let scale_factor = icon_window.scale_factor().unwrap_or(1.0);
    println!("Icon window scale factor: {}", scale_factor);
    
    // 计算实际需要的逻辑大小（考虑 DPI 缩放）
    // 如果缩放因子是 1.5，那么逻辑大小应该是 64 / 1.5 = 42.67，但我们用物理大小
    // 使用物理大小确保窗口实际渲染为 64x64 像素
    let physical_size = PhysicalSize::new(ICON_SIZE as u32, ICON_SIZE as u32);
    
    // 显式设置窗口大小，确保窗口大小精确为 64x64（物理像素）
    if let Err(e) = icon_window.set_size(physical_size) {
        eprintln!("Warning: Failed to set icon window size: {:?}", e);
    }
    
    // 验证窗口大小
    if let Ok(actual_size) = icon_window.inner_size() {
        println!("Icon window actual size: {} x {} (logical)", actual_size.width, actual_size.height);
        let actual_physical = icon_window.outer_size().unwrap_or(actual_size);
        println!("Icon window actual size: {} x {} (physical)", actual_physical.width, actual_physical.height);
    }
    
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

// Windows: 查找主窗口的数据结构
#[cfg(target_os = "windows")]
struct EnumWindowsData {
    target_title: String,
    found_hwnd: Option<HWND>,
}

// Windows: 枚举窗口的回调函数（用于查找主窗口）
#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_main_window_proc(hwnd: HWND, lparam: isize) -> BOOL {
    let find_data = &mut *(lparam as *mut EnumWindowsData);
    
    // 获取窗口标题
    let mut title: [u16; 512] = [0; 512];
    let length = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
    
    if length > 0 {
        let window_title = OsString::from_wide(&title[..length as usize])
            .to_string_lossy()
            .to_string();
        
        if window_title == find_data.target_title {
            find_data.found_hwnd = Some(hwnd);
            return 0; // 找到窗口，停止枚举
        }
    }
    
    1 // 继续枚举
}

// 辅助函数：在 Windows 上查找主窗口句柄
#[cfg(target_os = "windows")]
fn find_main_window_hwnd() -> Option<HWND> {
    let target_title = "ArtHub - 游戏美术工作台";
    let mut find_data = EnumWindowsData {
        target_title: target_title.to_string(),
        found_hwnd: None,
    };
    
    unsafe {
        EnumWindows(Some(enum_main_window_proc), &mut find_data as *mut _ as isize);
    }
    
    find_data.found_hwnd
}

// Tauri 命令：双击图标（全局唯一：双击呼出/隐藏主界面）
#[tauri::command]
fn icon_click(app: tauri::AppHandle) {
    println!("Icon double-clicked!");
    if let Some(main_window) = app.get_window("main") {
        let state = app.state::<AppState>();
        let mut window_visible = state.main_window_visible.lock().unwrap();
        
        // 检查窗口当前状态
        let mut is_visible_now = main_window.is_visible().unwrap_or(false);
        
        // 在 Windows 上，尝试检查窗口是否最小化
        #[cfg(target_os = "windows")]
        let mut is_minimized = {
            if let Some(hwnd) = find_main_window_hwnd() {
                unsafe { IsIconic(hwnd) != 0 }
            } else {
                false
            }
        };
        
        #[cfg(not(target_os = "windows"))]
        let is_minimized = false;
        
        // 如果第一次检查失败，重试一次
        if !is_visible_now {
            std::thread::sleep(std::time::Duration::from_millis(50));
            is_visible_now = main_window.is_visible().unwrap_or(false);
            
            #[cfg(target_os = "windows")]
            {
                if let Some(hwnd) = find_main_window_hwnd() {
                    is_minimized = unsafe { IsIconic(hwnd) != 0 };
                }
            }
        }
        
        println!("Main window state - is_visible: {}, is_minimized: {}, tracked: {}", 
                 is_visible_now, is_minimized, *window_visible);
        
        // 双击切换逻辑：如果窗口可见且不在最小化状态，则隐藏；否则显示
        if is_visible_now && !is_minimized {
            // 窗口当前可见且在前台，隐藏它
            println!("Main window is visible, hiding...");
            let _ = main_window.hide();
            *window_visible = false;
            println!("Main window hidden");
        } else {
            // 窗口不可见或最小化，显示/恢复并前置
            println!("Main window needs to be shown/restored...");
            
            #[cfg(target_os = "windows")]
            {
                // 在 Windows 上，如果窗口最小化，先恢复它
                if is_minimized {
                    if let Some(hwnd) = find_main_window_hwnd() {
                        unsafe {
                            ShowWindow(hwnd, SW_RESTORE);
                            SetForegroundWindow(hwnd);
                        }
                        std::thread::sleep(std::time::Duration::from_millis(150));
                    }
                }
            }
            
            // 先显示窗口（这会恢复最小化的窗口，也会显示被隐藏的窗口）
            let show_result = main_window.show();
            if show_result.is_err() {
                println!("Warning: First show() call failed, retrying...");
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = main_window.show();
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
            
            // 聚焦窗口以确保在前台
            let focus_result = main_window.set_focus();
            if focus_result.is_err() {
                println!("Warning: First set_focus() call failed, retrying...");
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = main_window.set_focus();
            }
            
            // 等待窗口响应
            std::thread::sleep(std::time::Duration::from_millis(150));
            
            // 多次验证并重试，确保窗口显示
            for attempt in 1..=5 {
                let is_visible_after = main_window.is_visible().unwrap_or(false);
                if is_visible_after {
                    println!("Window is now visible after {} attempt(s)", attempt);
                    break;
                } else {
                    println!("Window still not visible, retrying (attempt {})...", attempt);
                    let _ = main_window.show();
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = main_window.set_focus();
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    
                    #[cfg(target_os = "windows")]
                    {
                        // 在 Windows 上，尝试使用 Windows API 强制显示窗口
                        if let Some(hwnd) = find_main_window_hwnd() {
                            unsafe {
                                ShowWindow(hwnd, SW_RESTORE);
                                SetForegroundWindow(hwnd);
                            }
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                    }
                }
            }
            
            // 最终验证
            let final_visible = main_window.is_visible().unwrap_or(false);
            if final_visible {
                *window_visible = true;
                println!("Window successfully shown and focused");
            } else {
                println!("ERROR: Failed to show window after all attempts");
                *window_visible = false;
            }
        }
    } else {
        println!("ERROR: Main window not found!");
    }
}

// 窗口打开动画（未使用，保留以备将来需要）
#[allow(dead_code)]
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
                // 静默处理 404，这是正常的（扩展未安装时）
                if response.status() != 404 {
                    println!("[ArtHub] ArtHub extension API returned status: {}", response.status());
                }
            }
        }
        Err(e) => {
            // 静默处理连接错误，避免在控制台产生噪音
            // 这些错误是正常的（ComfyUI 未运行或扩展未安装时）
            let error_str = e.to_string();
            if !error_str.contains("timeout") && !error_str.contains("connection") && !error_str.contains("Failed to resolve") {
                println!("[ArtHub] ArtHub extension error: {:?}", e);
            }
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
                // 静默处理 404，这是正常的（API 不可用时）
                if response.status() != 404 {
                    println!("[ArtHub] userdata API failed with status: {}", response.status());
                }
            }
        }
        Err(e) => {
            // 静默处理连接错误，避免在控制台产生噪音
            let error_str = e.to_string();
            if !error_str.contains("timeout") && !error_str.contains("connection") && !error_str.contains("Failed to resolve") {
                println!("[ArtHub] userdata API request failed: {:?}", e);
            }
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

// Windows: 查找并前置已打开的资源管理器窗口
#[cfg(target_os = "windows")]
struct FindWindowData {
    target_path: String,
    found_hwnd: Option<HWND>,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: isize) -> BOOL {
    // 只检查可见窗口
    if IsWindowVisible(hwnd) == 0 {
        return 1; // 继续枚举
    }
    
    let find_data = &mut *(lparam as *mut FindWindowData);
    
    // 首先检查窗口类名，只处理资源管理器窗口
    let mut class_name: [u16; 256] = [0; 256];
    let class_length = GetClassNameW(hwnd, class_name.as_mut_ptr(), class_name.len() as i32);
    
    let class_str = if class_length > 0 {
        OsString::from_wide(&class_name[..class_length as usize])
            .to_string_lossy()
            .to_string()
    } else {
        return 1; // 无法获取类名，继续枚举
    };
    
    // Windows 资源管理器窗口的类名是 "CabinetWClass" 或 "ExploreWClass"
    if class_str != "CabinetWClass" && class_str != "ExploreWClass" {
        return 1; // 不是资源管理器窗口，继续枚举
    }
    
    // 获取窗口标题
    let mut title: [u16; 512] = [0; 512];
    let length = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
    
    if length > 0 {
        let window_title = OsString::from_wide(&title[..length as usize])
            .to_string_lossy()
            .to_string();
        
        println!("[ArtHub] Checking explorer window: title='{}', class='{}'", window_title, class_str);
        
        // 提取路径的最后一部分（文件夹名）
        let target_folder_name = find_data.target_path
            .split(['\\', '/'])
            .filter(|s| !s.is_empty())
            .last()
            .unwrap_or(&find_data.target_path)
            .to_lowercase();
        
        // 规范化路径和标题用于比较
        let normalized_path = find_data.target_path.replace('\\', "/").to_lowercase();
        let normalized_title = window_title.replace('\\', "/").to_lowercase();
        
        // 检查多种匹配方式：
        // 1. 标题完全包含路径
        // 2. 路径完全包含标题
        // 3. 标题包含文件夹名（对于网络路径，标题可能是 "\\server\share" 或 "share"）
        // 4. 路径的最后一部分（文件夹名）在标题中
        let path_parts: Vec<&str> = normalized_path.split('/').filter(|s| !s.is_empty()).collect();
        
        let mut matched = false;
        
        // 检查完整路径匹配
        if normalized_title.contains(&normalized_path) || normalized_path.contains(&normalized_title) {
            matched = true;
        }
        // 检查文件夹名匹配
        else if !target_folder_name.is_empty() && normalized_title.contains(&target_folder_name) {
            matched = true;
        }
        // 检查路径部分匹配（对于网络路径 "\\server\share"，标题可能是 "share"）
        else if path_parts.len() > 0 {
            let last_part = path_parts[path_parts.len() - 1];
            if normalized_title.contains(last_part) {
                matched = true;
            }
        }
        // 检查原始路径是否在标题中
        else if window_title.contains(&find_data.target_path) {
            matched = true;
        }
        
        if matched {
            println!("[ArtHub] Found existing explorer window for path: {} (title: {}, class: {})", 
                     find_data.target_path, window_title, class_str);
            find_data.found_hwnd = Some(hwnd);
            return 0; // 停止枚举
        }
    }
    
    1 // 继续枚举
}

// Tauri 命令：获取应用图标
#[tauri::command]
#[cfg(target_os = "windows")]
fn get_app_icon(path: String) -> Result<String, String> {
    use std::path::Path;
    
    let app_path = Path::new(&path);
    if !app_path.exists() {
        return Err("文件不存在".to_string());
    }
    
    let lower_path = path.to_lowercase();
    let is_exe = lower_path.ends_with(".exe");
    let is_lnk = lower_path.ends_with(".lnk");
    let is_bat = lower_path.ends_with(".bat");
    
    if !is_exe && !is_lnk && !is_bat {
        return Err("不支持的文件类型".to_string());
    }
    
    // 对于 .lnk 文件，需要先解析快捷方式获取目标路径
    let target_path = if is_lnk {
        // 尝试从快捷方式读取目标路径
        // 注意：Windows 的 .lnk 文件解析比较复杂，这里简化处理
        // 实际应用中可能需要使用专门的库如 shortcut-rs
        path.clone()
    } else {
        path.clone()
    };
    
    // 使用 windows-icons 提取图标
    match windows_icons::get_icon_base64_by_path(&target_path) {
        Ok(base64_icon) => {
            // 返回 data URI 格式
            Ok(format!("data:image/png;base64,{}", base64_icon))
        }
        Err(e) => {
            eprintln!("提取图标失败: {:?}", e);
            Err(format!("提取图标失败: {}", e))
        }
    }
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn get_app_icon(_path: String) -> Result<String, String> {
    Err("图标提取功能仅在 Windows 上支持".to_string())
}

// Tauri 命令：写入文件（绕过文件系统作用域限制）
#[tauri::command]
fn write_binary_file_with_path(file_path: String, content: Vec<u8>) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    
    let path = Path::new(&file_path);
    
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Err(format!("创建目录失败: {}", e));
        }
    }
    
    // 写入二进制文件
    match fs::write(path, content) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("写入文件失败: {}", e)),
    }
}

#[tauri::command]
fn write_file_with_path(file_path: String, content: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    
    let path = Path::new(&file_path);
    
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Err(format!("创建目录失败: {}", e));
        }
    }
    
    // 写入文件
    if let Err(e) = fs::write(path, content) {
        return Err(format!("写入文件失败: {}", e));
    }
    
    Ok(())
}

// Tauri 命令：重命名文件或目录（绕过文件系统作用域限制）
#[tauri::command]
fn rename_file_with_path(old_path: String, new_path: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    
    let old_path_obj = Path::new(&old_path);
    let new_path_obj = Path::new(&new_path);
    
    // 确保新路径的父目录存在
    if let Some(parent) = new_path_obj.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Err(format!("创建目录失败: {}", e));
        }
    }
    
    // 重命名文件或目录
    match fs::rename(old_path_obj, new_path_obj) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("重命名失败: {}", e)),
    }
}

// Tauri 命令：读取文件（绕过文件系统作用域限制）
#[tauri::command]
fn rename_directory_with_path(old_path: String, new_path: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    
    let old = Path::new(&old_path);
    let new_path_obj = Path::new(&new_path);
    
    // 确保新路径的父目录存在
    if let Some(parent) = new_path_obj.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Err(format!("创建目录失败: {}", e));
        }
    }
    
    // 重命名目录
    match fs::rename(old, new_path_obj) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("重命名目录失败: {}", e)),
    }
}

#[tauri::command]
fn read_file_with_path(file_path: String) -> Result<String, String> {
    use std::fs;
    use std::path::Path;
    
    let path = Path::new(&file_path);
    
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) => Err(format!("读取文件失败: {}", e)),
    }
}

// Tauri 命令：检查文件是否存在（绕过文件系统作用域限制）
#[tauri::command]
fn file_exists_with_path(file_path: String) -> Result<bool, String> {
    use std::path::Path;
    
    Ok(Path::new(&file_path).exists())
}

// Tauri 命令：启动应用（Windows 上使用 cmd start）
#[tauri::command]
fn launch_app(app_path: String) -> Result<(), String> {
    println!("[ArtHub] Launching app: {}", app_path);
    
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        
        // Windows API: CREATE_NO_WINDOW = 0x08000000
        // 这个标志可以隐藏 cmd 窗口，避免启动应用时窗口闪烁
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        // 使用 start /min "" "path" 格式，/min 参数可以最小化启动窗口（如果出现）
        // 结合 CREATE_NO_WINDOW 标志，确保完全不显示 cmd 窗口
        // 这样可以正确处理 .exe、.lnk、.bat 等文件
        let result = Command::new("cmd")
            .args(&["/c", "start", "/min", "", &app_path])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .stdin(std::process::Stdio::null())
            .spawn();
        
        match result {
            Ok(_child) => {
                println!("[ArtHub] Successfully launched app: {}", app_path);
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Failed to launch app: {}", e);
                println!("[ArtHub] Error: {}", error_msg);
                Err(error_msg)
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        
        // 在 macOS 上使用 open 命令
        let result = Command::new("open")
            .arg(&app_path)
            .spawn();
        
        match result {
            Ok(_child) => {
                println!("[ArtHub] Successfully launched app: {}", app_path);
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Failed to launch app: {}", e);
                println!("[ArtHub] Error: {}", error_msg);
                Err(error_msg)
            }
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        
        // 在 Linux 上尝试使用 xdg-open
        let result = Command::new("xdg-open")
            .arg(&app_path)
            .spawn();
        
        match result {
            Ok(_child) => {
                println!("[ArtHub] Successfully launched app: {}", app_path);
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Failed to launch app: {}", e);
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

// Tauri 命令：打开文件夹（使用系统命令，最可靠的方法）
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    println!("[ArtHub] Opening folder: {}", path);
    
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        
        // 首先尝试查找已打开的窗口
        unsafe {
            let mut find_data = FindWindowData {
                target_path: path.clone(),
                found_hwnd: None,
            };
            
            let lparam = &mut find_data as *mut FindWindowData as isize;
            EnumWindows(Some(enum_windows_proc), lparam);
            
            if let Some(hwnd) = find_data.found_hwnd {
                println!("[ArtHub] Bringing existing window to front");
                // 恢复窗口（如果最小化）
                ShowWindow(hwnd, SW_RESTORE);
                // 前置窗口
                SetForegroundWindow(hwnd);
                return Ok(());
            }
        }
        
        // 如果没有找到已打开的窗口，打开新窗口
        println!("[ArtHub] No existing window found, opening new explorer window");
        let result = Command::new("explorer")
            .arg(&path)
            .spawn();
        
        match result {
            Ok(_child) => {
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
                
                // 监听窗口关闭事件，阻止默认关闭行为，改为隐藏窗口
                let app_handle = app.handle().clone();
                let main_window_clone = main_window.clone();
                main_window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            println!("Main window close requested - preventing close and hiding instead");
                            // 阻止默认关闭行为
                            api.prevent_close();
                            // 隐藏窗口而不是关闭
                            let _ = main_window_clone.hide();
                            // 更新状态为不可见
                            let state = app_handle.state::<AppState>();
                            let mut window_visible = state.main_window_visible.lock().unwrap();
                            *window_visible = false;
                            println!("Main window hidden (not closed), can be shown again by double-clicking icon");
                        }
                        _ => {}
                    }
                });
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
            launch_app,
            open_console_window,
            open_ai_window,
            open_ai_tab,
            simulate_paste,
            send_workflow_to_comfyui,
            open_devtools,
            open_folder,
            get_app_icon,
            write_file_with_path,
            write_binary_file_with_path,
            rename_directory_with_path,
            read_file_with_path,
            file_exists_with_path,
            rename_file_with_path,
            enable_autostart,
            disable_autostart,
            is_autostart_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Tauri 命令：启用自启动
#[tauri::command]
fn enable_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winreg::{RegCreateKeyExW, RegSetValueExW, RegCloseKey, HKEY_CURRENT_USER};
        use winapi::shared::minwindef::HKEY;
        // 使用数字常量代替 winapi 常量（winapi 0.3 中这些常量可能不可用）
        const KEY_WRITE: u32 = 0x20006;
        const REG_SZ: u32 = 1;
        const REG_OPTION_NON_VOLATILE: u32 = 0;
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        
        unsafe {
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("获取可执行文件路径失败: {}", e))?;
            let exe_path_str = exe_path.to_string_lossy().to_string();
            
            // 注册表路径：HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
            let key_name: Vec<u16> = OsStr::new("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
                .encode_wide()
                .chain(Some(0))
                .collect();
            
            let app_name: Vec<u16> = OsStr::new("ArtHub")
                .encode_wide()
                .chain(Some(0))
                .collect();
            
            let exe_path_wide: Vec<u16> = OsStr::new(&exe_path_str)
                .encode_wide()
                .chain(Some(0))
                .collect();
            
            let mut hkey: HKEY = ptr::null_mut();
            let result = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                key_name.as_ptr(),
                0,
                ptr::null_mut(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                ptr::null_mut(),
                &mut hkey,
                ptr::null_mut(),
            );
            
            if result == 0 {
                let set_result = RegSetValueExW(
                    hkey,
                    app_name.as_ptr(),
                    0,
                    REG_SZ,
                    exe_path_wide.as_ptr() as *const _,
                    (exe_path_wide.len() * 2) as u32,
                );
                
                RegCloseKey(hkey);
                
                if set_result == 0 {
                    Ok(true)
                } else {
                    Err(format!("设置注册表值失败，错误代码: {}", set_result))
                }
            } else {
                Err(format!("创建注册表键失败，错误代码: {}", result))
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        use std::path::PathBuf;
        use std::fs;
        
        let home_dir = std::env::var("HOME")
            .map_err(|_| "无法获取用户主目录".to_string())?;
        
        let launch_agents_dir = PathBuf::from(&home_dir)
            .join("Library")
            .join("LaunchAgents");
        
        // 确保目录存在
        fs::create_dir_all(&launch_agents_dir)
            .map_err(|e| format!("创建 LaunchAgents 目录失败: {}", e))?;
        
        let plist_path = launch_agents_dir.join("com.arthub.gameartist.plist");
        
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("获取可执行文件路径失败: {}", e))?;
        
        let plist_content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.arthub.gameartist</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>"#,
            exe_path.to_string_lossy()
        );
        
        fs::write(&plist_path, plist_content)
            .map_err(|e| format!("写入 plist 文件失败: {}", e))?;
        
        Ok(true)
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("当前平台不支持自启动功能".to_string())
    }
}

// Tauri 命令：禁用自启动
#[tauri::command]
fn disable_autostart(_app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winreg::{RegOpenKeyExW, RegDeleteValueW, RegCloseKey, HKEY_CURRENT_USER};
        use winapi::shared::minwindef::HKEY;
        const KEY_WRITE: u32 = 0x20006;
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        
        unsafe {
            let key_name: Vec<u16> = OsStr::new("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
                .encode_wide()
                .chain(Some(0))
                .collect();
            
            let app_name: Vec<u16> = OsStr::new("ArtHub")
                .encode_wide()
                .chain(Some(0))
                .collect();
            
            let mut hkey: HKEY = ptr::null_mut();
            let result = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                key_name.as_ptr(),
                0,
                KEY_WRITE,
                &mut hkey,
            );
            
            if result == 0 {
                let delete_result = RegDeleteValueW(hkey, app_name.as_ptr());
                RegCloseKey(hkey);
                
                if delete_result == 0 {
                    Ok(true)
                } else {
                    // 如果值不存在，也认为成功
                    Ok(true)
                }
            } else {
                // 如果键不存在，也认为成功
                Ok(true)
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        use std::path::PathBuf;
        use std::fs;
        
        let home_dir = std::env::var("HOME")
            .map_err(|_| "无法获取用户主目录".to_string())?;
        
        let plist_path = PathBuf::from(&home_dir)
            .join("Library")
            .join("LaunchAgents")
            .join("com.arthub.gameartist.plist");
        
        if plist_path.exists() {
            fs::remove_file(&plist_path)
                .map_err(|e| format!("删除 plist 文件失败: {}", e))?;
        }
        
        Ok(true)
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("当前平台不支持自启动功能".to_string())
    }
}

// Tauri 命令：检查自启动是否已启用
#[tauri::command]
fn is_autostart_enabled(_app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winreg::{RegOpenKeyExW, RegQueryValueExW, RegCloseKey, HKEY_CURRENT_USER};
        use winapi::shared::minwindef::HKEY;
        const KEY_READ: u32 = 0x20019;
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        
        unsafe {
            let key_name: Vec<u16> = OsStr::new("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
                .encode_wide()
                .chain(Some(0))
                .collect();
            
            let app_name: Vec<u16> = OsStr::new("ArtHub")
                .encode_wide()
                .chain(Some(0))
                .collect();
            
            let mut hkey: HKEY = ptr::null_mut();
            let result = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                key_name.as_ptr(),
                0,
                KEY_READ,
                &mut hkey,
            );
            
            if result == 0 {
                let mut value_type: u32 = 0;
                let mut data_len: u32 = 0;
                
                // 先查询值的大小
                let query_result = RegQueryValueExW(
                    hkey,
                    app_name.as_ptr(),
                    ptr::null_mut(),
                    &mut value_type,
                    ptr::null_mut(),
                    &mut data_len,
                );
                
                RegCloseKey(hkey);
                
                Ok(query_result == 0 && data_len > 0)
            } else {
                Ok(false)
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        use std::path::PathBuf;
        
        let home_dir = std::env::var("HOME")
            .map_err(|_| "无法获取用户主目录".to_string())?;
        
        let plist_path = PathBuf::from(&home_dir)
            .join("Library")
            .join("LaunchAgents")
            .join("com.arthub.gameartist.plist");
        
        Ok(plist_path.exists())
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Ok(false)
    }
}
