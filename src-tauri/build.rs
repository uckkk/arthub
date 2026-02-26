use std::env;
use std::path::PathBuf;
use std::fs;

fn main() {
    tauri_build::build();
    
    // 在 Windows 上尝试查找并嵌入 DirectML.dll
    #[cfg(target_os = "windows")]
    {
        // DirectML.dll 通常由 ort crate 下载
        // ort crate 使用 download-binaries feature 时，DLL 可能位于多个位置
        
        let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
        
        // 可能的 DLL 位置（按优先级排序）
        // 注意：OUT_DIR 是 build script 的输出目录，通常是 target/.../build/arthub-xxx/out
        let deps_dir = out_dir.parent().unwrap().parent().unwrap().parent().unwrap().parent().unwrap();
        let possible_paths = [
            // 1. 当前构建目录的 deps 子目录（最常见的位置）
            deps_dir.join("deps").join("DirectML.dll"),
            // 2. release/debug 目录的 deps
            deps_dir.join("release").join("deps").join("DirectML.dll"),
            deps_dir.join("debug").join("deps").join("DirectML.dll"),
            // 3. 项目根目录的 target 目录
            manifest_dir.parent().unwrap().join("target").join("x86_64-pc-windows-msvc").join("release").join("deps").join("DirectML.dll"),
            manifest_dir.parent().unwrap().join("target").join("x86_64-pc-windows-msvc").join("debug").join("deps").join("DirectML.dll"),
        ];
        
        // 查找 DLL
        let mut found_dll = None;
        for dll_path in &possible_paths {
            if dll_path.exists() && dll_path.is_file() {
                found_dll = Some(dll_path);
                break;
            }
        }
        
        // 生成嵌入代码文件的路径（必须在 OUT_DIR 中）
        let code_file = out_dir.join("embedded_directml.rs");
        
        // 如果找到了 DLL，读取其内容并生成嵌入代码
        if let Some(dll_path) = found_dll {
            match fs::read(&dll_path) {
                Ok(dll_bytes) => {
                    // 生成包含 DLL 数据的 Rust 代码文件
                    let code = format!(
                        "pub const EMBEDDED_DIRECTML_DLL: Option<&[u8]> = Some(&{:?});\n",
                        dll_bytes
                    );
                    
                    match fs::write(&code_file, code) {
                        Ok(_) => {
                            println!("cargo:warning=已找到并准备嵌入 DirectML.dll: {:?}", dll_path);
                            println!("cargo:rerun-if-changed={}", dll_path.display());
                            // 设置编译时配置，让代码知道 DLL 已嵌入
                            println!("cargo:rustc-cfg=feature=\"embed-directml\"");
                        }
                        Err(e) => {
                            println!("cargo:warning=无法写入嵌入代码文件: {}", e);
                            // 即使写入失败，也生成一个空文件，避免编译错误
                            let _ = fs::write(&code_file, "pub const EMBEDDED_DIRECTML_DLL: Option<&[u8]> = None;\n");
                        }
                    }
                }
                Err(e) => {
                    println!("cargo:warning=无法读取 DirectML.dll: {}", e);
                    // 读取失败，生成一个返回 None 的代码文件
                    let _ = fs::write(&code_file, "pub const EMBEDDED_DIRECTML_DLL: Option<&[u8]> = None;\n");
                }
            }
        } else {
            // 如果没找到，生成一个返回 None 的代码文件
            let code = "pub const EMBEDDED_DIRECTML_DLL: Option<&[u8]> = None;\n";
            match fs::write(&code_file, code) {
                Ok(_) => {
                    println!("cargo:warning=未找到 DirectML.dll，将不会嵌入到 exe 中");
                    println!("cargo:warning=DirectML.dll 需要与 exe 放在同一目录，或由 ort crate 自动提供");
                }
                Err(e) => {
                    println!("cargo:warning=无法写入嵌入代码文件: {}", e);
                }
            }
        }
    }
}

