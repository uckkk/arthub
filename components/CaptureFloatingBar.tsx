import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, Square, Settings, X, StopCircle, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, WebviewWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import {
  getCaptureOutputDir,
  saveCaptureOutputDir,
  saveLastRecordPath,
} from '../services/hotkeyService';
import { addPendingImport } from '../services/whiteboardPendingImport';

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
const BAR_W = 340;
const BAR_H = 52;
const SETTINGS_H = 160;

function buildOutputPath(dir: string, ext: 'png' | 'mp4') {
  const base = dir.trim().replace(/[/\\]+$/, '');
  if (!base) return '';
  const sep = base.includes('/') ? '/' : '\\';
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const prefix = ext === 'png' ? '\u622A\u56FE' : '\u5F55\u5C4F';
  return `${base}${sep}${prefix}_${ts}.${ext}`;
}

function toRegionArg(r: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.max(0, Math.round(r.x)),
    y: Math.max(0, Math.round(r.y)),
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
  };
}

export async function openCaptureWindow() {
  if (!isTauri) return;
  const existing = WebviewWindow.getByLabel('capture-bar');
  if (existing) {
    existing.setFocus().catch(() => {});
    return;
  }
  new WebviewWindow('capture-bar', {
    url: '/?mode=capture',
    width: BAR_W,
    height: BAR_H,
    decorations: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    center: true,
    title: '',
  });
}

export default function CaptureFloatingBar() {
  const [recording, setRecording] = useState(false);
  const [recordElapsedMs, setRecordElapsedMs] = useState(0);
  const recordStartRef = useRef(0);
  const [showSettings, setShowSettings] = useState(false);
  const [saveDir, setSaveDir] = useState(() => getCaptureOutputDir() || '');

  const [regionPicking, setRegionPicking] = useState(false);
  const [pendingAction, setPendingAction] = useState<'screenshot' | 'record' | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const currentRef = useRef<{ x: number; y: number } | null>(null);
  const savedPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecordElapsedMs(Date.now() - recordStartRef.current), 500);
    return () => clearInterval(id);
  }, [recording]);

  const getDir = useCallback(() => {
    const dir = (getCaptureOutputDir() || '').trim().replace(/[/\\]+$/, '');
    return dir || null;
  }, []);

  const handleDrag = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    appWindow.startDragging().catch(() => {});
  }, []);

  const startRegionPick = useCallback(async (action: 'screenshot' | 'record') => {
    if (!isTauri) return;
    setPendingAction(action);
    try {
      const pos = await appWindow.outerPosition();
      savedPosRef.current = { x: pos.x, y: pos.y };
      await appWindow.setResizable(true);
      await appWindow.setSize(new LogicalSize(window.screen.width, window.screen.height));
      await appWindow.setPosition(new LogicalPosition(0, 0));
      setRegionPicking(true);
    } catch {
      setPendingAction(null);
    }
  }, []);

  const restoreBar = useCallback(async () => {
    try {
      await appWindow.setSize(new LogicalSize(BAR_W, BAR_H));
      await appWindow.setResizable(false);
      if (savedPosRef.current) {
        await appWindow.setPosition(new LogicalPosition(savedPosRef.current.x, savedPosRef.current.y));
      } else {
        await appWindow.center();
      }
    } catch {}
  }, []);

  const finishRegionPick = useCallback(async (rect: { x: number; y: number; width: number; height: number } | null) => {
    setRegionPicking(false);
    setDragStart(null);
    setDragCurrent(null);
    await restoreBar();

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
    }
  }, [pendingAction, getDir, restoreBar]);

  const onRegionMouseDown = useCallback((e: React.MouseEvent) => {
    const pt = { x: e.clientX, y: e.clientY };
    startRef.current = pt;
    currentRef.current = pt;
    setDragStart(pt);
    setDragCurrent(pt);
  }, []);

  const onRegionMouseMove = useCallback((e: React.MouseEvent) => {
    if (!startRef.current) return;
    const pt = { x: e.clientX, y: e.clientY };
    currentRef.current = pt;
    setDragCurrent(pt);
  }, []);

  const onRegionMouseUp = useCallback(() => {
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

  const doScreenshot = useCallback(() => {
    if (isTauri) startRegionPick('screenshot');
  }, [startRegionPick]);

  const doRecord = useCallback(() => {
    if (!isTauri) return;
    if (recording) {
      invoke('screen_record_stop').then(() => setRecording(false)).catch(() => {});
      return;
    }
    startRegionPick('record');
  }, [startRegionPick, recording]);

  const handleSelectDir = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({ directory: true, title: '\u9009\u62E9\u4FDD\u5B58\u76EE\u5F55' });
      if (selected && typeof selected === 'string') {
        setSaveDir(selected);
        saveCaptureOutputDir(selected);
      }
    } catch {}
  }, []);

  const toggleSettings = useCallback(async () => {
    if (showSettings) {
      setShowSettings(false);
      appWindow.setSize(new LogicalSize(BAR_W, BAR_H)).catch(() => {});
    } else {
      setShowSettings(true);
      appWindow.setSize(new LogicalSize(BAR_W, SETTINGS_H)).catch(() => {});
    }
  }, [showSettings]);

  if (regionPicking) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, cursor: 'crosshair', background: 'rgba(0,0,0,0.3)' }}
        onMouseDown={onRegionMouseDown}
        onMouseMove={onRegionMouseMove}
        onMouseUp={onRegionMouseUp}
        onMouseLeave={() => { if (startRef.current) onRegionMouseUp(); }}
      >
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', padding: '12px 0', textAlign: 'center', color: 'rgba(255,255,255,0.9)', fontSize: 14, background: 'rgba(0,0,0,0.3)' }}>
          {'\u62D6\u52A8\u9F20\u6807\u6846\u9009\u533A\u57DF\uFF0C\u677E\u5F00\u5B8C\u6210 \u00B7 Esc \u53D6\u6D88'}
        </div>
        {dragStart && dragCurrent && (
          <div style={{
            position: 'absolute',
            border: '2px solid #60a5fa',
            background: 'rgba(59,130,246,0.15)',
            pointerEvents: 'none',
            left: Math.min(dragStart.x, dragCurrent.x),
            top: Math.min(dragStart.y, dragCurrent.y),
            width: Math.abs(dragCurrent.x - dragStart.x),
            height: Math.abs(dragCurrent.y - dragStart.y),
          }} />
        )}
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#1a1a1a',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
    }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          height: BAR_H,
          minHeight: BAR_H,
          cursor: 'grab',
          userSelect: 'none' as const,
        }}
        onMouseDown={handleDrag}
      >
        {recording ? (
          <>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
            <span style={{ fontSize: 12, color: '#f87171', fontVariantNumeric: 'tabular-nums', marginRight: 4 }}>
              {Math.floor(recordElapsedMs / 60000).toString().padStart(2, '0')}:
              {Math.floor((recordElapsedMs % 60000) / 1000).toString().padStart(2, '0')}
            </span>
            <button type="button" onClick={doRecord}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
              <StopCircle size={14} /> {'\u505C\u6B62'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={doScreenshot}
              style={{ background: '#2a2a2a', color: '#ccc', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
              <Camera size={14} /> {'\u622A\u56FE'}
            </button>
            <button type="button" onClick={doRecord}
              style={{ background: '#2a2a2a', color: '#ccc', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
              <Square size={14} /> {'\u5F55\u5C4F'}
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />

        <button type="button" onClick={toggleSettings}
          style={{ background: 'none', border: 'none', padding: 6, borderRadius: 8, color: showSettings ? '#fff' : '#666', cursor: 'pointer' }}>
          <Settings size={16} />
        </button>
        <div style={{ width: 1, height: 20, background: '#333' }} />
        <button type="button" onClick={() => appWindow.close().catch(() => {})}
          style={{ background: 'none', border: 'none', padding: 6, borderRadius: 8, color: '#666', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>

      {showSettings && (
        <div style={{ borderTop: '1px solid #333', padding: '10px 12px' }}>
          <label style={{ fontSize: 10, color: '#666', display: 'block', marginBottom: 4 }}>{'\u4FDD\u5B58\u76EE\u5F55'}</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              readOnly
              value={saveDir}
              style={{
                flex: 1, background: '#111', border: '1px solid #333', borderRadius: 6,
                padding: '4px 8px', fontSize: 12, color: '#ccc', outline: 'none',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}
              placeholder={'\u672A\u8BBE\u7F6E'}
            />
            <button type="button" onClick={handleSelectDir}
              style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <FolderOpen size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
