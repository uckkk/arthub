import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, Square, Crop, X, StopCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import {
  getCaptureOutputDir,
  saveCaptureOutputDir,
  saveLastRecordPath,
} from '../services/hotkeyService';
import { addPendingImport } from '../services/whiteboardPendingImport';

const CAPTURE_MODE_KEY = 'arthub_capture_mode';
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;

function buildOutputPath(dir: string, ext: 'png' | 'mp4') {
  const base = dir.trim().replace(/[/\\]+$/, '');
  if (!base) return '';
  const sep = base.includes('/') ? '/' : '\\';
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `${base}${sep}${ext === 'png' ? '\u622A\u56FE' : '\u5F55\u5C4F'}_${ts}.${ext}`;
}

function toRegionArg(r: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.max(0, Math.round(r.x)),
    y: Math.max(0, Math.round(r.y)),
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
  };
}

export interface CaptureFloatingBarProps {
  visible: boolean;
  suggestedAction?: 'screenshot' | 'record' | null;
  onClose: () => void;
}

export default function CaptureFloatingBar({ visible, suggestedAction = null, onClose }: CaptureFloatingBarProps) {
  const [captureMode, setCaptureMode] = useState<'fullscreen' | 'region'>(() => {
    try {
      const s = localStorage.getItem(CAPTURE_MODE_KEY);
      if (s === 'region' || s === 'fullscreen') return s;
    } catch {}
    return 'fullscreen';
  });

  const [recording, setRecording] = useState(false);
  const [recordElapsedMs, setRecordElapsedMs] = useState(0);
  const recordStartRef = useRef(0);

  const [regionPicking, setRegionPicking] = useState(false);
  const [pendingAction, setPendingAction] = useState<'screenshot' | 'record' | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const currentRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(CAPTURE_MODE_KEY, captureMode); } catch {}
  }, [captureMode]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecordElapsedMs(Date.now() - recordStartRef.current), 500);
    return () => clearInterval(id);
  }, [recording]);

  const getDir = useCallback(() => {
    const dir = getCaptureOutputDir().trim().replace(/[/\\]+$/, '');
    if (!dir) {
      window.dispatchEvent(new CustomEvent('arthub-capture-no-dir', { detail: { type: 'screenshot' } }));
      return null;
    }
    return dir;
  }, []);

  // --- Region picker ---

  const startRegionPick = useCallback(async (action: 'screenshot' | 'record') => {
    if (!isTauri) return;
    setPendingAction(action);
    try {
      await appWindow.setFullscreen(true);
      setRegionPicking(true);
    } catch {
      setPendingAction(null);
    }
  }, []);

  const finishRegionPick = useCallback((rect: { x: number; y: number; width: number; height: number } | null) => {
    setRegionPicking(false);
    setDragStart(null);
    setDragCurrent(null);
    appWindow.setFullscreen(false).catch(() => {});

    if (!rect || rect.width < 5 || rect.height < 5) {
      setPendingAction(null);
      return;
    }

    const dir = getDir();
    if (!dir) { setPendingAction(null); return; }
    const region = toRegionArg(rect);
    const action = pendingAction;
    setPendingAction(null);

    if (action === 'screenshot') {
      const path = buildOutputPath(dir, 'png');
      invoke('screen_screenshot', { outputPath: path, region })
        .then(() => { addPendingImport(path); saveCaptureOutputDir(dir); })
        .catch(() => {});
      onClose();
    } else if (action === 'record') {
      const path = buildOutputPath(dir, 'mp4');
      invoke('screen_record_start', { outputPath: path, region, crf: 22 })
        .then(() => {
          saveLastRecordPath(path);
          saveCaptureOutputDir(dir);
          recordStartRef.current = Date.now();
          setRecordElapsedMs(0);
          setRecording(true);
        })
        .catch(() => {});
      onClose();
    }
  }, [pendingAction, getDir, onClose]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const pt = { x: e.clientX, y: e.clientY };
    startRef.current = pt;
    currentRef.current = pt;
    setDragStart(pt);
    setDragCurrent(pt);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!startRef.current) return;
    const pt = { x: e.clientX, y: e.clientY };
    currentRef.current = pt;
    setDragCurrent(pt);
  }, []);

  const onMouseUp = useCallback(() => {
    const s = startRef.current;
    const c = currentRef.current;
    startRef.current = null;
    currentRef.current = null;
    if (!s || !c) return;
    const dpr = window.devicePixelRatio || 1;
    finishRegionPick({
      x: Math.round(Math.min(s.x, c.x) * dpr),
      y: Math.round(Math.min(s.y, c.y) * dpr),
      width: Math.round(Math.abs(c.x - s.x) * dpr),
      height: Math.round(Math.abs(c.y - s.y) * dpr),
    });
  }, [finishRegionPick]);

  useEffect(() => {
    if (!regionPicking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finishRegionPick(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [regionPicking, finishRegionPick]);

  // --- Capture actions ---

  const doScreenshot = useCallback(() => {
    if (!isTauri) return;
    if (captureMode === 'region') { startRegionPick('screenshot'); return; }
    const dir = getDir();
    if (!dir) { onClose(); return; }
    const path = buildOutputPath(dir, 'png');
    invoke('screen_screenshot', { outputPath: path, region: null })
      .then(() => { addPendingImport(path); saveCaptureOutputDir(dir); })
      .catch(() => {});
    onClose();
  }, [captureMode, getDir, onClose, startRegionPick]);

  const doRecord = useCallback(() => {
    if (!isTauri) return;
    if (captureMode === 'region') { startRegionPick('record'); return; }
    const dir = getDir();
    if (!dir) { onClose(); return; }
    const path = buildOutputPath(dir, 'mp4');
    invoke('screen_record_start', { outputPath: path, region: null, crf: 22 })
      .then(() => {
        saveLastRecordPath(path);
        saveCaptureOutputDir(dir);
        recordStartRef.current = Date.now();
        setRecordElapsedMs(0);
        setRecording(true);
      })
      .catch(() => {});
    onClose();
  }, [captureMode, getDir, onClose, startRegionPick]);

  const doStopRecord = useCallback(() => {
    invoke('screen_record_stop').then(() => setRecording(false)).catch(() => {});
  }, []);

  // --- Region picker overlay ---
  if (regionPicking) {
    return (
      <div
        className="fixed inset-0 z-[9999] cursor-crosshair bg-black/40"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { if (startRef.current) onMouseUp(); }}
        role="presentation"
      >
        <div className="absolute left-0 top-0 w-full py-3 text-center text-white/90 text-sm bg-black/30">
          {'\u62D6\u52A8\u9F20\u6807\u6846\u9009\u533A\u57DF\uFF0C\u677E\u5F00\u5B8C\u6210 \u00B7 Esc \u53D6\u6D88'}
        </div>
        {dragStart && dragCurrent && (
          <div
            className="absolute border-2 border-blue-400 bg-blue-400/20 pointer-events-none"
            style={{
              left: Math.min(dragStart.x, dragCurrent.x),
              top: Math.min(dragStart.y, dragCurrent.y),
              width: Math.abs(dragCurrent.x - dragStart.x),
              height: Math.abs(dragCurrent.y - dragStart.y),
            }}
          />
        )}
      </div>
    );
  }

  // --- Recording indicator (visible even when toolbar is closed) ---
  if (recording && !visible) {
    return (
      <div className="fixed top-4 right-4 z-[9998] flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1a1a] border border-red-500/50 shadow-xl">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs text-red-400 tabular-nums">
          {Math.floor(recordElapsedMs / 60000).toString().padStart(2, '0')}:
          {Math.floor((recordElapsedMs % 60000) / 1000).toString().padStart(2, '0')}
        </span>
        <button type="button" onClick={doStopRecord}
          className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs flex items-center gap-1">
          <StopCircle size={12} /> {'\u505C\u6B62'}
        </button>
      </div>
    );
  }

  if (!visible) return null;

  // --- Toolbar ---
  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#333] shadow-xl"
      role="dialog"
      aria-label="capture toolbar"
    >
      <div className="flex items-center gap-1">
        <span className="text-xs text-[#888] mr-1">{'\u8303\u56F4'}</span>
        <button type="button" onClick={() => setCaptureMode('fullscreen')}
          className={`px-2.5 py-1 rounded-lg text-sm ${captureMode === 'fullscreen' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-white'}`}>
          {'\u5168\u5C4F'}
        </button>
        <button type="button" onClick={() => setCaptureMode('region')}
          className={`px-2.5 py-1 rounded-lg text-sm flex items-center gap-1 ${captureMode === 'region' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-white'}`}>
          <Crop size={12} /> {'\u533A\u57DF'}
        </button>
      </div>
      <div className="w-px h-5 bg-[#333]" />

      {recording ? (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-red-400 tabular-nums">
            {Math.floor(recordElapsedMs / 60000).toString().padStart(2, '0')}:
            {Math.floor((recordElapsedMs % 60000) / 1000).toString().padStart(2, '0')}
          </span>
          <button type="button" onClick={doStopRecord}
            className="px-3 py-1.5 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 flex items-center gap-1.5 font-medium">
            <StopCircle size={14} /> {'\u505C\u6B62\u5F55\u5C4F'}
          </button>
        </div>
      ) : (
        <>
          <button type="button" onClick={doScreenshot}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 font-medium transition-colors ${
              suggestedAction === 'screenshot' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-[#2a2a2a] text-[#ccc] hover:bg-[#333]'
            }`}>
            <Camera size={14} /> {'\u622A\u56FE'}
          </button>
          <button type="button" onClick={doRecord}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 font-medium transition-colors ${
              suggestedAction === 'record' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-[#2a2a2a] text-[#ccc] hover:bg-[#333]'
            }`}>
            <Square size={14} /> {'\u5F55\u5C4F'}
          </button>
        </>
      )}

      <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[#666] hover:text-white hover:bg-[#333]" aria-label="close">
        <X size={16} />
      </button>
    </div>
  );
}
