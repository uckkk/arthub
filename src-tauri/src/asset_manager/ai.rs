use std::path::{Path, PathBuf};
use std::sync::Mutex;

// ort 不支�?macOS Intel (x86_64-apple-darwin)
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use image::GenericImageView;
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use ndarray::Array4;
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use ort::session::Session;
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use ort::value::Tensor;

const CLIP_IMAGE_SIZE: u32 = 224;
const MODEL_VERSION: &str = "clip-vit-base-patch32";

const CLIP_MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];

const VISION_MODEL_URL: &str = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx";
const TEXT_MODEL_URL: &str = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx";
const TOKENIZER_URL: &str = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json";

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
pub struct ClipModel {
    vision_session: Session,
    text_session: Session,
    tokenizer: tokenizers::Tokenizer,
}

// macOS Intel stub - ort 不支持此平台
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub struct ClipModel {
    _phantom: std::marker::PhantomData<()>,
}

pub struct AiState {
    pub model: Mutex<Option<ClipModel>>,
    pub models_dir: Mutex<PathBuf>,
    pub default_models_dir: PathBuf,
    pub config_path: PathBuf,
    pub model_broken: Mutex<bool>,
}

impl AiState {
    pub fn new(app_data_dir: &Path) -> Self {
        let default_dir = app_data_dir.join("models");
        std::fs::create_dir_all(&default_dir).ok();
        let config_path = app_data_dir.join("ai_models_config.json");
        let saved_dir = Self::load_saved_dir(&config_path).unwrap_or_else(|| default_dir.clone());
        std::fs::create_dir_all(&saved_dir).ok();
        AiState {
            model: Mutex::new(None),
            models_dir: Mutex::new(saved_dir),
            default_models_dir: default_dir,
            config_path,
            model_broken: Mutex::new(false),
        }
    }

    fn load_saved_dir(config_path: &Path) -> Option<PathBuf> {
        let text = std::fs::read_to_string(config_path).ok()?;
        let val: serde_json::Value = serde_json::from_str(&text).ok()?;
        val.get("models_dir")?.as_str().map(PathBuf::from).filter(|p| !p.as_os_str().is_empty())
    }

    pub fn get_models_dir(&self) -> PathBuf {
        self.models_dir.lock().unwrap().clone()
    }

    pub fn set_models_dir(&self, new_dir: PathBuf) -> Result<(), String> {
        std::fs::create_dir_all(&new_dir).map_err(|e| format!("创建目录失败: {}", e))?;
        let json = serde_json::json!({ "models_dir": new_dir.to_string_lossy() });
        std::fs::write(&self.config_path, json.to_string()).map_err(|e| format!("保存配置失败: {}", e))?;
        *self.models_dir.lock().unwrap() = new_dir;
        *self.model.lock().unwrap() = None;
        *self.model_broken.lock().unwrap() = false;
        Ok(())
    }
}

fn vision_model_path(d: &Path) -> PathBuf { d.join("clip-vision.onnx") }
fn text_model_path(d: &Path) -> PathBuf { d.join("clip-text.onnx") }
fn tokenizer_path(d: &Path) -> PathBuf { d.join("tokenizer.json") }

pub fn models_ready(d: &Path) -> bool {
    vision_model_path(d).exists() && text_model_path(d).exists() && tokenizer_path(d).exists()
}

pub fn model_files_status(d: &Path) -> (bool, bool, bool) {
    (vision_model_path(d).exists(), text_model_path(d).exists(), tokenizer_path(d).exists())
}

pub async fn download_model_file(url: &str, dest: &Path, on_progress: impl Fn(u64, u64)) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::new();
    let resp = client.get(url).send().await.map_err(|e| format!("下载请求失败: {}", e))?;
    if !resp.status().is_success() { return Err(format!("下载失败, HTTP {}", resp.status())); }
    let total = resp.content_length().unwrap_or(0);
    on_progress(0, total);

    let tmp = dest.with_extension("tmp");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("创建文件失败: {}", e))?;
    let mut downloaded: u64 = 0;
    let mut last_report: u64 = 0;
    let report_interval = std::cmp::max(total / 200, 65536);
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载数据块失�? {}", e))?;
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| format!("写入失败: {}", e))?;
        downloaded += chunk.len() as u64;
        if downloaded - last_report >= report_interval || downloaded == total {
            on_progress(downloaded, total);
            last_report = downloaded;
        }
    }

    drop(file);
    std::fs::rename(&tmp, dest).map_err(|e| format!("重命名文件失�? {}", e))?;
    Ok(())
}

pub async fn download_all_models(d: &Path, on_progress: impl Fn(&str, u64, u64)) -> Result<(), String> {
    let files = [
        ("tokenizer", TOKENIZER_URL, tokenizer_path(d)),
        ("vision_model", VISION_MODEL_URL, vision_model_path(d)),
        ("text_model", TEXT_MODEL_URL, text_model_path(d)),
    ];
    for (name, url, dest) in &files {
        if dest.exists() { continue; }
        on_progress(name, 0, 0);
        download_model_file(url, dest, |dl, tot| on_progress(name, dl, tot)).await?;
    }
    Ok(())
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
pub fn load_model(d: &Path) -> Result<ClipModel, String> {
    let vp = vision_model_path(d);
    let tp = text_model_path(d);
    let tkp = tokenizer_path(d);
    if !vp.exists() || !tp.exists() || !tkp.exists() {
        return Err("Model files not downloaded".into());
    }

    let vision_session = Session::builder()
        .map_err(|e| format!("创建会话失败: {}", e))?
        .with_intra_threads(4).map_err(|e| format!("{}", e))?
        .commit_from_file(&vp).map_err(|e| format!("加载视觉模型失败: {}", e))?;

    let text_session = Session::builder()
        .map_err(|e| format!("创建会话失败: {}", e))?
        .with_intra_threads(4).map_err(|e| format!("{}", e))?
        .commit_from_file(&tp).map_err(|e| format!("加载文本模型失败: {}", e))?;

    let tokenizer = tokenizers::Tokenizer::from_file(&tkp)
        .map_err(|e| format!("加载分词器失�? {}", e))?;

    Ok(ClipModel { vision_session, text_session, tokenizer })
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
fn preprocess_image(img_path: &str) -> Result<Array4<f32>, String> {
    let img = image::open(img_path).map_err(|e| format!("打开图片失败: {}", e))?;
    let (w, h) = img.dimensions();
    let min_dim = w.min(h);
    let cropped = img.crop_imm((w - min_dim) / 2, (h - min_dim) / 2, min_dim, min_dim);
    let resized = cropped.resize_exact(CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE, image::imageops::FilterType::CatmullRom);

    let sz = CLIP_IMAGE_SIZE as usize;
    let mut tensor = Array4::<f32>::zeros((1, 3, sz, sz));
    for y in 0..CLIP_IMAGE_SIZE {
        for x in 0..CLIP_IMAGE_SIZE {
            let pixel = resized.get_pixel(x, y);
            for c in 0..3usize {
                tensor[[0, c, y as usize, x as usize]] = (pixel[c] as f32 / 255.0 - CLIP_MEAN[c]) / CLIP_STD[c];
            }
        }
    }
    Ok(tensor)
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
pub fn embed_image(model: &mut ClipModel, img_path: &str) -> Result<Vec<f32>, String> {
    let arr = preprocess_image(img_path)?;
    let input = Tensor::from_array(arr).map_err(|e| format!("创建张量失败: {}", e))?;

    let outputs = model.vision_session.run(ort::inputs![input])
        .map_err(|e| format!("视觉推理失败: {}", e))?;

    extract_embedding_from_outputs(&outputs)
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
pub fn embed_text(model: &mut ClipModel, text: &str) -> Result<Vec<f32>, String> {
    let encoding = model.tokenizer.encode(text, true)
        .map_err(|e| format!("分词失败: {}", e))?;

    let ids = encoding.get_ids();
    let seq_len = ids.len();
    let ids_data: Vec<i64> = ids.iter().map(|&x| x as i64).collect();

    let input_ids = Tensor::from_array(([1usize, seq_len], ids_data.into_boxed_slice()))
        .map_err(|e| format!("创建 input_ids 失败: {}", e))?;

    let num_inputs = model.text_session.inputs().len();
    let outputs = if num_inputs >= 2 {
        let attn_data: Vec<i64> = encoding.get_attention_mask().iter().map(|&x| x as i64).collect();
        let attention_mask = Tensor::from_array(([1usize, seq_len], attn_data.into_boxed_slice()))
            .map_err(|e| format!("创建 attention_mask 失败: {}", e))?;
        model.text_session.run(ort::inputs![input_ids, attention_mask])
    } else {
        model.text_session.run(ort::inputs![input_ids])
    }.map_err(|e| format!("文本推理失败: {}", e))?;

    extract_embedding_from_outputs(&outputs)
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
fn extract_embedding_from_outputs(outputs: &ort::session::SessionOutputs) -> Result<Vec<f32>, String> {
    let output = &outputs[outputs.len() - 1];
    let (shape, data) = output.try_extract_tensor::<f32>()
        .map_err(|e| format!("提取输出失败: {}", e))?;

    let dims: &[i64] = &**shape;
    let embed = if dims.len() == 3 {
        data[..dims[2] as usize].to_vec()
    } else if dims.len() == 2 {
        data[..dims[1] as usize].to_vec()
    } else {
        data.to_vec()
    };

    Ok(l2_normalize(&embed))
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn search_similar(query: &[f32], all: &[(i64, Vec<f32>)], top_k: usize) -> Vec<(i64, f32)> {
    let mut scores: Vec<(i64, f32)> = all.iter()
        .map(|(id, emb)| (*id, cosine_similarity(query, emb)))
        .collect();
    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scores.truncate(top_k);
    scores
}

fn l2_normalize(v: &[f32]) -> Vec<f32> {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm < 1e-12 { return v.to_vec(); }
    v.iter().map(|x| x / norm).collect()
}

pub fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(embedding.len() * 4);
    for &val in embedding { bytes.extend_from_slice(&val.to_le_bytes()); }
    bytes
}

pub fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

pub const fn get_model_version() -> &'static str { MODEL_VERSION }

// macOS Intel stub implementations - ort 不支持此平台
// macOS Intel stub implementations - ort does not support this platform
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub fn load_model(_d: &Path) -> Result<ClipModel, String> {
    Err("AI model feature is not available on macOS Intel (x86_64): ort does not support this platform".into())
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub fn embed_image(_model: &mut ClipModel, _img_path: &str) -> Result<Vec<f32>, String> {
    Err("AI model feature is not available on macOS Intel (x86_64): ort does not support this platform".into())
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub fn embed_text(_model: &mut ClipModel, _text: &str) -> Result<Vec<f32>, String> {
    Err("AI model feature is not available on macOS Intel (x86_64): ort does not support this platform".into())
}
