import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FolderOpen, Plus, Trash2, RefreshCw, Search, ChevronDown, ChevronRight,
  X, ZoomIn, ArrowLeft, ArrowRight, Grid, LayoutGrid, Loader2,
  Image as ImageIcon, Film, Box, FileQuestion, HardDrive, Globe,
  Star, Tag, MessageSquare, Sparkles, Edit3, Check, Palette, Copy,
  MoreHorizontal, ChevronUp, SlidersHorizontal, Bookmark,
  Lock, Unlock, History, Shield, Users, AlertTriangle, Clock,
  Settings, Download, Video, Music
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import { useToast } from './Toast';
import AssetComparePanel from './AssetComparePanel';

const LazyModelViewer3D = React.lazy(() => import('./ModelViewer3D'));

// ============================================================
// Types
// ============================================================

interface AssetFolder {
  id: number;
  path: string;
  name: string;
  space_type: string;
  asset_count: number;
}

interface AssetEntry {
  id: number;
  folder_id: number;
  file_path: string;
  file_name: string;
  file_ext: string;
  file_size: number;
  width: number;
  height: number;
  thumb_path: string;
  modified_at: number;
}

interface ScanProgress {
  folder_id: number;
  current: number;
  total: number;
  file_name: string;
  phase: string;
}

interface QueryResult {
  assets: AssetEntry[];
  total: number;
  page: number;
  page_size: number;
}

interface FolderStats {
  total_assets: number;
  total_folders: number;
  total_size: number;
  format_counts: [string, number][];
}

interface TagInfo {
  id: number;
  name: string;
  color: string;
  asset_count: number;
}

interface AssetDetail {
  asset: AssetEntry;
  tags: TagInfo[];
  rating: number;
  note: string;
}

interface SmartFolder {
  id: number;
  name: string;
  icon: string;
  conditions: string; // JSON string
  space_type: string;
}

interface SmartFolderConditions {
  name_contains?: string;
  extensions?: string[];
  min_size?: number;
  max_size?: number;
  min_rating?: number;
  tag_ids?: number[];
}

// Phase 3: Team collaboration types
interface FileLockInfo {
  file_path: string;
  locked_by: string;
  machine: string;
  locked_at: number;
  heartbeat: number;
}

interface LockStatusInfo {
  is_locked: boolean;
  locked_by: string | null;
  machine: string | null;
  locked_at: number | null;
  is_stale: boolean;
}

interface FileVersionInfo {
  version: number;
  author: string;
  timestamp: number;
  comment: string;
  snapshot_name: string;
  file_size: number;
}

interface FileHistoryInfo {
  file_path: string;
  current_version: number;
  versions: FileVersionInfo[];
}

interface PermissionInfo {
  user: string;
  role: string;
}

interface PermissionsConfigInfo {
  global: PermissionInfo[];
  projects: { project_path: string; permissions: PermissionInfo[] }[];
}

interface FfmpegStatusInfo {
  installed: boolean;
  path: string | null;
  version: string | null;
}

interface FfmpegDownloadProgress {
  phase: string;
  progress: number;
  message: string;
}

type SpaceType = 'personal' | 'team';

// Predefined tag colors
const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#6b7280',
];

// ============================================================
// Helpers
// ============================================================

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'ico', 'svg', 'psd', 'tga', 'dds', 'hdr', 'exr']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a', 'opus']);
const MESH_EXTS = new Set(['fbx', 'obj', 'gltf', 'glb', 'blend', '3ds', 'dae', 'stl']);
const SPINE_EXTS = new Set(['spine', 'skel', 'atlas']);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'MB';
  return (bytes / 1073741824).toFixed(1) + 'GB';
}

function formatDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getFileIcon(ext: string) {
  if (IMAGE_EXTS.has(ext)) return ImageIcon;
  if (VIDEO_EXTS.has(ext)) return Film;
  if (AUDIO_EXTS.has(ext)) return Music;
  if (MESH_EXTS.has(ext)) return Box;
  if (SPINE_EXTS.has(ext)) return Box;
  return FileQuestion;
}

// Ext → display color
function getExtColor(ext: string): string {
  const map: Record<string, string> = {
    png: '#4ade80', jpg: '#facc15', jpeg: '#facc15', gif: '#c084fc',
    psd: '#38bdf8', webp: '#f472b6', svg: '#fb923c', tga: '#a78bfa',
    mp4: '#ef4444', mov: '#ef4444', avi: '#ef4444', mkv: '#ef4444', webm: '#ef4444',
    mp3: '#a855f7', wav: '#a855f7', ogg: '#a855f7', flac: '#a855f7', aac: '#a855f7',
    fbx: '#22d3ee', obj: '#22d3ee', gltf: '#22d3ee', glb: '#22d3ee', blend: '#22d3ee',
    spine: '#f97316', skel: '#f97316', atlas: '#f97316',
  };
  return map[ext] || '#6b7280';
}

// ============================================================
// Star Rating Component
// ============================================================

const StarRating: React.FC<{
  rating: number;
  onChange?: (rating: number) => void;
  size?: number;
  readonly?: boolean;
}> = ({ rating, onChange, size = 14, readonly = false }) => {
  const [hoverRating, setHoverRating] = useState(0);
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHoverRating(0)}>
      {[1, 2, 3, 4, 5].map(v => (
        <button
          key={v}
          disabled={readonly}
          className={`transition-colors ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
          onClick={e => { e.stopPropagation(); onChange?.(rating === v ? 0 : v); }}
          onMouseEnter={() => !readonly && setHoverRating(v)}
        >
          <Star
            size={size}
            className={`transition-colors ${
              v <= (hoverRating || rating)
                ? 'text-yellow-400 fill-yellow-400'
                : 'text-[#333]'
            }`}
          />
        </button>
      ))}
    </div>
  );
};

// ============================================================
// Tag Badge Component
// ============================================================

const TagBadge: React.FC<{
  tag: TagInfo;
  removable?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  size?: 'sm' | 'md';
}> = ({ tag, removable, onRemove, onClick, size = 'sm' }) => {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium transition-colors cursor-default ${
        size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'
      } ${onClick ? 'cursor-pointer hover:brightness-110' : ''}`}
      style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}33` }}
      onClick={e => { e.stopPropagation(); onClick?.(); }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tag.color }} />
      {tag.name}
      {removable && (
        <button
          className="ml-0.5 hover:brightness-150"
          onClick={e => { e.stopPropagation(); onRemove?.(); }}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
};

// ============================================================
// Tag Manager Panel (Create / Edit / Delete tags)
// ============================================================

const TagManagerPanel: React.FC<{
  tags: TagInfo[];
  onCreateTag: (name: string, color: string) => void;
  onDeleteTag: (tagId: number) => void;
  onUpdateTag: (tagId: number, name: string, color: string) => void;
  onClose: () => void;
}> = ({ tags, onCreateTag, onDeleteTag, onUpdateTag, onClose }) => {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateTag(newName.trim(), newColor);
    setNewName('');
  };

  const startEdit = (tag: TagInfo) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const saveEdit = () => {
    if (editingId && editName.trim()) {
      onUpdateTag(editingId, editName.trim(), editColor);
      setEditingId(null);
    }
  };

  return (
    <div className="absolute top-full left-0 mt-1 w-72 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl z-50 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[#ccc]">标签管理</span>
        <button onClick={onClose} className="text-[#666] hover:text-[#aaa]"><X size={14} /></button>
      </div>

      {/* Create new tag */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="新标签名称..."
          className="flex-1 bg-[#111] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]"
        />
        <div className="relative group">
          <button
            className="w-6 h-6 rounded border border-[#333]"
            style={{ background: newColor }}
            title="选择颜色"
          />
          <div className="hidden group-hover:grid grid-cols-5 gap-1 absolute top-full right-0 mt-1 bg-[#222] border border-[#333] rounded p-1.5 z-10 w-32">
            {TAG_COLORS.map(c => (
              <button
                key={c}
                className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${c === newColor ? 'border-white' : 'border-transparent'}`}
                style={{ background: c }}
                onClick={() => setNewColor(c)}
              />
            ))}
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="text-[#3b82f6] hover:text-[#60a5fa] disabled:text-[#333]"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Existing tags */}
      <div className="max-h-48 overflow-y-auto space-y-1">
        {tags.map(tag => (
          <div key={tag.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[#222] group">
            {editingId === tag.id ? (
              <>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveEdit()}
                  className="flex-1 bg-[#111] border border-[#3b82f6] rounded px-1.5 py-0.5 text-xs text-[#ccc] outline-none"
                  autoFocus
                />
                <button onClick={saveEdit} className="text-[#22c55e] hover:text-[#4ade80]"><Check size={12} /></button>
                <button onClick={() => setEditingId(null)} className="text-[#666] hover:text-[#aaa]"><X size={12} /></button>
              </>
            ) : (
              <>
                <span className="w-3 h-3 rounded-full flex-none" style={{ background: tag.color }} />
                <span className="flex-1 text-xs text-[#ccc] truncate">{tag.name}</span>
                <span className="text-[10px] text-[#555]">{tag.asset_count}</span>
                <button onClick={() => startEdit(tag)} className="hidden group-hover:block text-[#555] hover:text-[#aaa]"><Edit3 size={11} /></button>
                <button onClick={() => onDeleteTag(tag.id)} className="hidden group-hover:block text-[#555] hover:text-[#ef4444]"><Trash2 size={11} /></button>
              </>
            )}
          </div>
        ))}
        {tags.length === 0 && (
          <p className="text-center text-[10px] text-[#555] py-3">暂无标签，创建一个吧</p>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Image Analysis Section (toggle in detail sidebar)
// ============================================================
const ImageAnalysisSection: React.FC<{ filePath: string }> = ({ filePath }) => {
  const [enabled, setEnabled] = useState(false);
  const [analysisData, setAnalysisData] = useState<{
    colors: { hex: string; pct: number }[];
    avgBrightness: number;
    contrastScore: number;
    colorCount: number;
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const runAnalysis = useCallback(async () => {
    if (analysisData) return; // already analyzed
    setAnalyzing(true);
    try {
      const url = convertFileSrc(filePath);
      const img = await new Promise<HTMLImageElement>((ok, f) => {
        const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = f; i.src = url;
      });
      // Downsample for analysis
      const maxDim = 200;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      // Color extraction: simple quantization
      const colorMap = new Map<string, number>();
      let totalBright = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // Quantize to 32-step
        const qr = (r >> 3) << 3, qg = (g >> 3) << 3, qb = (b >> 3) << 3;
        const hex = '#' + [qr, qg, qb].map(v => v.toString(16).padStart(2, '0')).join('');
        colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
        totalBright += (r * 0.299 + g * 0.587 + b * 0.114);
      }
      const totalPx = w * h;
      const sorted = [...colorMap.entries()].sort((a, b) => b[1] - a[1]);
      const colors = sorted.slice(0, 8).map(([hex, cnt]) => ({ hex, pct: Math.round(cnt / totalPx * 100) }));
      // Contrast: std deviation of brightness
      const avgB = totalBright / totalPx;
      let variance = 0;
      for (let i = 0; i < data.length; i += 4) {
        const b = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        variance += (b - avgB) ** 2;
      }
      const contrastScore = Math.min(100, Math.round(Math.sqrt(variance / totalPx) / 128 * 100));
      setAnalysisData({ colors, avgBrightness: Math.round(avgB), contrastScore, colorCount: colorMap.size });
    } catch (e) { console.error('Analysis failed:', e); }
    setAnalyzing(false);
  }, [filePath, analysisData]);

  useEffect(() => { if (enabled) runAnalysis(); }, [enabled, runAnalysis]);
  // Reset when file changes
  useEffect(() => { setAnalysisData(null); setEnabled(false); }, [filePath]);

  return (
    <>
      <div className="border-t border-[#1a1a1a]" />
      <div className="px-3 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-[#666]" />
            <span className="text-[11px] text-[#888]">图片分析</span>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={'relative w-8 h-4 rounded-full transition-colors ' + (enabled ? 'bg-[#3b82f6]' : 'bg-[#333]')}
          >
            <div className={'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ' + (enabled ? 'left-4.5' : 'left-0.5')} style={{ left: enabled ? 18 : 2 }} />
          </button>
        </div>
        {enabled && (
          <div className="space-y-3">
            {analyzing && (
              <div className="flex items-center gap-2 text-[11px] text-[#888]">
                <Loader2 size={12} className="animate-spin" /> 分析中...
              </div>
            )}
            {analysisData && (
              <>
                {/* Color palette */}
                <div>
                  <span className="text-[10px] text-[#666] uppercase tracking-wider">主色调</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {analysisData.colors.map((c, i) => (
                      <div key={i} className="group relative">
                        <div className="w-6 h-6 rounded border border-[#333]" style={{ background: c.hex }} title={`${c.hex} (${c.pct}%)`} />
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-black/80 rounded px-1.5 py-0.5 text-[9px] text-white whitespace-nowrap z-10">
                          {c.hex} {c.pct}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-[#111] rounded p-2">
                    <div className="text-[#666] text-[9px] uppercase">亮度</div>
                    <div className="text-[#ccc] font-medium">{analysisData.avgBrightness}/255</div>
                    <div className="mt-1 h-1 bg-[#222] rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${(analysisData.avgBrightness / 255) * 100}%` }} />
                    </div>
                  </div>
                  <div className="bg-[#111] rounded p-2">
                    <div className="text-[#666] text-[9px] uppercase">对比度</div>
                    <div className="text-[#ccc] font-medium">{analysisData.contrastScore}%</div>
                    <div className="mt-1 h-1 bg-[#222] rounded-full overflow-hidden">
                      <div className={'h-full rounded-full ' + (analysisData.contrastScore > 60 ? 'bg-green-500' : analysisData.contrastScore > 30 ? 'bg-yellow-500' : 'bg-red-500')} style={{ width: `${analysisData.contrastScore}%` }} />
                    </div>
                  </div>
                  <div className="bg-[#111] rounded p-2 col-span-2">
                    <div className="text-[#666] text-[9px] uppercase">色彩丰富度</div>
                    <div className="text-[#ccc] font-medium">{analysisData.colorCount} 种色值</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// ============================================================
// Asset Detail Sidebar
// ============================================================

const AssetDetailSidebar: React.FC<{
  asset: AssetEntry;
  detail: AssetDetail | null;
  allTags: TagInfo[];
  onClose: () => void;
  onSetRating: (rating: number) => void;
  onSetNote: (note: string) => void;
  onAddTag: (tagId: number) => void;
  onRemoveTag: (tagId: number) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  // Team features
  isTeamSpace?: boolean;
  lockStatus?: LockStatusInfo | null;
  currentUser?: string;
  onLock?: () => void;
  onUnlock?: () => void;
  fileHistory?: FileHistoryInfo | null;
  onRestoreVersion?: (version: number) => void;
}> = ({ asset, detail, allTags, onClose, onSetRating, onSetNote, onAddTag, onRemoveTag,
  isFavorite, onToggleFavorite,
  isTeamSpace, lockStatus, currentUser, onLock, onUnlock, fileHistory, onRestoreVersion }) => {
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [showTagPicker, setShowTagPicker] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (detail) setNoteText(detail.note || '');
  }, [detail?.note]);

  useEffect(() => {
    if (editingNote && noteRef.current) noteRef.current.focus();
  }, [editingNote]);

  const thumbUrl = asset.thumb_path ? convertFileSrc(asset.thumb_path) : '';
  const detailTags = detail?.tags || [];
  const availableTags = allTags.filter(t => !detailTags.some(dt => dt.id === t.id));

  return (
    <div className="flex-none w-72 border-l border-[#222] bg-[#0d0d0d] flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a]">
        <span className="text-xs font-medium text-[#888]">资源详情</span>
        <button onClick={onClose} className="text-[#555] hover:text-[#aaa]"><X size={14} /></button>
      </div>

      {/* Preview thumbnail */}
      <div className="p-3">
        <div className="w-full rounded-lg overflow-hidden bg-[#1a1a1a] border border-[#2a2a2a]" style={{ aspectRatio: asset.width && asset.height ? `${asset.width}/${asset.height}` : '1/1', maxHeight: 300 }}>
          {thumbUrl ? (
            <img src={thumbUrl} alt={asset.file_name} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#444]">
              {React.createElement(getFileIcon(asset.file_ext), { size: 48 })}
            </div>
          )}
        </div>
      </div>

      {/* File info */}
      <div className="px-3 pb-3 space-y-2">
        <div>
          <p className="text-xs text-[#ccc] font-medium break-all">{asset.file_name}</p>
          <p className="text-[10px] text-[#555] break-all mt-0.5">{asset.file_path}</p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#777]">
          {asset.width > 0 && <span>{asset.width} × {asset.height}</span>}
          <span>{formatFileSize(asset.file_size)}</span>
          <span>{formatDate(asset.modified_at)}</span>
          <span className="uppercase" style={{ color: getExtColor(asset.file_ext) }}>{asset.file_ext}</span>
        </div>
      </div>

      <div className="border-t border-[#1a1a1a]" />

      {/* Rating */}
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Star size={12} className="text-[#666]" />
          <span className="text-[11px] text-[#888]">评分</span>
        </div>
        <div className="flex items-center gap-3">
          <StarRating rating={detail?.rating || 0} onChange={onSetRating} size={18} />
          <button
            onClick={onToggleFavorite}
            className={`ml-auto p-1.5 rounded-lg transition-colors ${
              isFavorite ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'text-[#555] hover:text-[#f59e0b] hover:bg-[#f59e0b]/10'
            }`}
            title={isFavorite ? '取消收藏' : '收藏'}
          >
            <Bookmark size={16} className={isFavorite ? 'fill-[#f59e0b]' : ''} />
          </button>
        </div>
      </div>

      <div className="border-t border-[#1a1a1a]" />

      {/* Tags */}
      <div className="px-3 py-3 relative">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <Tag size={12} className="text-[#666]" />
            <span className="text-[11px] text-[#888]">标签</span>
          </div>
          <button
            onClick={() => setShowTagPicker(!showTagPicker)}
            className="text-[#555] hover:text-[#3b82f6]"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {detailTags.map(tag => (
            <TagBadge key={tag.id} tag={tag} removable onRemove={() => onRemoveTag(tag.id)} size="md" />
          ))}
          {detailTags.length === 0 && <span className="text-[10px] text-[#444]">暂无标签</span>}
        </div>
        {/* Tag picker dropdown */}
        {showTagPicker && availableTags.length > 0 && (
          <div className="mt-2 bg-[#1a1a1a] border border-[#333] rounded-lg p-2 max-h-32 overflow-y-auto">
            <div className="flex flex-wrap gap-1">
              {availableTags.map(tag => (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  onClick={() => { onAddTag(tag.id); setShowTagPicker(false); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[#1a1a1a]" />

      {/* Note */}
      <div className="px-3 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <MessageSquare size={12} className="text-[#666]" />
            <span className="text-[11px] text-[#888]">备注</span>
          </div>
          <button
            onClick={() => {
              if (editingNote) {
                onSetNote(noteText);
                setEditingNote(false);
              } else {
                setEditingNote(true);
              }
            }}
            className="text-[#555] hover:text-[#3b82f6]"
          >
            {editingNote ? <Check size={14} /> : <Edit3 size={12} />}
          </button>
        </div>
        {editingNote ? (
          <textarea
            ref={noteRef}
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onBlur={() => { onSetNote(noteText); setEditingNote(false); }}
            className="w-full bg-[#111] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6] resize-none"
            rows={4}
            placeholder="添加备注..."
          />
        ) : (
          <p
            className={`text-xs cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-[#1a1a1a] ${noteText ? 'text-[#aaa]' : 'text-[#444] italic'}`}
            onClick={() => setEditingNote(true)}
          >
            {noteText || '点击添加备注'}
          </p>
        )}
      </div>

      {/* Team features */}
      {isTeamSpace && (
        <>
          <div className="border-t border-[#1a1a1a]" />

          {/* Lock status */}
          <div className="px-3 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Lock size={12} className="text-[#666]" />
              <span className="text-[11px] text-[#888]">编辑锁定</span>
            </div>
            <LockIndicator
              lockStatus={lockStatus || null}
              currentUser={currentUser || ''}
              onLock={onLock || (() => {})}
              onUnlock={onUnlock || (() => {})}
            />
          </div>

          <div className="border-t border-[#1a1a1a]" />

          {/* Version history */}
          <div className="px-3 py-3 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <History size={12} className="text-[#666]" />
              <span className="text-[11px] text-[#888]">版本历史</span>
            </div>
            <VersionHistoryPanel
              history={fileHistory || null}
              onRestore={onRestoreVersion || (() => {})}
              onClose={() => {}}
            />
          </div>
        </>
      )}

      {/* Image Analysis (toggle) */}
      {IMAGE_EXTS.has(asset.file_ext) && <ImageAnalysisSection filePath={asset.file_path} />}
    </div>
  );
};

// ============================================================
// Smart Folder Editor Modal
// ============================================================

const SmartFolderEditor: React.FC<{
  folder?: SmartFolder | null;
  allTags: TagInfo[];
  onSave: (name: string, conditions: SmartFolderConditions) => void;
  onClose: () => void;
}> = ({ folder, allTags, onSave, onClose }) => {
  const existing: SmartFolderConditions = folder ? JSON.parse(folder.conditions || '{}') : {};
  const [name, setName] = useState(folder?.name || '');
  const [nameContains, setNameContains] = useState(existing.name_contains || '');
  const [extensions, setExtensions] = useState(existing.extensions?.join(', ') || '');
  const [minRating, setMinRating] = useState(existing.min_rating || 0);
  const [selectedTags, setSelectedTags] = useState<number[]>(existing.tag_ids || []);

  const handleSave = () => {
    if (!name.trim()) return;
    const conds: SmartFolderConditions = {};
    if (nameContains.trim()) conds.name_contains = nameContains.trim();
    if (extensions.trim()) conds.extensions = extensions.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (minRating > 0) conds.min_rating = minRating;
    if (selectedTags.length > 0) conds.tag_ids = selectedTags;
    onSave(name.trim(), conds);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl w-96 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
          <Sparkles size={16} className="text-[#f59e0b]" />
          {folder ? '编辑智能文件夹' : '新建智能文件夹'}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-[#888] mb-1">名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如: 高分 PNG"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#888] mb-1">文件名包含</label>
            <input
              type="text"
              value={nameContains}
              onChange={e => setNameContains(e.target.value)}
              placeholder="例如: hero"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#888] mb-1">格式 (逗号分隔)</label>
            <input
              type="text"
              value={extensions}
              onChange={e => setExtensions(e.target.value)}
              placeholder="例如: png, jpg, psd"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#888] mb-1">最低评分</label>
            <StarRating rating={minRating} onChange={setMinRating} size={16} />
          </div>

          {allTags.length > 0 && (
            <div>
              <label className="block text-[11px] text-[#888] mb-1">包含标签</label>
              <div className="flex flex-wrap gap-1">
                {allTags.map(tag => {
                  const selected = selectedTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                        selected ? 'border-transparent' : 'border-[#333] opacity-50 hover:opacity-80'
                      }`}
                      style={selected ? { background: tag.color + '33', color: tag.color, border: `1px solid ${tag.color}` } : {}}
                      onClick={() => setSelectedTags(prev => selected ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[#888] hover:text-[#ccc] rounded-lg">取消</button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="px-4 py-1.5 text-xs bg-[#2563eb] text-white rounded-lg hover:bg-[#1d4ed8] disabled:opacity-40 transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Lock Status Indicator
// ============================================================

const LockIndicator: React.FC<{
  lockStatus: LockStatusInfo | null;
  currentUser: string;
  onLock: () => void;
  onUnlock: () => void;
}> = ({ lockStatus, currentUser, onLock, onUnlock }) => {
  if (!lockStatus) return null;

  if (lockStatus.is_locked && lockStatus.locked_by) {
    const isMine = lockStatus.locked_by === currentUser;
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
        isMine ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-[#ef4444]/10 text-[#ef4444]'
      }`}>
        <Lock size={13} />
        <span>
          {isMine ? '你正在编辑' : `${lockStatus.locked_by} 正在编辑`}
        </span>
        {isMine && (
          <button onClick={onUnlock} className="ml-auto text-[#666] hover:text-[#aaa]" title="释放锁定">
            <Unlock size={12} />
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={onLock}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-[#1a1a1a] text-[#888] hover:text-[#ccc] hover:bg-[#222] transition-colors w-full"
    >
      <Unlock size={13} />
      <span>点击锁定编辑</span>
    </button>
  );
};

// ============================================================
// Version History Panel
// ============================================================

const VersionHistoryPanel: React.FC<{
  history: FileHistoryInfo | null;
  onRestore: (version: number) => void;
  onClose: () => void;
}> = ({ history, onRestore, onClose }) => {
  if (!history) {
    return (
      <div className="p-4 text-center text-[11px] text-[#555]">
        <History size={24} className="mx-auto mb-2 text-[#333]" />
        <p>暂无版本历史</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[11px] text-[#888]">
          当前版本: v{history.current_version} ({history.versions.length} 个版本)
        </span>
      </div>
      {history.versions.slice().reverse().map(v => (
        <div
          key={v.version}
          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs group hover:bg-[#1a1a1a] ${
            v.version === history.current_version ? 'bg-[#1a1a1a] border border-[#2a2a2a]' : ''
          }`}
        >
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
            v.version === history.current_version ? 'bg-[#3b82f6] text-white' : 'bg-[#222] text-[#666]'
          }`}>
            {v.version}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[#ccc] truncate">{v.comment || '无备注'}</div>
            <div className="text-[10px] text-[#555]">
              {v.author} · {formatDate(v.timestamp)} · {formatFileSize(v.file_size)}
            </div>
          </div>
          {v.version !== history.current_version && (
            <button
              onClick={() => onRestore(v.version)}
              className="hidden group-hover:flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]"
            >
              <History size={10} /> 恢复
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

// ============================================================
// Right-Click Context Menu
// ============================================================

interface ContextMenuState {
  x: number;
  y: number;
  assetId: number;
  assetIndex: number;
}

const ContextMenu: React.FC<{
  menu: ContextMenuState;
  allTags: TagInfo[];
  assetTags: number[];
  assetRating: number;
  onClose: () => void;
  onAddTag: (tagId: number) => void;
  onRemoveTag: (tagId: number) => void;
  onSetRating: (rating: number) => void;
  onCopyPath: () => void;
  onShowDetail: () => void;
}> = ({ menu, allTags, assetTags, assetRating, onClose, onAddTag, onRemoveTag, onSetRating, onCopyPath, onShowDetail }) => {
  const [showTagSub, setShowTagSub] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('click', handler);
    window.addEventListener('scroll', handler, true);
    return () => { window.removeEventListener('click', handler); window.removeEventListener('scroll', handler, true); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[60] bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl py-1 min-w-[180px]"
      style={{ left: menu.x, top: menu.y }}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#2a2a2a] flex items-center gap-2"
        onClick={() => { onShowDetail(); onClose(); }}
      >
        <SlidersHorizontal size={12} /> 查看详情
      </button>
      <button
        className="w-full text-left px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#2a2a2a] flex items-center gap-2"
        onClick={() => { onCopyPath(); onClose(); }}
      >
        <Copy size={12} /> 复制路径
      </button>

      <div className="border-t border-[#222] my-1" />

      {/* Rating */}
      <div className="px-3 py-1.5 flex items-center gap-2">
        <Star size={12} className="text-[#666]" />
        <StarRating rating={assetRating} onChange={r => { onSetRating(r); onClose(); }} size={13} />
      </div>

      <div className="border-t border-[#222] my-1" />

      {/* Tags submenu */}
      <div
        className="relative"
        onMouseEnter={() => setShowTagSub(true)}
        onMouseLeave={() => setShowTagSub(false)}
      >
        <div className="px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#2a2a2a] flex items-center gap-2 cursor-pointer">
          <Tag size={12} /> 标签
          <ChevronRight size={12} className="ml-auto" />
        </div>
        {showTagSub && (
          <div className="absolute left-full top-0 ml-1 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl py-1 min-w-[160px] max-h-48 overflow-y-auto">
            {allTags.map(tag => {
              const hasTag = assetTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  className="w-full text-left px-3 py-1 text-xs hover:bg-[#2a2a2a] flex items-center gap-2"
                  onClick={() => { hasTag ? onRemoveTag(tag.id) : onAddTag(tag.id); }}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: tag.color }} />
                  <span className={hasTag ? 'text-white' : 'text-[#888]'}>{tag.name}</span>
                  {hasTag && <Check size={11} className="ml-auto text-[#22c55e]" />}
                </button>
              );
            })}
            {allTags.length === 0 && (
              <div className="px-3 py-2 text-[10px] text-[#555]">暂无标签</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// FFmpeg Settings Panel
// ============================================================

const FfmpegSettingsPanel: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const [status, setStatus] = useState<FfmpegStatusInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<FfmpegDownloadProgress | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const s = await invoke<FfmpegStatusInfo>('ffmpeg_check');
        setStatus(s);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<FfmpegDownloadProgress>('ffmpeg-download-progress', (event) => {
        setProgress(event.payload);
        if (event.payload.phase === 'complete') {
          setDownloading(false);
          // Refresh status
          invoke<FfmpegStatusInfo>('ffmpeg_check').then(setStatus).catch(() => {});
        }
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  const handleInstall = async () => {
    setDownloading(true);
    setProgress({ phase: 'downloading', progress: 0, message: '准备下载...' });
    try {
      await invoke('ffmpeg_download');
      showToast('success', 'FFmpeg 安装完成');
    } catch (e: any) {
      showToast('error', e?.toString() || '安装失败');
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl w-[420px] p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Video size={16} className="text-[#3b82f6]" />
            FFmpeg 视频处理
          </h3>
          <button onClick={onClose} className="text-[#555] hover:text-[#aaa]"><X size={16} /></button>
        </div>

        {/* Status */}
        <div className={`flex items-center gap-3 p-3 rounded-lg mb-4 ${
          status?.installed ? 'bg-[#22c55e]/10' : 'bg-[#f59e0b]/10'
        }`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            status?.installed ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#f59e0b]/20 text-[#f59e0b]'
          }`}>
            {status?.installed ? <Check size={16} /> : <AlertTriangle size={16} />}
          </div>
          <div className="flex-1">
            <div className="text-xs font-medium text-[#ccc]">
              {status?.installed ? '已安装' : '未安装'}
            </div>
            {status?.version && (
              <div className="text-[10px] text-[#666] truncate">{status.version}</div>
            )}
            {status?.path && (
              <div className="text-[10px] text-[#555] truncate">{status.path}</div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-[#777] mb-4">
          FFmpeg 用于生成视频文件的缩略图预览。安装后将自动支持 MP4、MOV、AVI、MKV 等视频格式的缩略图。
          安装过程在后台进行，不影响其他操作。
        </p>

        {/* Download progress */}
        {downloading && progress && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 size={12} className="animate-spin text-[#3b82f6]" />
              <span className="text-[11px] text-[#aaa]">{progress.message}</span>
            </div>
            <div className="h-2 bg-[#111] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#3b82f6] rounded-full transition-all"
                style={{ width: `${progress.progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        {!status?.installed && !downloading && (
          <button
            onClick={handleInstall}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#2563eb] text-white text-xs rounded-lg hover:bg-[#1d4ed8] transition-colors"
          >
            <Download size={14} />
            自动下载安装 FFmpeg
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Virtual Scroll Grid
// ============================================================

// Masonry / Waterfall layout constants
const MASONRY_MIN_COL_W = 180;
const MASONRY_GAP = 8;
const MASONRY_LABEL_H = 36; // space for filename + size below thumbnail
const MASONRY_BUFFER_PX = 600; // render buffer above/below viewport

interface VirtualGridProps {
  assets: AssetEntry[];
  containerRef: React.RefObject<HTMLDivElement>;
  onClickAsset: (asset: AssetEntry, index: number) => void;
  onDoubleClickAsset: (asset: AssetEntry, index: number) => void;
  onContextMenu: (asset: AssetEntry, index: number, e: React.MouseEvent) => void;
  selectedIds: Set<number>;
  onBoxSelect: (ids: Set<number>) => void;
  assetTagsMap: Map<number, TagInfo[]>;
  assetRatingsMap: Map<number, number>;
  lockedPaths: Set<string>;
  thumbSize: 'small' | 'large';
}

const VirtualGrid: React.FC<VirtualGridProps> = ({ assets, containerRef, onClickAsset, onDoubleClickAsset, onContextMenu, selectedIds, onBoxSelect, assetTagsMap, assetRatingsMap, lockedPaths, thumbSize }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(600);

  // Box select state
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);
  const boxSelectRef = useRef(false);

  const colMinW = thumbSize === 'large' ? 240 : MASONRY_MIN_COL_W;
  const gap = MASONRY_GAP;
  const labelH = MASONRY_LABEL_H;

  // Calculate columns
  const cols = Math.max(1, Math.floor((containerWidth + gap) / (colMinW + gap)));
  const colW = (containerWidth - gap * (cols - 1)) / cols;

  // ---- Masonry layout computation ----
  const layout = useMemo(() => {
    const colHeights = new Array(cols).fill(0);
    const items: { x: number; y: number; w: number; h: number; thumbH: number; idx: number }[] = [];
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      // Calculate thumbnail height based on aspect ratio
      let thumbH: number;
      if (a.width > 0 && a.height > 0) {
        const ratio = a.height / a.width;
        // Clamp ratio to avoid extremely tall/short items
        const clampedRatio = Math.max(0.4, Math.min(2.5, ratio));
        thumbH = Math.round(colW * clampedRatio);
      } else {
        thumbH = Math.round(colW * 0.75); // default 4:3
      }
      const totalH = thumbH + labelH;
      // Find shortest column
      let minCol = 0;
      for (let c = 1; c < cols; c++) {
        if (colHeights[c] < colHeights[minCol]) minCol = c;
      }
      const x = minCol * (colW + gap);
      const y = colHeights[minCol];
      items.push({ x, y, w: colW, h: totalH, thumbH, idx: i });
      colHeights[minCol] += totalH + gap;
    }
    const totalHeight = Math.max(...colHeights, 0);
    return { items, totalHeight };
  }, [assets, cols, colW, gap, labelH]);

  const { items: layoutItems, totalHeight } = layout;

  // Visible range (binary search-ish: just filter by y range)
  const viewTop = scrollTop - MASONRY_BUFFER_PX;
  const viewBottom = scrollTop + containerHeight + MASONRY_BUFFER_PX;

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Scroll handler
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef]);

  const visibleItems = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    for (const li of layoutItems) {
      // Skip items outside viewport
      if (li.y + li.h < viewTop || li.y > viewBottom) continue;
      const asset = assets[li.idx];
      const hasThumbnail = !!asset.thumb_path;
      const thumbUrl = hasThumbnail ? convertFileSrc(asset.thumb_path) : '';
      const Icon = getFileIcon(asset.file_ext);
      const isSelected = selectedIds.has(asset.id);
      const assetTags = assetTagsMap.get(asset.id) || [];
      const assetRating = assetRatingsMap.get(asset.id) || 0;
      const isLocked = lockedPaths.has(asset.file_path);

      nodes.push(
        <div
          key={asset.id}
          data-asset-item
          className={'absolute group cursor-pointer' + (isSelected ? ' ring-2 ring-[#3b82f6] rounded-lg' : '')}
          style={{
            transform: `translate(${li.x}px, ${li.y}px)`,
            width: li.w,
            height: li.h,
          }}
          onClick={() => onClickAsset(asset, li.idx)}
          onDoubleClick={() => onDoubleClickAsset(asset, li.idx)}
          onContextMenu={e => onContextMenu(asset, li.idx, e)}
        >
          {/* Thumbnail - variable height */}
          <div
            className={'w-full rounded-lg overflow-hidden bg-[#1a1a1a] border transition-colors relative ' +
              (isSelected ? 'border-[#3b82f6]' : 'border-[#2a2a2a] group-hover:border-[#3b82f6]')}
            style={{ height: li.thumbH }}
          >
            {hasThumbnail ? (
              <img
                src={thumbUrl}
                alt={asset.file_name}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                style={{ contentVisibility: 'auto' }}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-[#555]">
                <Icon size={32} />
                <span className="text-xs mt-1 uppercase">{asset.file_ext}</span>
              </div>
            )}
            {/* Ext badge */}
            <span
              className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase"
              style={{ background: getExtColor(asset.file_ext) + '22', color: getExtColor(asset.file_ext) }}
            >
              {asset.file_ext}
            </span>
            {/* Rating stars */}
            {assetRating > 0 && (
              <div className="absolute top-1.5 left-1.5 flex">
                {Array.from({ length: assetRating }, (_, i) => (
                  <Star key={i} size={10} className="text-yellow-400 fill-yellow-400" />
                ))}
              </div>
            )}
            {/* Lock indicator */}
            {isLocked && (
              <div className="absolute top-1.5 left-1.5 bg-[#ef4444]/80 rounded-full p-0.5" style={{ marginTop: assetRating > 0 ? 16 : 0 }}>
                <Lock size={10} className="text-white" />
              </div>
            )}
            {/* Dimensions badge */}
            {asset.width > 0 && (
              <span className="absolute bottom-1.5 left-1.5 text-[10px] px-1 py-0.5 rounded bg-black/50 text-[#aaa]">
                {asset.width}x{asset.height}
              </span>
            )}
            {/* Tags (bottom-right, first 2) */}
            {assetTags.length > 0 && (
              <div className="absolute bottom-1.5 right-1.5 flex gap-0.5">
                {assetTags.slice(0, 2).map(tag => (
                  <span
                    key={tag.id}
                    className="text-[8px] px-1 py-0.5 rounded-full font-medium"
                    style={{ background: tag.color + '55', color: '#fff' }}
                  >
                    {tag.name}
                  </span>
                ))}
                {assetTags.length > 2 && (
                  <span className="text-[8px] px-1 py-0.5 rounded-full bg-black/50 text-white">
                    +{assetTags.length - 2}
                  </span>
                )}
              </div>
            )}
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <ZoomIn size={24} className="text-white drop-shadow" />
            </div>
          </div>
          {/* File info */}
          <div className="mt-1 px-0.5">
            <div className="text-xs text-[#ccc] truncate" title={asset.file_name}>
              {asset.file_name}
            </div>
            <div className="text-[10px] text-[#666]">
              {formatFileSize(asset.file_size)}
            </div>
          </div>
        </div>
      );
    }
    return nodes;
  }, [layoutItems, viewTop, viewBottom, assets, selectedIds, assetTagsMap, assetRatingsMap, lockedPaths, onClickAsset, onDoubleClickAsset, onContextMenu]);

  // Box select handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left button, not on an asset element
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-asset-item]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const el = containerRef.current;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + (el ? el.scrollTop : 0);
    setBoxStart({ x, y });
    setBoxEnd({ x, y });
    boxSelectRef.current = false;
  }, [containerRef]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!boxStart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const el = containerRef.current;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + (el ? el.scrollTop : 0);
    setBoxEnd({ x, y });
    boxSelectRef.current = true;
  }, [boxStart, containerRef]);

  const handleMouseUp = useCallback(() => {
    if (!boxStart || !boxEnd || !boxSelectRef.current) {
      setBoxStart(null); setBoxEnd(null); return;
    }
    const minX = Math.min(boxStart.x, boxEnd.x);
    const maxX = Math.max(boxStart.x, boxEnd.x);
    const minY = Math.min(boxStart.y, boxEnd.y);
    const maxY = Math.max(boxStart.y, boxEnd.y);
    const ids = new Set<number>();
    for (const li of layoutItems) {
      if (li.x < maxX && (li.x + li.w) > minX && li.y < maxY && (li.y + li.h) > minY) {
        ids.add(assets[li.idx].id);
      }
    }
    onBoxSelect(ids);
    setBoxStart(null);
    setBoxEnd(null);
  }, [boxStart, boxEnd, layoutItems, assets, onBoxSelect]);

  // Box rect for rendering
  const boxRect = boxStart && boxEnd && boxSelectRef.current ? {
    left: Math.min(boxStart.x, boxEnd.x),
    top: Math.min(boxStart.y, boxEnd.y),
    width: Math.abs(boxEnd.x - boxStart.x),
    height: Math.abs(boxEnd.y - boxStart.y),
  } : null;

  return (
    <div
      className="relative"
      style={{ height: totalHeight, minHeight: '100%' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {visibleItems}
      {boxRect && boxRect.width > 5 && boxRect.height > 5 && (
        <div
          className="absolute pointer-events-none border border-[#3b82f6] bg-[#3b82f6]/10 rounded z-30"
          style={boxRect}
        />
      )}
    </div>
  );
};

// ============================================================
// Multi-Video Simultaneous Playback Panel
// ============================================================
const MultiVideoPanel: React.FC<{ assets: AssetEntry[]; onClose: () => void }> = ({ assets, onClose }) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [syncPlay, setSyncPlay] = useState(true);

  // Calculate optimal grid layout
  const count = assets.length;
  const calcGrid = () => {
    if (count <= 1) return { cols: 1, rows: 1 };
    if (count === 2) return { cols: 2, rows: 1 };
    if (count <= 4) return { cols: 2, rows: Math.ceil(count / 2) };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 9) return { cols: 3, rows: 3 };
    const c = Math.ceil(Math.sqrt(count));
    return { cols: c, rows: Math.ceil(count / c) };
  };
  const { cols } = calcGrid();

  const playAll = () => videoRefs.current.forEach(v => v?.play());
  const pauseAll = () => videoRefs.current.forEach(v => v?.pause());
  const seekAll = (t: number) => videoRefs.current.forEach(v => { if (v) v.currentTime = t; });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a]/95 flex flex-col">
      <div className="flex-none flex items-center gap-4 px-5 py-3 border-b border-[#222] bg-[#111]">
        <h2 className="text-sm font-medium text-[#eee]">{count} 个视频同时播放</h2>
        <div className="flex items-center gap-2 ml-4">
          <button onClick={playAll} className="text-xs px-2 py-1 rounded bg-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/30">全部播放</button>
          <button onClick={pauseAll} className="text-xs px-2 py-1 rounded bg-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/30">全部暂停</button>
          <button onClick={() => seekAll(0)} className="text-xs px-2 py-1 rounded bg-[#3b82f6]/20 text-[#3b82f6] hover:bg-[#3b82f6]/30">回到开头</button>
        </div>
        <button onClick={onClose} className="ml-auto text-[#666] hover:text-white transition-colors p-1"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="grid gap-2 h-full" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {assets.map((a, i) => (
            <div key={a.id} className="relative flex flex-col rounded-lg overflow-hidden bg-[#111] border border-[#222]">
              <video
                ref={el => { videoRefs.current[i] = el; }}
                src={convertFileSrc(a.file_path)}
                controls
                autoPlay={syncPlay}
                muted
                className="flex-1 w-full object-contain bg-black"
              />
              <div className="flex-none px-2 py-1 bg-[#0d0d0d] text-[11px] text-[#aaa] truncate">{a.file_name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Video Player with Frame-by-Frame
// ============================================================
const VideoPlayer: React.FC<{ src: string }> = ({ src }) => {
  const vidRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const fps = 30; // assume 30fps for frame stepping

  const stepFrame = (dir: number) => {
    const v = vidRef.current; if (!v) return;
    v.pause(); setPlaying(false);
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + dir / fps));
  };

  const togglePlay = () => {
    const v = vidRef.current; if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const fmtTime = (t: number) => {
    const m = Math.floor(t / 60); const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
      <video
        ref={vidRef}
        src={src}
        autoPlay
        className="max-w-[90vw] max-h-[75vh] rounded-lg shadow-2xl"
        style={{ outline: 'none' }}
        onTimeUpdate={() => { if (vidRef.current) setCurrentTime(vidRef.current.currentTime); }}
        onLoadedMetadata={() => { if (vidRef.current) setDuration(vidRef.current.duration); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {/* Custom controls */}
      <div className="flex items-center gap-3 bg-black/70 backdrop-blur-sm rounded-full px-4 py-2">
        <button onClick={() => stepFrame(-1)} className="text-white/60 hover:text-white text-xs px-1" title="上一帧 (,)">
          <ChevronLeft size={16} />
        </button>
        <button onClick={togglePlay} className="text-white hover:text-[#3b82f6] px-1" title="播放/暂停">
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => stepFrame(1)} className="text-white/60 hover:text-white text-xs px-1" title="下一帧 (.)">
          <ChevronRight size={16} />
        </button>
        <span className="text-[11px] text-[#aaa] min-w-[80px] text-center">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
        {/* Seek bar */}
        <input
          type="range" min={0} max={duration || 1} step={0.001} value={currentTime}
          onChange={e => { if (vidRef.current) vidRef.current.currentTime = +e.target.value; }}
          className="w-40 accent-[#3b82f6]"
        />
        {/* Speed */}
        <select
          value={playbackRate}
          onChange={e => { const r = +e.target.value; setPlaybackRate(r); if (vidRef.current) vidRef.current.playbackRate = r; }}
          className="bg-transparent text-[11px] text-[#aaa] outline-none cursor-pointer"
        >
          {[0.25, 0.5, 1, 1.5, 2].map(r => <option key={r} value={r}>{r}x</option>)}
        </select>
      </div>
    </div>
  );
};

// ============================================================
// Image Preview Modal
// ============================================================

interface PreviewProps {
  asset: AssetEntry | null;
  assets: AssetEntry[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const PreviewModal: React.FC<PreviewProps> = ({ asset, assets, currentIndex, onClose, onNavigate }) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [asset?.id]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < assets.length - 1) onNavigate(currentIndex + 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentIndex, assets.length, onClose, onNavigate]);

  if (!asset) return null;

  const imgUrl = convertFileSrc(asset.file_path);
  const thumbUrl = asset.thumb_path ? convertFileSrc(asset.thumb_path) : '';
  const isImage = IMAGE_EXTS.has(asset.file_ext) && !['dds', 'hdr', 'exr'].includes(asset.file_ext);
  const isPsd = asset.file_ext === 'psd';
  const isVideo = VIDEO_EXTS.has(asset.file_ext);
  const isAudio = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a', 'opus']).has(asset.file_ext);
  const is3D = MESH_EXTS.has(asset.file_ext);

  // PSD: 使用缩略图（由后端生成的合成图）或原图
  const previewSrc = isPsd && thumbUrl ? thumbUrl : imgUrl;
  const canPreviewImage = isImage || (isPsd && !!thumbUrl);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 text-white/60 hover:text-white z-10"
        onClick={onClose}
      >
        <X size={28} />
      </button>

      {/* Navigation */}
      {currentIndex > 0 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white z-10 p-2"
          onClick={e => { e.stopPropagation(); onNavigate(currentIndex - 1); }}
        >
          <ArrowLeft size={32} />
        </button>
      )}
      {currentIndex < assets.length - 1 && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white z-10 p-2"
          onClick={e => { e.stopPropagation(); onNavigate(currentIndex + 1); }}
        >
          <ArrowRight size={32} />
        </button>
      )}

      {/* Content */}
      <div className="max-w-[90vw] max-h-[85vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
        {canPreviewImage ? (
          <>
            {!loaded && (
              <div className="flex items-center justify-center w-64 h-64">
                <Loader2 className="animate-spin text-[#555]" size={40} />
              </div>
            )}
            <img
              src={previewSrc}
              alt={asset.file_name}
              className={`max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl ${loaded ? '' : 'hidden'}`}
              onLoad={() => setLoaded(true)}
              draggable={false}
            />
          </>
        ) : isVideo ? (
          <VideoPlayer key={asset.id} src={imgUrl} />
        ) : isAudio ? (
          <div className="flex flex-col items-center justify-center gap-6 p-12 bg-[#111] rounded-2xl">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center">
              <Film size={48} className="text-white" />
            </div>
            <span className="text-lg text-[#ccc] font-medium">{asset.file_name}</span>
            <audio
              key={asset.id}
              src={imgUrl}
              controls
              autoPlay
              className="w-96"
              style={{ outline: 'none' }}
            />
          </div>
        ) : is3D ? (
          <div className="w-[80vw] h-[75vh]" onClick={e => e.stopPropagation()}>
            <React.Suspense fallback={<div className="w-full h-full flex items-center justify-center"><Loader2 className="animate-spin text-white" size={40} /></div>}>
              <LazyModelViewer3D filePath={asset.file_path} fileExt={asset.file_ext} fileName={asset.file_name} />
            </React.Suspense>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-[#666] gap-3 p-12">
            {React.createElement(getFileIcon(asset.file_ext), { size: 64 })}
            <span className="text-lg">{asset.file_ext.toUpperCase()} 格式暂不支持预览</span>
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-6 py-3 flex items-center gap-6 text-sm text-[#aaa]">
        <span className="text-white font-medium truncate max-w-[40%]">{asset.file_name}</span>
        {asset.width > 0 && <span>{asset.width} × {asset.height}</span>}
        <span>{formatFileSize(asset.file_size)}</span>
        <span>{formatDate(asset.modified_at)}</span>
        <span className="ml-auto text-[#666]">{currentIndex + 1} / {assets.length}</span>
      </div>
    </div>
  );
};

// ============================================================
// Main Component
// ============================================================

const PAGE_SIZE = 500;

// Format filter groups
const FORMAT_GROUPS: { label: string; exts: string[] }[] = [
  { label: '全部', exts: [] },
  { label: '图片', exts: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'svg', 'ico'] },
  { label: 'PSD', exts: ['psd'] },
  { label: '视频', exts: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'] },
  { label: '音频', exts: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a', 'opus'] },
  { label: '3D', exts: ['fbx', 'obj', 'gltf', 'glb', 'blend', '3ds', 'dae', 'stl'] },
  { label: 'Spine', exts: ['spine', 'skel', 'atlas'] },
  { label: '其他', exts: ['tga', 'dds', 'hdr', 'exr'] },
];

const SORT_OPTIONS = [
  { value: 'modified', label: '修改时间' },
  { value: 'name', label: '文件名' },
  { value: 'size', label: '文件大小' },
  { value: 'ext', label: '格式' },
];

export default function AssetManager() {
  const { showToast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null!);

  // ---- State ----
  const [space, setSpace] = useState<SpaceType>('personal');
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [loading, setLoading] = useState(false);

  // Scan
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  // Search & filter
  const [searchText, setSearchText] = useState('');
  const [formatFilter, setFormatFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('modified');
  const [sortDesc, setSortDesc] = useState(true);

  // Preview
  const [previewIndex, setPreviewIndex] = useState(-1);
  const previewAsset = previewIndex >= 0 ? assets[previewIndex] : null;

  // Grid size
  const [thumbSize, setThumbSize] = useState<'small' | 'large'>('small');

  // Stats
  const [stats, setStats] = useState<FolderStats | null>(null);

  // Sidebar collapsed
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ---- Phase 2 State ----
  // Tags
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [showTagManager, setShowTagManager] = useState(false);
  const [filterByTag, setFilterByTag] = useState<number | null>(null);

  // Per-asset tags/ratings cache (loaded on demand)
  const [assetTagsMap, setAssetTagsMap] = useState<Map<number, TagInfo[]>>(new Map());
  const [assetRatingsMap, setAssetRatingsMap] = useState<Map<number, number>>(new Map());

  // Detail sidebar
  const [detailAssetId, setDetailAssetId] = useState<number | null>(null);
  const [detailData, setDetailData] = useState<AssetDetail | null>(null);

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextAssetTags, setContextAssetTags] = useState<number[]>([]);
  const [contextAssetRating, setContextAssetRating] = useState(0);

  // Smart folders
  const [smartFolders, setSmartFolders] = useState<SmartFolder[]>([]);
  const [showSmartFolderEditor, setShowSmartFolderEditor] = useState(false);
  const [editingSmartFolder, setEditingSmartFolder] = useState<SmartFolder | null>(null);
  const [activeSmartFolderId, setActiveSmartFolderId] = useState<number | null>(null);

  // ---- Phase 3: Team State ----
  const [teamSharedRoot, setTeamSharedRoot] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<string>('');
  const [currentMachine, setCurrentMachine] = useState<string>('');
  const [activeLocks, setActiveLocks] = useState<FileLockInfo[]>([]);
  const [detailLockStatus, setDetailLockStatus] = useState<LockStatusInfo | null>(null);
  const [detailHistory, setDetailHistory] = useState<FileHistoryInfo | null>(null);
  const [heartbeatTimers, setHeartbeatTimers] = useState<Map<string, NodeJS.Timeout>>(new Map());

  // ---- Phase 4: FFmpeg State ----
  const [showFfmpegSettings, setShowFfmpegSettings] = useState(false);

  // ---- Compare Panel State ----
  const [showComparePanel, setShowComparePanel] = useState(false);
  const [showMultiVideo, setShowMultiVideo] = useState(false);

  // ---- Favorites State ----
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [filterMinRating, setFilterMinRating] = useState(0);

  // Load OS username from backend (Phase 3 fix)
  useEffect(() => {
    (async () => {
      try {
        const user = await invoke<string>('asset_get_os_username');
        setCurrentUser(user);
        setCurrentMachine(typeof window !== 'undefined' ? window.location.hostname : '');
      } catch {
        const user = localStorage.getItem('arthub_username') || '';
        const machine = localStorage.getItem('arthub_machine') || '';
        setCurrentUser(user);
        setCurrentMachine(machine);
      }
    })();
  }, []);

  // ---- Load folders ----
  const loadFolders = useCallback(async () => {
    try {
      const result = await invoke<AssetFolder[]>('asset_get_folders', { spaceType: null });
      setFolders(result);
    } catch (e) {
      console.error('加载文件夹失败:', e);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  // Track current page for pagination
  const [currentPage, setCurrentPage] = useState(1);

  // ---- Load assets ----
  const loadAssets = useCallback(async (append = false) => {
    setLoading(true);
    try {
      const page = append ? currentPage + 1 : 1;
      const result = await invoke<QueryResult>('asset_query', {
        params: {
          folder_id: selectedFolderId,
          search: searchText || null,
          extensions: formatFilter.length > 0 ? formatFilter : null,
          min_width: null,
          max_width: null,
          tag_ids: filterByTag ? [filterByTag] : null,
          min_rating: filterMinRating > 0 ? filterMinRating : null,
          favorite_only: filterFavorites || null,
          sort_by: sortBy,
          sort_order: sortDesc ? 'desc' : 'asc',
          page,
          page_size: PAGE_SIZE,
        },
      });
      if (append) {
        setAssets(prev => [...prev, ...result.assets]);
      } else {
        setAssets(result.assets);
      }
      setTotalAssets(result.total);
      setCurrentPage(page);
    } catch (e) {
      console.error('加载资源失败:', e);
    }
    setLoading(false);
  }, [selectedFolderId, searchText, formatFilter, sortBy, sortDesc, currentPage, filterByTag, filterMinRating, filterFavorites]);

  // Load when filters change
  useEffect(() => {
    setCurrentPage(1);
    loadAssets(false);
  }, [selectedFolderId, space, searchText, formatFilter, sortBy, sortDesc, filterByTag, filterMinRating, filterFavorites]);

  // Load stats
  useEffect(() => {
    (async () => {
      try {
        const s = await invoke<FolderStats>('asset_get_stats');
        setStats(s);
      } catch (_) { /* ignore */ }
    })();
  }, [assets.length]);

  // Infinite scroll: load more when scrolled near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (loading || assets.length >= totalAssets) return;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) {
        loadAssets(true);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [loading, assets.length, totalAssets, loadAssets]);

  // ---- Scan progress listener ----
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<ScanProgress>('asset-scan-progress', (event) => {
        const p = event.payload;
        setScanProgress(p);
        if (p.phase === 'complete') {
          setScanning(false);
          setScanProgress(null);
          loadFolders();
          loadAssets(false);
        }
      });
    })();
    return () => { unlisten?.(); };
  }, [loadFolders]);

  // ---- Phase 2: Load tags ----
  const loadTags = useCallback(async () => {
    try {
      const tags = await invoke<TagInfo[]>('asset_get_tags');
      setAllTags(tags);
    } catch (e) {
      console.error('加载标签失败:', e);
    }
  }, []);

  useEffect(() => { loadTags(); }, [loadTags]);

  // ---- Load favorites ----
  const loadFavorites = useCallback(async () => {
    try {
      const ids = await invoke<number[]>('asset_get_favorite_ids');
      setFavoriteIds(new Set(ids));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  // ---- Phase 2: Load smart folders ----
  const loadSmartFolders = useCallback(async () => {
    try {
      const sf = await invoke<SmartFolder[]>('asset_get_smart_folders', { spaceType: space });
      setSmartFolders(sf);
    } catch (e) {
      console.error('加载智能文件夹失败:', e);
    }
  }, [space]);

  useEffect(() => { loadSmartFolders(); }, [loadSmartFolders]);

  // ---- Phase 2: Load asset detail ----
  const loadAssetDetail = useCallback(async (assetId: number) => {
    try {
      const detail = await invoke<AssetDetail>('asset_get_detail', { assetId });
      setDetailData(detail);
      // Update caches
      setAssetTagsMap(prev => new Map(prev).set(assetId, detail.tags));
      setAssetRatingsMap(prev => new Map(prev).set(assetId, detail.rating));
    } catch (e) {
      console.error('加载资产详情失败:', e);
    }
  }, []);

  useEffect(() => {
    if (detailAssetId) loadAssetDetail(detailAssetId);
    else setDetailData(null);
  }, [detailAssetId, loadAssetDetail]);

  // Batch load tags for visible assets (debounced)
  useEffect(() => {
    if (assets.length === 0) return;
    const loadBatch = async () => {
      const toLoad = assets.filter(a => !assetTagsMap.has(a.id)).slice(0, 50);
      if (toLoad.length === 0) return;
      for (const asset of toLoad) {
        try {
          const detail = await invoke<AssetDetail>('asset_get_detail', { assetId: asset.id });
          setAssetTagsMap(prev => {
            const next = new Map(prev);
            next.set(asset.id, detail.tags);
            return next;
          });
          if (detail.rating > 0) {
            setAssetRatingsMap(prev => {
              const next = new Map(prev);
              next.set(asset.id, detail.rating);
              return next;
            });
          }
        } catch { /* ignore */ }
      }
    };
    const timer = setTimeout(loadBatch, 300);
    return () => clearTimeout(timer);
  }, [assets]);

  // ---- Phase 2: Tag Handlers ----
  const handleCreateTag = async (name: string, color: string) => {
    try {
      await invoke<TagInfo>('asset_create_tag', { name, color });
      await loadTags();
      showToast('success', `标签 "${name}" 已创建`);
    } catch (e: any) {
      showToast('error', e?.toString() || '创建标签失败');
    }
  };

  const handleDeleteTag = async (tagId: number) => {
    try {
      await invoke('asset_delete_tag', { tagId });
      await loadTags();
      showToast('success', '标签已删除');
    } catch (e: any) {
      showToast('error', e?.toString() || '删除标签失败');
    }
  };

  const handleUpdateTag = async (tagId: number, name: string, color: string) => {
    try {
      await invoke('asset_update_tag', { tagId, name, color });
      await loadTags();
    } catch (e: any) {
      showToast('error', e?.toString() || '更新标签失败');
    }
  };

  const handleAddTagToAsset = async (assetId: number, tagId: number) => {
    try {
      await invoke('asset_add_tag', { assetId, tagId });
      // Refresh detail if open
      if (detailAssetId === assetId) loadAssetDetail(assetId);
      // Update cache
      const tag = allTags.find(t => t.id === tagId);
      if (tag) {
        setAssetTagsMap(prev => {
          const next = new Map(prev);
          const existing = next.get(assetId) || [];
          if (!existing.some(t => t.id === tagId)) {
            next.set(assetId, [...existing, tag]);
          }
          return next;
        });
      }
      await loadTags();
    } catch (e: any) {
      showToast('error', e?.toString() || '添加标签失败');
    }
  };

  const handleRemoveTagFromAsset = async (assetId: number, tagId: number) => {
    try {
      await invoke('asset_remove_tag', { assetId, tagId });
      if (detailAssetId === assetId) loadAssetDetail(assetId);
      setAssetTagsMap(prev => {
        const next = new Map(prev);
        const existing = next.get(assetId) || [];
        next.set(assetId, existing.filter(t => t.id !== tagId));
        return next;
      });
      await loadTags();
    } catch (e: any) {
      showToast('error', e?.toString() || '移除标签失败');
    }
  };

  // ---- Phase 2: Rating Handler ----
  const handleSetRating = async (assetId: number, rating: number) => {
    try {
      await invoke('asset_set_rating', { assetId, rating });
      setAssetRatingsMap(prev => new Map(prev).set(assetId, rating));
      if (detailAssetId === assetId) loadAssetDetail(assetId);
    } catch (e: any) {
      showToast('error', e?.toString() || '设置评分失败');
    }
  };

  // ---- Phase 2: Note Handler ----
  const handleSetNote = async (assetId: number, note: string) => {
    try {
      await invoke('asset_set_note', { assetId, note });
      if (detailAssetId === assetId) loadAssetDetail(assetId);
    } catch (e: any) {
      showToast('error', e?.toString() || '设置备注失败');
    }
  };

  // ---- Favorite Handler ----
  const handleToggleFavorite = async (assetId: number) => {
    try {
      const isFav = await invoke<boolean>('asset_toggle_favorite', { assetId });
      setFavoriteIds(prev => {
        const next = new Set(prev);
        if (isFav) next.add(assetId); else next.delete(assetId);
        return next;
      });
    } catch (e: any) {
      showToast('error', e?.toString() || '收藏操作失败');
    }
  };

  // ---- Batch Operations ----
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      const count = await invoke<number>('asset_batch_delete', { assetIds: Array.from(selectedIds) });
      showToast('success', `已删除 ${count} 个资源`);
      setSelectedIds(new Set());
      loadAssets(false);
      loadFolders();
    } catch (e: any) {
      showToast('error', e?.toString() || '批量删除失败');
    }
  };

  const handleBatchExport = async () => {
    if (selectedIds.size === 0) return;
    try {
      const dir = await open({ directory: true, title: '选择导出目录' });
      if (!dir || typeof dir !== 'string') return;
      const count = await invoke<number>('asset_batch_export', {
        assetIds: Array.from(selectedIds),
        targetDir: dir,
      });
      showToast('success', `已导出 ${count} 个文件到 ${dir}`);
    } catch (e: any) {
      showToast('error', e?.toString() || '批量导出失败');
    }
  };

  const handleBatchFavorite = async (favorite: boolean) => {
    if (selectedIds.size === 0) return;
    try {
      await invoke('asset_batch_favorite', { assetIds: Array.from(selectedIds), favorite });
      await loadFavorites();
      showToast('success', favorite ? '已批量收藏' : '已批量取消收藏');
    } catch (e: any) {
      showToast('error', e?.toString() || '批量收藏操作失败');
    }
  };

  const handleBatchSetRating = async (rating: number) => {
    if (selectedIds.size === 0) return;
    try {
      await invoke('asset_batch_set_rating', { assetIds: Array.from(selectedIds), rating });
      for (const id of selectedIds) {
        setAssetRatingsMap(prev => new Map(prev).set(id, rating));
      }
      showToast('success', `已批量设置 ${rating} 星评分`);
    } catch (e: any) {
      showToast('error', e?.toString() || '批量设置评分失败');
    }
  };

  // ---- Phase 2: Context Menu ----
  const handleContextMenu = useCallback(async (asset: AssetEntry, index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, assetId: asset.id, assetIndex: index });
    const tags = assetTagsMap.get(asset.id) || [];
    setContextAssetTags(tags.map(t => t.id));
    setContextAssetRating(assetRatingsMap.get(asset.id) || 0);
  }, [assetTagsMap, assetRatingsMap]);

  const handleCopyPath = useCallback(() => {
    if (!contextMenu) return;
    const asset = assets.find(a => a.id === contextMenu.assetId);
    if (asset) {
      navigator.clipboard.writeText(asset.file_path);
      showToast('success', '路径已复制');
    }
  }, [contextMenu, assets, showToast]);

  // ---- Phase 2: Smart Folder Handlers ----
  const handleCreateSmartFolder = async (name: string, conditions: SmartFolderConditions) => {
    try {
      await invoke<SmartFolder>('asset_create_smart_folder', {
        name,
        conditions: JSON.stringify(conditions),
        spaceType: space,
      });
      await loadSmartFolders();
      setShowSmartFolderEditor(false);
      showToast('success', `智能文件夹 "${name}" 已创建`);
    } catch (e: any) {
      showToast('error', e?.toString() || '创建智能文件夹失败');
    }
  };

  const handleDeleteSmartFolder = async (id: number) => {
    try {
      await invoke('asset_delete_smart_folder', { id });
      if (activeSmartFolderId === id) setActiveSmartFolderId(null);
      await loadSmartFolders();
      showToast('success', '智能文件夹已删除');
    } catch (e: any) {
      showToast('error', e?.toString() || '删除失败');
    }
  };

  // ---- Phase 3: Team Handlers ----
  // Load lock status for detail asset in team space
  useEffect(() => {
    if (space !== 'team' || !detailAssetId || !teamSharedRoot) {
      setDetailLockStatus(null);
      setDetailHistory(null);
      return;
    }
    const asset = assets.find(a => a.id === detailAssetId);
    if (!asset) return;

    (async () => {
      try {
        const status = await invoke<LockStatusInfo>('team_check_lock', {
          sharedRoot: teamSharedRoot, filePath: asset.file_path,
        });
        setDetailLockStatus(status);
      } catch { setDetailLockStatus(null); }

      try {
        const hist = await invoke<FileHistoryInfo | null>('team_get_history', {
          sharedRoot: teamSharedRoot, filePath: asset.file_path,
        });
        setDetailHistory(hist || null);
      } catch { setDetailHistory(null); }
    })();
  }, [space, detailAssetId, teamSharedRoot, assets]);

  // Load active locks periodically for team space
  useEffect(() => {
    if (space !== 'team' || !teamSharedRoot) return;
    const loadLocks = async () => {
      try {
        const locks = await invoke<FileLockInfo[]>('team_get_all_locks', { sharedRoot: teamSharedRoot });
        setActiveLocks(locks);
      } catch { /* ignore */ }
    };
    loadLocks();
    const interval = setInterval(loadLocks, 30000); // every 30s
    return () => clearInterval(interval);
  }, [space, teamSharedRoot]);

  const handleLockFile = async (filePath: string) => {
    if (!teamSharedRoot || !currentUser) return;
    try {
      const ok = await invoke<boolean>('team_acquire_lock', {
        sharedRoot: teamSharedRoot, filePath, username: currentUser, machine: currentMachine,
      });
      if (ok) {
        showToast('success', '已锁定文件');
        // Start heartbeat
        const timer = setInterval(async () => {
          await invoke('team_refresh_heartbeat', {
            sharedRoot: teamSharedRoot, filePath, username: currentUser,
          }).catch(() => {});
        }, 60000);
        setHeartbeatTimers(prev => new Map(prev).set(filePath, timer));
        // Refresh lock status
        const status = await invoke<LockStatusInfo>('team_check_lock', {
          sharedRoot: teamSharedRoot, filePath,
        });
        setDetailLockStatus(status);
      } else {
        showToast('error', '文件已被他人锁定');
      }
    } catch (e: any) {
      showToast('error', e?.toString() || '锁定失败');
    }
  };

  const handleUnlockFile = async (filePath: string) => {
    if (!teamSharedRoot || !currentUser) return;
    try {
      await invoke('team_release_lock', {
        sharedRoot: teamSharedRoot, filePath, username: currentUser,
      });
      // Stop heartbeat
      const timer = heartbeatTimers.get(filePath);
      if (timer) { clearInterval(timer); setHeartbeatTimers(prev => { const m = new Map(prev); m.delete(filePath); return m; }); }
      showToast('success', '已释放锁定');
      setDetailLockStatus({ is_locked: false, locked_by: null, machine: null, locked_at: null, is_stale: false });
    } catch (e: any) {
      showToast('error', e?.toString() || '释放失败');
    }
  };

  const handleRestoreVersion = async (filePath: string, version: number) => {
    if (!teamSharedRoot) return;
    try {
      await invoke('team_restore_version', {
        sharedRoot: teamSharedRoot, filePath, version, targetPath: filePath,
      });
      showToast('success', `已恢复到版本 v${version}`);
    } catch (e: any) {
      showToast('error', e?.toString() || '恢复失败');
    }
  };

  // Cleanup heartbeat timers on unmount
  useEffect(() => {
    return () => {
      heartbeatTimers.forEach(timer => clearInterval(timer));
    };
  }, []);

  // ---- Phase 5: Keyboard Shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: close modals/clear selection
      if (e.key === 'Escape') {
        if (previewIndex >= 0) { setPreviewIndex(-1); return; }
        if (detailAssetId) { setDetailAssetId(null); return; }
        if (selectedIds.size > 0) { setSelectedIds(new Set()); return; }
        if (contextMenu) { setContextMenu(null); return; }
      }
      // Ctrl+A: select all visible
      if (e.key === 'a' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setSelectedIds(new Set(assets.map(a => a.id)));
      }
      // Ctrl+F: focus search
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        const searchInput = document.querySelector('[placeholder="搜索文件名..."]') as HTMLInputElement;
        searchInput?.focus();
      }
      // Delete: batch delete selected assets
      if (e.key === 'Delete' && selectedIds.size > 0) {
        handleBatchDelete();
      }
      // 1-5: quick rating for detail asset
      if (detailAssetId && ['1', '2', '3', '4', '5'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        handleSetRating(detailAssetId, parseInt(e.key));
      }
      // 0: clear rating
      if (detailAssetId && e.key === '0' && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        handleSetRating(detailAssetId, 0);
      }
      // F: toggle favorite for detail asset
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && detailAssetId) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        handleToggleFavorite(detailAssetId);
      }
      // Space: toggle preview for detail asset
      if (e.key === ' ' && detailAssetId && previewIndex < 0) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        const idx = assets.findIndex(a => a.id === detailAssetId);
        if (idx >= 0) setPreviewIndex(idx);
      }
      // I: toggle detail sidebar
      if (e.key === 'i' && !e.ctrlKey && !e.metaKey && selectedIds.size === 1) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        const [id] = selectedIds;
        setDetailAssetId(detailAssetId === id ? null : id);
      }
      // Ctrl+E: batch export
      if (e.key === 'e' && (e.ctrlKey || e.metaKey) && selectedIds.size > 0) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handleBatchExport();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewIndex, detailAssetId, selectedIds, contextMenu, assets, favoriteIds]);

  // ---- Actions ----
  const handleAddFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: '选择资源文件夹' });
      if (!selected || typeof selected !== 'string') return;
      await invoke('asset_add_folder', { path: selected, spaceType: space });
      await loadFolders();
      showToast('success', '文件夹已添加');
    } catch (e: any) {
      showToast('error', e?.toString() || '添加失败');
    }
  };

  const handleRemoveFolder = async (folderId: number) => {
    try {
      await invoke('asset_remove_folder', { folderId });
      if (selectedFolderId === folderId) setSelectedFolderId(null);
      await loadFolders();
      showToast('success', '文件夹已移除');
    } catch (e: any) {
      showToast('error', e?.toString() || '移除失败');
    }
  };

  const handleScanFolder = async (folderId: number) => {
    setScanning(true);
    setScanProgress({ folder_id: folderId, current: 0, total: 0, file_name: '准备扫描...', phase: 'scanning' });
    try {
      await invoke('asset_scan_folder', { folderId });
    } catch (e: any) {
      showToast('error', '扫描失败: ' + (e?.toString() || ''));
      setScanning(false);
      setScanProgress(null);
    }
  };

  const handleScanAll = async () => {
    const spaceFolders = folders.filter(f => f.space_type === space);
    for (const folder of spaceFolders) {
      await handleScanFolder(folder.id);
    }
  };

  // ---- Derived ----
  const spaceFolders = useMemo(() => folders.filter(f => f.space_type === space), [folders, space]);

  // ---- Render ----
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex-none flex items-center gap-3 px-4 py-3 border-b border-[#222]">
        {/* Space switch */}
        <div className="flex bg-[#1a1a1a] rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => { setSpace('personal'); setSelectedFolderId(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              space === 'personal' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-[#aaa]'
            }`}
          >
            <HardDrive size={13} /> 个人空间
          </button>
          <button
            onClick={() => { setSpace('team'); setSelectedFolderId(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              space === 'team' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-[#aaa]'
            }`}
          >
            <Globe size={13} /> 团队空间
          </button>
        </div>

        {/* Search */}
        <div className="flex-1 relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="搜索文件名..."
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6] transition-colors"
          />
          {searchText && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#999]"
              onClick={() => setSearchText('')}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Format filters */}
        <div className="flex gap-1">
          {FORMAT_GROUPS.map(g => {
            const active = g.exts.length === 0
              ? formatFilter.length === 0
              : JSON.stringify(formatFilter) === JSON.stringify(g.exts);
            return (
              <button
                key={g.label}
                onClick={() => setFormatFilter(g.exts)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  active ? 'bg-[#2563eb] text-white' : 'bg-[#1a1a1a] text-[#888] hover:text-[#ccc]'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>

        {/* Favorite filter */}
        <button
          onClick={() => setFilterFavorites(!filterFavorites)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            filterFavorites ? 'bg-[#f59e0b] text-white' : 'bg-[#1a1a1a] text-[#888] hover:text-[#ccc]'
          }`}
          title="只看收藏"
        >
          <Bookmark size={12} /> 收藏
        </button>

        {/* Min rating filter */}
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(r => (
            <button
              key={r}
              onClick={() => setFilterMinRating(filterMinRating === r ? 0 : r)}
              className="transition-colors hover:scale-110"
              title={filterMinRating === r ? '取消评分过滤' : `最少 ${r} 星`}
            >
              <Star
                size={13}
                className={r <= filterMinRating ? 'text-yellow-400 fill-yellow-400' : 'text-[#333]'}
              />
            </button>
          ))}
        </div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <select
            value={filterByTag ?? ''}
            onChange={e => setFilterByTag(e.target.value ? Number(e.target.value) : null)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[11px] text-[#aaa] px-2 py-1 outline-none cursor-pointer"
          >
            <option value="">全部标签</option>
            {allTags.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.asset_count})</option>
            ))}
          </select>
        )}

        {/* Tag Manager toggle */}
        <button
          onClick={() => setShowTagManager(!showTagManager)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            showTagManager ? 'bg-[#2563eb] text-white' : 'bg-[#1a1a1a] text-[#888] hover:text-[#ccc]'
          }`}
          title="标签管理"
        >
          <Tag size={12} /> 标签
        </button>

        {/* Sort */}
        <div className="flex items-center gap-1">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[11px] text-[#aaa] px-2 py-1 outline-none cursor-pointer"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDesc(!sortDesc)}
            className="text-[#888] hover:text-[#ccc] text-[11px] px-1"
            title={sortDesc ? '降序' : '升序'}
          >
            {sortDesc ? '↓' : '↑'}
          </button>
        </div>

        {/* Grid size toggle */}
        <div className="flex bg-[#1a1a1a] rounded p-0.5 gap-0.5">
          <button
            onClick={() => setThumbSize('small')}
            className={`p-1 rounded ${thumbSize === 'small' ? 'bg-[#2a2a2a] text-white' : 'text-[#666]'}`}
            title="小图"
          >
            <Grid size={14} />
          </button>
          <button
            onClick={() => setThumbSize('large')}
            className={`p-1 rounded ${thumbSize === 'large' ? 'bg-[#2a2a2a] text-white' : 'text-[#666]'}`}
            title="大图"
          >
            <LayoutGrid size={14} />
          </button>
        </div>

        {/* FFmpeg settings */}
        <button
          onClick={() => setShowFfmpegSettings(true)}
          className="p-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-[#666] hover:text-[#aaa] rounded transition-colors"
          title="FFmpeg 设置"
        >
          <Settings size={13} />
        </button>

        {/* Scan all */}
        <button
          onClick={handleScanAll}
          disabled={scanning || spaceFolders.length === 0}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-[#aaa] rounded-lg text-[11px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="扫描所有文件夹"
        >
          <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
          {scanning ? '扫描中' : '刷新'}
        </button>
      </div>

      {/* Scan progress bar */}
      {scanning && scanProgress && (
        <div className="flex-none px-4 py-2 bg-[#111] border-b border-[#222]">
          <div className="flex items-center gap-3 text-xs text-[#888]">
            <Loader2 size={14} className="animate-spin text-[#3b82f6]" />
            <span>
              {scanProgress.phase === 'scanning' ? '扫描文件...' : `处理缩略图 ${scanProgress.current}/${scanProgress.total}`}
            </span>
            <span className="truncate max-w-[300px]">{scanProgress.file_name}</span>
          </div>
          {scanProgress.total > 0 && (
            <div className="mt-1 h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#3b82f6] rounded-full transition-all"
                style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Batch operations toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex-none flex items-center gap-3 px-4 py-2 bg-[#1a2332] border-b border-[#2563eb]/30">
          <span className="text-xs text-[#3b82f6] font-medium">
            已选择 {selectedIds.size} 个资源
          </span>
          <div className="flex items-center gap-1">
            {allTags.slice(0, 5).map(tag => (
              <button
                key={tag.id}
                className="text-[10px] px-2 py-0.5 rounded-full transition-colors hover:brightness-125"
                style={{ background: tag.color + '22', color: tag.color }}
                onClick={async () => {
                  try {
                    await invoke('asset_batch_add_tag', { assetIds: Array.from(selectedIds), tagId: tag.id });
                    showToast('success', `已批量添加标签 "${tag.name}"`);
                    // Refresh tags cache
                    for (const id of selectedIds) {
                      const t = assetTagsMap.get(id) || [];
                      if (!t.some(tt => tt.id === tag.id)) {
                        setAssetTagsMap(prev => new Map(prev).set(id, [...t, tag]));
                      }
                    }
                  } catch (e: any) {
                    showToast('error', e?.toString() || '批量添加失败');
                  }
                }}
                title={`批量添加标签: ${tag.name}`}
              >
                + {tag.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-2">
            {[1, 2, 3, 4, 5].map(r => (
              <button
                key={r}
                className="transition-colors hover:scale-110"
                onClick={() => handleBatchSetRating(r)}
                title={`批量设置 ${r} 星`}
              >
                <Star size={14} className="text-yellow-400 fill-yellow-400" />
              </button>
            ))}
          </div>
          <button
            onClick={() => handleBatchFavorite(true)}
            className="text-xs px-2 py-1 rounded bg-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/30 flex items-center gap-1"
            title="批量收藏"
          >
            <Bookmark size={12} /> 收藏
          </button>
          <button
            onClick={() => setShowComparePanel(true)}
            className="text-xs px-2 py-1 rounded bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 flex items-center gap-1"
            title="多图对比 & 压缩"
          >
            <SlidersHorizontal size={12} /> 对比
          </button>
          <button
            onClick={() => setShowMultiVideo(true)}
            className="text-xs px-2 py-1 rounded bg-[#06b6d4]/20 text-[#06b6d4] hover:bg-[#06b6d4]/30 flex items-center gap-1"
            title="多视频同时播放"
          >
            <Video size={12} /> 同播
          </button>
          <button
            onClick={handleBatchExport}
            className="text-xs px-2 py-1 rounded bg-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/30 flex items-center gap-1"
            title="批量导出"
          >
            <Download size={12} /> 导出
          </button>
          <button
            onClick={handleBatchDelete}
            className="text-xs px-2 py-1 rounded bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30 flex items-center gap-1"
            title="批量删除（从库中移除）"
          >
            <Trash2 size={12} /> 删除
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-[#666] hover:text-[#aaa] flex items-center gap-1"
          >
            <X size={12} /> 取消选择
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Folder list */}
        {sidebarOpen && (
          <div className="flex-none w-56 border-r border-[#222] flex flex-col bg-[#0d0d0d]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a]">
              <span className="text-xs font-medium text-[#888]">文件夹</span>
              <button
                onClick={handleAddFolder}
                className="text-[#666] hover:text-[#3b82f6] transition-colors"
                title="添加文件夹"
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {/* "All" option */}
              <button
                onClick={() => setSelectedFolderId(null)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                  selectedFolderId === null
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#888] hover:bg-[#111] hover:text-[#ccc]'
                }`}
              >
                <FolderOpen size={13} />
                <span className="truncate flex-1">全部</span>
                <span className="text-[10px] text-[#555]">
                  {spaceFolders.reduce((s, f) => s + f.asset_count, 0)}
                </span>
              </button>

              {spaceFolders.map(folder => (
                <div
                  key={folder.id}
                  className={`group flex items-center gap-2 px-3 py-2 text-xs transition-colors cursor-pointer ${
                    selectedFolderId === folder.id
                      ? 'bg-[#1a1a1a] text-white'
                      : 'text-[#888] hover:bg-[#111] hover:text-[#ccc]'
                  }`}
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  <FolderOpen size={13} className="flex-none" />
                  <span className="truncate flex-1" title={folder.path}>{folder.name}</span>
                  <span className="text-[10px] text-[#555] flex-none">{folder.asset_count}</span>
                  <div className="hidden group-hover:flex items-center gap-0.5 flex-none">
                    <button
                      onClick={e => { e.stopPropagation(); handleScanFolder(folder.id); }}
                      className="text-[#555] hover:text-[#3b82f6]"
                      title="扫描此文件夹"
                    >
                      <RefreshCw size={11} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleRemoveFolder(folder.id); }}
                      className="text-[#555] hover:text-[#ef4444]"
                      title="移除此文件夹"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}

              {spaceFolders.length === 0 && (
                <div className="px-4 py-8 text-center text-[11px] text-[#555]">
                  <FolderOpen size={24} className="mx-auto mb-2 text-[#333]" />
                  <p>暂无文件夹</p>
                  <p className="mt-1">点击 + 添加资源目录</p>
                </div>
              )}

              {/* Smart Folders section */}
              {smartFolders.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                    <span className="text-[10px] font-medium text-[#555] uppercase tracking-wider">智能文件夹</span>
                  </div>
                  {smartFolders.map(sf => (
                    <div
                      key={sf.id}
                      className={`group flex items-center gap-2 px-3 py-2 text-xs transition-colors cursor-pointer ${
                        activeSmartFolderId === sf.id ? 'bg-[#1a1a1a] text-[#f59e0b]' : 'text-[#888] hover:bg-[#111] hover:text-[#ccc]'
                      }`}
                      onClick={() => {
                        setActiveSmartFolderId(activeSmartFolderId === sf.id ? null : sf.id);
                        setSelectedFolderId(null);
                        // Apply smart folder conditions to filters
                        const conds: SmartFolderConditions = JSON.parse(sf.conditions || '{}');
                        if (conds.extensions?.length) setFormatFilter(conds.extensions);
                        if (conds.name_contains) setSearchText(conds.name_contains);
                      }}
                    >
                      <Sparkles size={13} className="flex-none text-[#f59e0b]" />
                      <span className="truncate flex-1">{sf.name}</span>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteSmartFolder(sf.id); }}
                        className="hidden group-hover:block text-[#555] hover:text-[#ef4444]"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </>
              )}

              {/* Add smart folder button */}
              <div className="px-3 pt-2">
                <button
                  onClick={() => { setShowSmartFolderEditor(true); setEditingSmartFolder(null); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#555] hover:text-[#f59e0b] hover:bg-[#111] rounded transition-colors"
                >
                  <Sparkles size={12} />
                  <span>新建智能文件夹</span>
                </button>
              </div>

              {/* Tag filter section */}
              {allTags.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                    <span className="text-[10px] font-medium text-[#555] uppercase tracking-wider">标签筛选</span>
                    <button
                      onClick={() => setShowTagManager(true)}
                      className="text-[#444] hover:text-[#3b82f6]"
                      title="管理标签"
                    >
                      <Palette size={11} />
                    </button>
                  </div>
                  <div className="px-3 pb-2 flex flex-wrap gap-1">
                    {allTags.slice(0, 10).map(tag => (
                      <button
                        key={tag.id}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-all ${
                          filterByTag === tag.id
                            ? 'border-transparent scale-105'
                            : 'border-transparent opacity-60 hover:opacity-100'
                        }`}
                        style={
                          filterByTag === tag.id
                            ? { background: tag.color + '33', color: tag.color, border: `1px solid ${tag.color}` }
                            : { background: tag.color + '15', color: tag.color }
                        }
                        onClick={() => setFilterByTag(filterByTag === tag.id ? null : tag.id)}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Stats */}
            {stats && stats.total_assets > 0 && (
              <div className="flex-none px-3 py-2 border-t border-[#1a1a1a] text-[10px] text-[#555]">
                <div>{stats.total_assets} 个文件 · {formatFileSize(stats.total_size)}</div>
                <div className="flex flex-wrap gap-x-2 mt-0.5">
                  {stats.format_counts.slice(0, 5).map(([ext, cnt]) => (
                    <span key={ext}>{ext.toUpperCase()} {cnt}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Grid area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Toggle sidebar */}
          <div className="flex-none flex items-center px-2 py-1 border-b border-[#1a1a1a]">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-[#555] hover:text-[#999] p-1"
              title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
            >
              {sidebarOpen ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
            <span className="text-[11px] text-[#555] ml-1">
              {totalAssets} 个资源
              {loading && ' · 加载中...'}
            </span>
          </div>

          {/* Scrollable grid */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
            {assets.length > 0 ? (
              <VirtualGrid
                assets={assets}
                containerRef={scrollRef}
                onClickAsset={(asset, _idx) => {
                  // Multi-select with Ctrl/Cmd
                  if (window.event && (window.event as any).ctrlKey) {
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(asset.id)) next.delete(asset.id);
                      else next.add(asset.id);
                      return next;
                    });
                    return;
                  }
                  // Shift-click for range select
                  if (window.event && (window.event as any).shiftKey && selectedIds.size > 0) {
                    const lastId = Array.from(selectedIds).pop()!;
                    const lastIdx = assets.findIndex(a => a.id === lastId);
                    const curIdx = assets.findIndex(a => a.id === asset.id);
                    if (lastIdx >= 0 && curIdx >= 0) {
                      const start = Math.min(lastIdx, curIdx);
                      const end = Math.max(lastIdx, curIdx);
                      const newIds = new Set(selectedIds);
                      for (let i = start; i <= end; i++) newIds.add(assets[i].id);
                      setSelectedIds(newIds);
                      return;
                    }
                  }
                  setSelectedIds(new Set());
                  setDetailAssetId(asset.id);
                }}
                onDoubleClickAsset={(_asset, idx) => {
                  setPreviewIndex(idx);
                }}
                onContextMenu={handleContextMenu}
                selectedIds={selectedIds}
                onBoxSelect={(ids) => {
                  if (window.event && (window.event as any).ctrlKey) {
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      ids.forEach(id => next.add(id));
                      return next;
                    });
                  } else {
                    setSelectedIds(ids);
                  }
                }}
                assetTagsMap={assetTagsMap}
                assetRatingsMap={assetRatingsMap}
                lockedPaths={new Set(activeLocks.map(l => l.file_path))}
                thumbSize={thumbSize}
              />
            ) : !loading ? (
              <div className="flex flex-col items-center justify-center h-full text-[#444]">
                {spaceFolders.length === 0 ? (
                  <>
                    <div className="w-20 h-20 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center mb-4">
                      <FolderOpen size={36} className="text-[#333]" />
                    </div>
                    <h3 className="text-sm text-[#888] font-medium mb-1">开始管理你的美术资源</h3>
                    <p className="text-xs text-[#555] mb-4 text-center max-w-xs">
                      添加本地或局域网上的资源文件夹，支持 PSD、PNG、FBX、Spine 等主流格式
                    </p>
                    <button
                      onClick={handleAddFolder}
                      className="px-5 py-2.5 bg-[#2563eb] text-white text-xs rounded-lg hover:bg-[#1d4ed8] transition-colors flex items-center gap-2"
                    >
                      <Plus size={14} /> 添加资源文件夹
                    </button>
                    <div className="mt-6 flex flex-wrap justify-center gap-3 text-[10px] text-[#444]">
                      <span>Ctrl+F 搜索</span>
                      <span>Ctrl+A 全选</span>
                      <span>1-5 快速评分</span>
                      <span>F 收藏</span>
                      <span>I 详情</span>
                      <span>Space 预览</span>
                      <span>Del 删除</span>
                      <span>Ctrl+E 导出</span>
                      <span>右键 更多操作</span>
                    </div>
                  </>
                ) : (
                  <>
                    <ImageIcon size={48} className="mb-3 text-[#333]" />
                    <p className="text-sm text-[#666]">没有找到匹配的资源</p>
                    {(searchText || formatFilter.length > 0 || filterByTag || filterMinRating > 0 || filterFavorites) && (
                      <button
                        onClick={() => { setSearchText(''); setFormatFilter([]); setFilterByTag(null); setFilterMinRating(0); setFilterFavorites(false); }}
                        className="mt-2 text-xs text-[#3b82f6] hover:text-[#60a5fa]"
                      >
                        清除筛选条件
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Detail Sidebar */}
        {detailAssetId && !previewAsset && (() => {
          const detailAsset = assets.find(a => a.id === detailAssetId);
          if (!detailAsset) return null;
          return (
            <AssetDetailSidebar
              asset={detailAsset}
              detail={detailData}
              allTags={allTags}
              onClose={() => setDetailAssetId(null)}
              onSetRating={r => handleSetRating(detailAssetId, r)}
              onSetNote={n => handleSetNote(detailAssetId, n)}
              onAddTag={tagId => handleAddTagToAsset(detailAssetId, tagId)}
              onRemoveTag={tagId => handleRemoveTagFromAsset(detailAssetId, tagId)}
              isFavorite={favoriteIds.has(detailAssetId)}
              onToggleFavorite={() => handleToggleFavorite(detailAssetId)}
              isTeamSpace={space === 'team'}
              lockStatus={detailLockStatus}
              currentUser={currentUser}
              onLock={() => handleLockFile(detailAsset.file_path)}
              onUnlock={() => handleUnlockFile(detailAsset.file_path)}
              fileHistory={detailHistory}
              onRestoreVersion={v => handleRestoreVersion(detailAsset.file_path, v)}
            />
          );
        })()}
      </div>

      {/* Preview modal */}
      {previewAsset && (
        <PreviewModal
          asset={previewAsset}
          assets={assets}
          currentIndex={previewIndex}
          onClose={() => setPreviewIndex(-1)}
          onNavigate={setPreviewIndex}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          allTags={allTags}
          assetTags={contextAssetTags}
          assetRating={contextAssetRating}
          onClose={() => setContextMenu(null)}
          onAddTag={tagId => handleAddTagToAsset(contextMenu.assetId, tagId)}
          onRemoveTag={tagId => handleRemoveTagFromAsset(contextMenu.assetId, tagId)}
          onSetRating={r => handleSetRating(contextMenu.assetId, r)}
          onCopyPath={handleCopyPath}
          onShowDetail={() => setDetailAssetId(contextMenu.assetId)}
        />
      )}

      {/* Tag Manager panel */}
      {showTagManager && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-24" onClick={() => setShowTagManager(false)}>
          <div onClick={e => e.stopPropagation()}>
            <TagManagerPanel
              tags={allTags}
              onCreateTag={handleCreateTag}
              onDeleteTag={handleDeleteTag}
              onUpdateTag={handleUpdateTag}
              onClose={() => setShowTagManager(false)}
            />
          </div>
        </div>
      )}

      {/* Smart Folder Editor */}
      {showSmartFolderEditor && (
        <SmartFolderEditor
          folder={editingSmartFolder}
          allTags={allTags}
          onSave={handleCreateSmartFolder}
          onClose={() => setShowSmartFolderEditor(false)}
        />
      )}

      {/* FFmpeg Settings */}
      {showFfmpegSettings && (
        <FfmpegSettingsPanel onClose={() => setShowFfmpegSettings(false)} />
      )}

      {/* Compare Panel */}
      {showComparePanel && selectedIds.size > 0 && (
        <AssetComparePanel
          assets={assets.filter(a => selectedIds.has(a.id))}
          onClose={() => setShowComparePanel(false)}
        />
      )}

      {/* Multi-Video Player */}
      {showMultiVideo && selectedIds.size > 0 && (
        <MultiVideoPanel
          assets={assets.filter(a => selectedIds.has(a.id) && VIDEO_EXTS.has(a.file_ext))}
          onClose={() => setShowMultiVideo(false)}
        />
      )}
    </div>
  );
}
