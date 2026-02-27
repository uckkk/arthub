import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Square, Crop, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  getCaptureOutputDir,
  saveCaptureOutputDir,
  saveLastRecordPath,
} from '../services/hotkeyService';
import { addPendingImport } from '../services/whiteboardPendingImport';

const CAPTURE_MODE_KEY = 'arthub_capture_mode';

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;

function buildOutputPath(dirOrFile: string, ext: 'png' | 'mp4') {
  const base = dirOrFile.trim().replace(/[/\\]+$/, '');
  if (!base) return '';
  const isFile = base.toLowerCase().endsWith('.png') || base.toLowerCase().endsWith('.mp4');
  if (isFile)
    return ext === 'png'
      ? base.endsWith('.png')
        ? base
        : base + '.png'
      : base.endsWith('.mp4')
        ? base
        : base + '.mp4';
  const sep = base.includes('/') ? '/' : '\\';
  const name =
    ext === 'png'
      ? `截图_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.png`
      : `录屏_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.mp4`;
  return `${base}${sep}${name}`;
}

export interface CaptureFloatingBarProps {
  visible: boolean;
  suggestedAction?: 'screenshot' | 'record' | null;
  onClose: () => void;
  onRequestRegionPicker: (action: 'screenshot' | 'record') => void;
  onCaptureDone?: (type: 'screenshot' | 'record') => void;
}

export default function CaptureFloatingBar({
  visible,
  suggestedAction = null,
  onClose,
  onRequestRegionPicker,
  onCaptureDone,
}: CaptureFloatingBarProps) {
  const [captureMode, setCaptureMode] = useState<'fullscreen' | 'region'>(() => {
    try {
      const s = localStorage.getItem(CAPTURE_MODE_KEY);
      if (s === 'region' || s === 'fullscreen') return s;
    } catch {}
    return 'fullscreen';
  });

  useEffect(() => {
    try {
      localStorage.setItem(CAPTURE_MODE_KEY, captureMode);
    } catch {}
  }, [captureMode]);

  const doScreenshot = useCallback(() => {
    if (!isTauri) return;
    const dir = getCaptureOutputDir().trim().replace(/[/\\]+$/, '');
    if (!dir) {
      window.dispatchEvent(new CustomEvent('arthub-capture-no-dir', { detail: { type: 'screenshot' } }));
      onClose();
      return;
    }
    if (captureMode === 'region') {
      onRequestRegionPicker('screenshot');
      onClose();
      return;
    }
    const path = buildOutputPath(dir, 'png');
    invoke('screen_screenshot', { outputPath: path, region: null })
      .then(() => {
        addPendingImport(path);
        saveCaptureOutputDir(dir);
        window.dispatchEvent(new CustomEvent('arthub-capture-saved-to-canvas', { detail: { type: 'screenshot' as const } }));
        onCaptureDone?.('screenshot');
      })
      .catch(() => {
        window.dispatchEvent(new CustomEvent('arthub-capture-error', { detail: { type: 'screenshot', error: null } }));
      });
    onClose();
  }, [captureMode, onClose, onRequestRegionPicker, onCaptureDone]);

  const doRecord = useCallback(() => {
    if (!isTauri) return;
    const dir = getCaptureOutputDir().trim().replace(/[/\\]+$/, '');
    if (!dir) {
      window.dispatchEvent(new CustomEvent('arthub-capture-no-dir', { detail: { type: 'record' } }));
      onClose();
      return;
    }
    if (captureMode === 'region') {
      onRequestRegionPicker('record');
      onClose();
      return;
    }
    const path = buildOutputPath(dir, 'mp4');
    invoke('screen_record_start', { outputPath: path, region: null, crf: 22 })
      .then(() => {
        saveLastRecordPath(path);
        saveCaptureOutputDir(dir);
        window.dispatchEvent(new CustomEvent('arthub-record-started', { detail: { path } }));
        onCaptureDone?.('record');
      })
      .catch(() => {
        window.dispatchEvent(new CustomEvent('arthub-capture-error', { detail: { type: 'record', error: null } }));
      });
    onClose();
  }, [captureMode, onClose, onRequestRegionPicker, onCaptureDone]);

  if (!visible) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#333] shadow-xl"
      role="dialog"
      aria-label="截图/录屏快捷栏"
    >
      <div className="flex items-center gap-1">
        <span className="text-xs text-[#888] mr-1">范围</span>
        <button
          type="button"
          onClick={() => setCaptureMode('fullscreen')}
          className={`px-2.5 py-1 rounded-lg text-sm ${captureMode === 'fullscreen' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-white'}`}
        >
          全屏
        </button>
        <button
          type="button"
          onClick={() => setCaptureMode('region')}
          className={`px-2.5 py-1 rounded-lg text-sm flex items-center gap-1 ${captureMode === 'region' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-white'}`}
        >
          <Crop size={12} />
          区域
        </button>
      </div>
      <div className="w-px h-5 bg-[#333]" />
      <button
        type="button"
        onClick={doScreenshot}
        className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 font-medium transition-colors ${
          suggestedAction === 'screenshot' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-[#2a2a2a] text-[#ccc] hover:bg-[#333]'
        }`}
      >
        <Camera size={14} />
        截图
      </button>
      <button
        type="button"
        onClick={doRecord}
        className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 font-medium transition-colors ${
          suggestedAction === 'record' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-[#2a2a2a] text-[#ccc] hover:bg-[#333]'
        }`}
      >
        <Square size={14} />
        录屏
      </button>
      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-lg text-[#666] hover:text-white hover:bg-[#333]"
        aria-label="关闭"
      >
        <X size={16} />
      </button>
    </div>
  );
}
