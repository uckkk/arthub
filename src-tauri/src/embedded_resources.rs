// 嵌入的资源文件模块
// 此模块由 build.rs 自动生成，用于嵌入 DirectML.dll

#[cfg(target_os = "windows")]
pub mod windows_dlls {
    // 包含 build.rs 生成的嵌入 DLL 代码
    include!(concat!(env!("OUT_DIR"), "/embedded_directml.rs"));
    
    // 提供统一的接口
    pub const DIRECTML_DLL: &[u8] = match EMBEDDED_DIRECTML_DLL {
        Some(data) => data,
        None => &[],
    };
}

#[cfg(not(target_os = "windows"))]
pub mod windows_dlls {
    pub const DIRECTML_DLL: &[u8] = &[];
}
