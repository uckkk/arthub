import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, Square, Monitor, Settings, Keyboard, Download, Crop } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useToast } from './Toast';
import {
  getSavedScreenshotHotkey,
  getSavedRecordHotkey,
  saveScreenshotHotkey,
  saveRecordHotkey,
  saveCaptureOutputDir,
  saveLastRecordPath,
  getCaptureOutputDir,
  registerScreenshotHotkey,
  registerRecordHotkey,
  validateHotkey,
} from '../services/hotkeyService';
import { addPendingImport } from '../services/whiteboardPendingImport';

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;

// 截图/录屏完成后默认导入当前无限画板（不跳转，后台入队由画布处理）
function dispatchImportToWhiteboard(filePath: string) {
  if (!filePath || !isTauri) return;
  addPendingImport(filePath);
}

const CAPTURE_KEY_MAP: Record<string, string> = {
  ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};

export default function ScreenCapture() {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'screenshot' | 'record'>('screenshot');
  const [savePath, setSavePath] = useState('');
  const [recording, setRecording] = useState(false);
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);
  const lastRecordPathRef = useRef('');
  const [screenshotHotkey, setScreenshotHotkey] = useState('');
  const [recordHotkey, setRecordHotkey] = useState('');
  const [savingHotkeys, setSavingHotkeys] = useState(false);
  const [lastCapturePath, setLastCapturePath] = useState('');
  const [showCaptureSavedPrompt, setShowCaptureSavedPrompt] = useState(false);
  const [captureSavedType, setCaptureSavedType] = useState<'screenshot' | 'record' | null>(null);
  const [captureMode, setCaptureMode] = useState<'fullscreen' | 'region'>('fullscreen');
  const [selectedRegion, setSelectedRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [regionPickerActive, setRegionPickerActive] = useState(false);
  const [regionDragStart, setRegionDragStart] = useState<{ x: number; y: number } | null>(null);
  const [regionDragCurrent, setRegionDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const regionStartRef = useRef<{ x: number; y: number } | null>(null);
  const regionCurrentRef = useRef<{ x: number; y: number } | null>(null);

  const startRegionPicker = useCallback(async () => {
    if (!isTauri) return;
    try {
      const win = getCurrentWindow();
      await win.setFullscreen(true);
      setRegionPickerActive(true);
    } catch (e) {
      showToast('error', '无法进入全屏，请重试');
    }
  }, [showToast]);

  const endRegionPicker = useCallback((rect: { x: number; y: number; width: number; height: number } | null) => {
    setRegionPickerActive(false);
    setRegionDragStart(null);
    setRegionDragCurrent(null);
    if (rect && rect.width > 4 && rect.height > 4) setSelectedRegion(rect);
    getCurrentWindow().setFullscreen(false).catch(() => {});
  }, []);

  const onRegionMouseDown = useCallback((e: React.MouseEvent) => {
    const pt = { x: e.clientX, y: e.clientY };
    regionStartRef.current = pt;
    regionCurrentRef.current = pt;
    setRegionDragStart(pt);
    setRegionDragCurrent(pt);
  }, []);

  const onRegionMouseMove = useCallback((e: React.MouseEvent) => {
    if (!regionStartRef.current) return;
    const pt = { x: e.clientX, y: e.clientY };
    regionCurrentRef.current = pt;
    setRegionDragCurrent(pt);
  }, []);

  const onRegionMouseUp = useCallback(() => {
    const start = regionStartRef.current;
    const current = regionCurrentRef.current;
    regionStartRef.current = null;
    regionCurrentRef.current = null;
    setRegionDragStart(null);
    setRegionDragCurrent(null);
    if (!start || !current) return;
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(Math.min(start.x, current.x) * dpr);
    const y = Math.round(Math.min(start.y, current.y) * dpr);
    const w = Math.round(Math.abs(current.x - start.x) * dpr);
    const h = Math.round(Math.abs(current.y - start.y) * dpr);
    endRegionPicker({ x, y, width: w, height: h });
  }, [endRegionPicker]);

  useEffect(() => {
    if (!regionPickerActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        endRegionPicker(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [regionPickerActive, endRegionPicker]);

  useEffect(() => {
    if (!isTauri) return;
    setScreenshotHotkey(getSavedScreenshotHotkey());
    setRecordHotkey(getSavedRecordHotkey());
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    const onNoDir = (e: Event) => {
      const type = (e as CustomEvent<{ type: string }>).detail?.type;
      showToast('info', '请先选择下方保存路径或选择目录，快捷键将保存到该位置');
    };
    const onError = (e: Event) => {
      const d = (e as CustomEvent<{ type: string; error: unknown }>).detail;
      showToast('error', d?.type === 'screenshot' ? '截图失败' : '录屏失败');
    };
    const onRecordStarted = () => showToast('success', '录屏已开始，再次按录屏快捷键停止');
    const onCaptureSavedToCanvas = (e: Event) => {
      const t = (e as CustomEvent<{ type: 'screenshot' | 'record' }>).detail?.type;
      if (t) {
        setCaptureSavedType(t);
        setShowCaptureSavedPrompt(true);
      }
    };
    window.addEventListener('arthub-capture-no-dir', onNoDir);
    window.addEventListener('arthub-capture-error', onError);
    window.addEventListener('arthub-record-started', onRecordStarted);
    window.addEventListener('arthub-capture-saved-to-canvas', onCaptureSavedToCanvas);
    return () => {
      window.removeEventListener('arthub-capture-no-dir', onNoDir);
      window.removeEventListener('arthub-capture-error', onError);
      window.removeEventListener('arthub-record-started', onRecordStarted);
      window.removeEventListener('arthub-capture-saved-to-canvas', onCaptureSavedToCanvas);
    };
  }, [isTauri, showToast]);

  const captureKeyDown = (which: 'screenshot' | 'record', e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    let key = e.key;
    if (CAPTURE_KEY_MAP[key]) key = CAPTURE_KEY_MAP[key];
    else if (key.startsWith('F') && key.length <= 3) key = key.toUpperCase();
    else if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) key = key.toUpperCase();
    if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(key)) return;
    if (parts.length > 0 && key) {
      const hotkey = parts.join('+') + '+' + key;
      if (which === 'screenshot') setScreenshotHotkey(hotkey);
      else setRecordHotkey(hotkey);
    }
  };

  const handleSaveHotkeys = async () => {
    if (!isTauri) return;
    setSavingHotkeys(true);
    try {
      if (screenshotHotkey.trim()) {
        const v = validateHotkey(screenshotHotkey);
        if (!v.valid) { showToast('error', `截图快捷键: ${v.error}`); return; }
      }
      if (recordHotkey.trim()) {
        const v = validateHotkey(recordHotkey);
        if (!v.valid) { showToast('error', `录屏快捷键: ${v.error}`); return; }
      }
      const ok1 = await registerScreenshotHotkey(screenshotHotkey.trim());
      const ok2 = await registerRecordHotkey(recordHotkey.trim());
      if (ok1 && ok2) {
        saveScreenshotHotkey(screenshotHotkey.trim());
        saveRecordHotkey(recordHotkey.trim());
        showToast('success', '快捷键已保存');
      } else {
        showToast('error', '快捷键被占用或注册失败');
      }
    } catch (e: any) {
      showToast('error', e?.message || '保存失败');
    } finally {
      setSavingHotkeys(false);
    }
  };

  const checkFfmpeg = useCallback(async () => {
    if (!isTauri) return;
    try {
      const status = await invoke<{ installed: boolean }>('ffmpeg_check');
      setFfmpegOk(status.installed);
      return status.installed;
    } catch {
      setFfmpegOk(false);
      return false;
    }
  }, []);

  useEffect(() => {
    checkFfmpeg();
  }, [checkFfmpeg]);

  const pollRecording = useCallback(() => {
    if (!recording || !isTauri) return;
    let cancelled = false;
    const t = setInterval(async () => {
      if (cancelled) return;
      try {
        const is = await invoke<boolean>('screen_record_is_recording');
        if (!is) {
          setRecording(false);
          const path = lastRecordPathRef.current;
          if (path) {
            setLastCapturePath(path);
            dispatchImportToWhiteboard(path);
            setCaptureSavedType('record');
            setShowCaptureSavedPrompt(true);
          }
          showToast('success', '录屏已停止，文件已保存');
        }
      } catch {
        setRecording(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [recording, showToast]);

  useEffect(() => {
    if (!recording) return;
    return pollRecording();
  }, [recording, pollRecording]);

  const choosePath = async () => {
    let defaultPath: string | undefined;
    if (savePath.trim()) defaultPath = savePath.trim();
    else {
      try {
        const path = await import('@tauri-apps/api/path');
        defaultPath = (await path.documentDir()) ?? (await path.homeDir()) ?? undefined;
      } catch {
        defaultPath = undefined;
      }
    }
    const chosen = await open({
      directory: true,
      multiple: false,
      title: '选择保存目录（截图与录屏文件将保存在此文件夹）',
      defaultPath,
    });
    if (typeof chosen === 'string') {
      const dir = chosen.replace(/[/\\]+$/, '');
      setSavePath(dir);
      saveCaptureOutputDir(dir);
    }
  };

  const buildOutputPath = (dirOrFile: string, ext: 'png' | 'mp4') => {
    const base = dirOrFile.trim().replace(/[/\\]+$/, '');
    if (!base) return '';
    const isFile = base.toLowerCase().endsWith('.png') || base.toLowerCase().endsWith('.mp4');
    if (isFile) return ext === 'png' ? (base.endsWith('.png') ? base : base + '.png') : (base.endsWith('.mp4') ? base : base + '.mp4');
    const sep = base.includes('/') ? '/' : '\\';
    const name = ext === 'png' ? `截图_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.png` : `录屏_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.mp4`;
    return `${base}${sep}${name}`;
  };

  const handleScreenshot = async () => {
    if (!isTauri || !ffmpegOk) {
      showToast('error', '请先在设置中安装 FFmpeg');
      return;
    }
    let path = savePath.trim();
    if (!path) {
      const chosen = await open({ directory: true, multiple: false, title: '选择保存目录' });
      if (typeof chosen !== 'string') return;
      path = chosen.replace(/[/\\]+$/, '');
      setSavePath(path);
      saveCaptureOutputDir(path);
    }
    path = buildOutputPath(path, 'png');
    const regionArg = captureMode === 'region' && selectedRegion
      ? { x: Math.round(selectedRegion.x), y: Math.round(selectedRegion.y), width: Math.round(selectedRegion.width), height: Math.round(selectedRegion.height) }
      : null;
    try {
      await invoke('screen_screenshot', { outputPath: path, region: regionArg });
      setSavePath(path);
      setLastCapturePath(path);
      const dir = path.replace(/[/\\][^/\\]+$/, '');
      if (dir) saveCaptureOutputDir(dir);
      showToast('success', '截图已保存');
      dispatchImportToWhiteboard(path);
      setCaptureSavedType('screenshot');
      setShowCaptureSavedPrompt(true);
    } catch (e: any) {
      showToast('error', e?.message || '截图失败');
    }
  };

  const handleRecordStart = async () => {
    if (!isTauri || !ffmpegOk) {
      showToast('error', '请先在设置中安装 FFmpeg');
      return;
    }
    let path = savePath.trim();
    if (!path) {
      const chosen = await open({ directory: true, multiple: false, title: '选择保存目录' });
      if (typeof chosen !== 'string') return;
      path = chosen.replace(/[/\\]+$/, '');
      setSavePath(path);
      saveCaptureOutputDir(path);
    }
    path = buildOutputPath(path, 'mp4');
    const regionArg = captureMode === 'region' && selectedRegion
      ? { x: Math.round(selectedRegion.x), y: Math.round(selectedRegion.y), width: Math.round(selectedRegion.width), height: Math.round(selectedRegion.height) }
      : null;
    try {
      await invoke('screen_record_start', {
        outputPath: path,
        region: regionArg,
        crf: 22,
      });
      setSavePath(path);
      lastRecordPathRef.current = path;
      const dir = path.replace(/[/\\][^/\\]+$/, '');
      if (dir) saveCaptureOutputDir(dir);
      saveLastRecordPath(path);
      setRecording(true);
      showToast('success', '正在录屏，点击「停止录屏」结束');
    } catch (e: any) {
      showToast('error', e?.message || '开始录屏失败');
    }
  };

  const handleRecordStop = async () => {
    if (!isTauri) return;
    try {
      await invoke('screen_record_stop');
      setRecording(false);
    } catch (e: any) {
      showToast('error', e?.message || '停止录屏失败');
    }
  };

  const [ffmpegInstalling, setFfmpegInstalling] = useState(false);
  const handleInstallFfmpeg = async () => {
    if (!isTauri || ffmpegInstalling) return;
    setFfmpegInstalling(true);
    try {
      await invoke('ffmpeg_download');
      await checkFfmpeg();
      showToast('success', 'FFmpeg 安装完成，已全局生效');
    } catch (e: any) {
      showToast('error', e?.message || e?.toString() || 'FFmpeg 安装失败');
    } finally {
      setFfmpegInstalling(false);
    }
  };

  const handleDownloadTo = async () => {
    if (!isTauri || !lastCapturePath) return;
    try {
      const fileName = lastCapturePath.replace(/^.*[/\\]/, '');
      const target = await open({
        directory: false,
        multiple: false,
        title: '选择保存位置（可指定文件夹和文件名）',
        defaultPath: fileName,
      });
      if (typeof target !== 'string') return;
      const content = await invoke<number[]>('read_binary_file_with_path', { filePath: lastCapturePath });
      await invoke('write_binary_file_with_path', { filePath: target, content: Array.from(content) });
      showToast('success', '已保存到选择的位置');
    } catch (e: any) {
      showToast('error', e?.message || '保存失败');
    }
  };

  const goToWhiteboard = () => {
    setShowCaptureSavedPrompt(false);
    window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: 'whiteboard' } }));
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] text-white p-6 overflow-auto relative">
      <div className="max-w-xl mx-auto w-full space-y-6">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Camera size={20} className="text-blue-400" />
          截图 / 录屏
        </h2>

        {!isTauri && (
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-sm">
            此功能仅在桌面应用中可用。
          </div>
        )}

        {isTauri && ffmpegOk === false && (
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center justify-between gap-3">
            <span>未检测到 FFmpeg，录屏与截图需要先安装（安装后全局生效）。</span>
            <button
              onClick={handleInstallFfmpeg}
              disabled={ffmpegInstalling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-sm font-medium shrink-0 disabled:opacity-60"
            >
              {ffmpegInstalling ? (
                <>安装中...</>
              ) : (
                <>立即安装</>
              )}
            </button>
          </div>
        )}

        <div className="flex gap-2 border-b border-[#2a2a2a] pb-2">
          <button
            onClick={() => setMode('screenshot')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              mode === 'screenshot' ? 'bg-blue-600 text-white' : 'bg-[#1a1a1a] text-[#888] hover:text-white'
            }`}
          >
            <Monitor size={16} />
            截图
          </button>
          <button
            onClick={() => setMode('record')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              mode === 'record' ? 'bg-blue-600 text-white' : 'bg-[#1a1a1a] text-[#888] hover:text-white'
            }`}
          >
            <Square size={16} />
            录屏
          </button>
        </div>

        {isTauri && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#888]">范围：</span>
            <button
              type="button"
              onClick={() => setCaptureMode('fullscreen')}
              className={`px-3 py-1.5 rounded-lg text-sm ${captureMode === 'fullscreen' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-white'}`}
            >
              全屏
            </button>
            <button
              type="button"
              onClick={() => setCaptureMode('region')}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${captureMode === 'region' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-white'}`}
            >
              <Crop size={14} />
              区域
            </button>
            {captureMode === 'region' && (
              <>
                <button
                  type="button"
                  onClick={startRegionPicker}
                  className="px-3 py-1.5 rounded-lg text-sm bg-blue-600/20 text-blue-300 hover:bg-blue-600/30"
                >
                  框选区域
                </button>
                {selectedRegion && (
                  <span className="text-xs text-[#666]">
                    {selectedRegion.width}×{selectedRegion.height}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#888] mb-1.5">
              保存路径（截图与录屏共用）
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={savePath}
                onChange={e => setSavePath(e.target.value)}
                placeholder="选择或输入路径，如 C:\Users\xxx 或带文件名"
                className="flex-1 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm placeholder-[#555] focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => choosePath()}
                className="px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] text-[#ccc] text-sm shrink-0"
              >
                选择
              </button>
            </div>
          </div>

          {isTauri && lastCapturePath && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[#888] truncate max-w-[200px]" title={lastCapturePath}>
                最近: {lastCapturePath.replace(/^.*[/\\]/, '')}
              </span>
              <button
                type="button"
                onClick={handleDownloadTo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] text-[#ccc] text-sm"
              >
                <Download size={14} />
                下载到...
              </button>
            </div>
          )}

          {mode === 'screenshot' && (
            <button
              onClick={handleScreenshot}
              disabled={!ffmpegOk || (captureMode === 'region' && !selectedRegion)}
              className="w-full px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-[#333] disabled:text-[#555] text-white font-medium flex items-center justify-center gap-2"
            >
              <Camera size={18} />
              {captureMode === 'region' ? (selectedRegion ? '区域截图' : '请先框选区域') : '全屏截图'}
            </button>
          )}

          {mode === 'record' && (
            <div className="flex gap-2">
              {!recording ? (
                <button
                  onClick={handleRecordStart}
                  disabled={!ffmpegOk || (captureMode === 'region' && !selectedRegion)}
                  className="flex-1 px-4 py-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-[#333] disabled:text-[#555] text-white font-medium flex items-center justify-center gap-2"
                >
                  <Square size={18} />
                  {captureMode === 'region' ? (selectedRegion ? '区域录屏' : '请先框选区域') : '开始录屏'}
                </button>
              ) : (
                <button
                  onClick={handleRecordStop}
                  className="flex-1 px-4 py-3 rounded-lg bg-red-700 hover:bg-red-800 text-white font-medium flex items-center justify-center gap-2 animate-pulse"
                >
                  <Square size={18} />
                  停止录屏
                </button>
              )}
            </div>
          )}
        </div>

        {isTauri && (
          <div className="space-y-3 pt-2 border-t border-[#2a2a2a]">
            <div className="flex items-center gap-2 text-sm text-[#a0a0a0]">
              <Keyboard size={16} />
              自定义快捷键（按下组合键即可设置）
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#666] mb-1">截图</label>
                <input
                  type="text"
                  readOnly
                  value={screenshotHotkey}
                  placeholder="例如 Ctrl+Shift+S"
                  onKeyDown={e => captureKeyDown('screenshot', e)}
                  onKeyUp={e => { e.preventDefault(); e.stopPropagation(); }}
                  className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm placeholder-[#555] focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-[#666] mb-1">录屏（开始/停止）</label>
                <input
                  type="text"
                  readOnly
                  value={recordHotkey}
                  placeholder="例如 Ctrl+Shift+R"
                  onKeyDown={e => captureKeyDown('record', e)}
                  onKeyUp={e => { e.preventDefault(); e.stopPropagation(); }}
                  className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm placeholder-[#555] focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleSaveHotkeys}
              disabled={savingHotkeys}
              className="px-4 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {savingHotkeys ? '保存中...' : '保存快捷键'}
            </button>
          </div>
        )}

        <p className="text-xs text-[#555]">
          当前仅支持 Windows。录屏使用 FFmpeg gdigrab + H.264（CRF 22），画质高、体积小。支持全屏与区域框选。
        </p>
      </div>

      {regionPickerActive && (
        <div
          className="fixed inset-0 z-[9999] cursor-crosshair bg-black/40"
          onMouseDown={onRegionMouseDown}
          onMouseMove={onRegionMouseMove}
          onMouseUp={onRegionMouseUp}
          onMouseLeave={() => { if (regionStartRef.current) onRegionMouseUp(); }}
          role="presentation"
        >
          <div className="absolute left-0 top-0 w-full py-3 text-center text-white/90 text-sm bg-black/30">
            拖动鼠标框选区域，松开完成 · Esc 取消
          </div>
          {regionDragStart && regionDragCurrent && (
            <div
              className="absolute border-2 border-blue-400 bg-blue-400/20 pointer-events-none"
              style={{
                left: Math.min(regionDragStart.x, regionDragCurrent.x),
                top: Math.min(regionDragStart.y, regionDragCurrent.y),
                width: Math.abs(regionDragCurrent.x - regionDragStart.x),
                height: Math.abs(regionDragCurrent.y - regionDragStart.y),
              }}
            />
          )}
        </div>
      )}

      {showCaptureSavedPrompt && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 px-5 py-4 rounded-xl bg-[#1a1a1a] border border-[#333] shadow-lg">
          <p className="text-sm text-[#e0e0e0]">
            {captureSavedType === 'record' ? '当前视频' : '当前截图'}已保存至画布
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={goToWhiteboard}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              立即前往
            </button>
            <button
              type="button"
              onClick={() => setShowCaptureSavedPrompt(false)}
              className="px-4 py-2 rounded-lg bg-[#333] hover:bg-[#444] text-[#ccc] text-sm"
            >
              稍后处理
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
