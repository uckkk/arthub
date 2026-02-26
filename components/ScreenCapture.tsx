import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, Square, Monitor, Settings, Keyboard } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
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

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;

// 截图/录屏完成后默认导入当前无限画板并切到画板
function dispatchImportToWhiteboard(filePath: string) {
  if (!filePath || !isTauri) return;
  window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: 'whiteboard' } }));
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('importFileToWhiteboard', { detail: { filePath } }));
  }, 200);
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
    window.addEventListener('arthub-capture-no-dir', onNoDir);
    window.addEventListener('arthub-capture-error', onError);
    window.addEventListener('arthub-record-started', onRecordStarted);
    return () => {
      window.removeEventListener('arthub-capture-no-dir', onNoDir);
      window.removeEventListener('arthub-capture-error', onError);
      window.removeEventListener('arthub-record-started', onRecordStarted);
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
          showToast('success', '录屏已停止，文件已保存');
          const path = lastRecordPathRef.current;
          if (path) dispatchImportToWhiteboard(path);
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

  const choosePath = async (isVideo: boolean) => {
    const defaultName = isVideo
      ? `录屏_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.mp4`
      : `截图_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.png`;
    const path = await open({
      directory: false,
      multiple: false,
      title: isVideo ? '选择录屏保存位置' : '选择截图保存位置',
      defaultPath: defaultName,
    });
    if (typeof path === 'string') setSavePath(path);
  };

  const handleScreenshot = async () => {
    if (!isTauri || !ffmpegOk) {
      showToast('error', '请先在设置中安装 FFmpeg');
      return;
    }
    let path = savePath.trim();
    if (!path) {
      const p = await open({
        directory: false,
        multiple: false,
        title: '保存截图',
        defaultPath: `截图_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.png`,
      });
      if (typeof p !== 'string') return;
      path = p;
    }
    if (!path.toLowerCase().endsWith('.png')) path += '.png';
    try {
      await invoke('screen_screenshot', { outputPath: path, region: null });
      setSavePath(path);
      const dir = path.replace(/[/\\][^/\\]+$/, '');
      if (dir) saveCaptureOutputDir(dir);
      showToast('success', '截图已保存');
      dispatchImportToWhiteboard(path);
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
      const p = await open({
        directory: false,
        multiple: false,
        title: '保存录屏',
        defaultPath: `录屏_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.mp4`,
      });
      if (typeof p !== 'string') return;
      path = p;
    }
    if (!path.toLowerCase().endsWith('.mp4')) path += '.mp4';
    try {
      await invoke('screen_record_start', {
        outputPath: path,
        region: null,
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

  const openFfmpegSettings = () => {
    window.dispatchEvent(new CustomEvent('openSettings'));
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] text-white p-6 overflow-auto">
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
            <span>未检测到 FFmpeg，录屏与截图需要先安装（可在「资源管理」- FFmpeg 设置 中安装）。</span>
            <button
              onClick={openFfmpegSettings}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-sm font-medium shrink-0"
            >
              <Settings size={14} />
              去设置
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

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#888] mb-1.5">
              {mode === 'screenshot' ? '截图保存路径' : '录屏保存路径'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={savePath}
                onChange={e => setSavePath(e.target.value)}
                placeholder={mode === 'screenshot' ? '选择或输入路径，如 C:\\Users\\xxx\\截图.png' : '选择或输入路径，如 C:\\Users\\xxx\\录屏.mp4'}
                className="flex-1 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm placeholder-[#555] focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => choosePath(mode === 'record')}
                className="px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#3a3a3a] text-[#ccc] text-sm shrink-0"
              >
                选择
              </button>
            </div>
          </div>

          {mode === 'screenshot' && (
            <button
              onClick={handleScreenshot}
              disabled={!ffmpegOk}
              className="w-full px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-[#333] disabled:text-[#555] text-white font-medium flex items-center justify-center gap-2"
            >
              <Camera size={18} />
              全屏截图
            </button>
          )}

          {mode === 'record' && (
            <div className="flex gap-2">
              {!recording ? (
                <button
                  onClick={handleRecordStart}
                  disabled={!ffmpegOk}
                  className="flex-1 px-4 py-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-[#333] disabled:text-[#555] text-white font-medium flex items-center justify-center gap-2"
                >
                  <Square size={18} />
                  开始录屏
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
          当前仅支持 Windows。录屏使用 FFmpeg gdigrab + H.264（CRF 22），画质高、体积小。区域截图/录屏后续版本提供。
        </p>
      </div>
    </div>
  );
}
