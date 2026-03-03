import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FolderOpen, Plus, Trash2, RefreshCw, Search, ChevronDown, ChevronRight, ChevronLeft,
  X, ZoomIn, ArrowLeft, ArrowRight, Grid, LayoutGrid, Loader2,
  Image as ImageIcon, Film, Box, FileQuestion, HardDrive, Globe,
  Star, Tag, MessageSquare, Sparkles, Edit3, Check, Palette, Copy,
  MoreHorizontal, ChevronUp, SlidersHorizontal, Bookmark,
  Lock, Unlock, History, Shield, Users, AlertTriangle, Clock,
  Settings, Download, Video, Music, List, Shuffle, Type, Columns, RotateCcw
} from 'lucide-react';
import { invoke } from '../services/tauriInvokeInterceptor';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import { getSavedStoragePath } from '../services/fileStorageService';
import { useToast } from './Toast';
import { consoleService } from '../services/consoleService';
import AssetComparePanel from './AssetComparePanel';
import { SkeletonImage, Skeleton, SkeletonMasonryGrid, SkeletonDetailPanel, SkeletonPreview, SkeletonText, SkeletonList } from './ui/Skeleton';

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

interface CustomPaths {
  source_path: string;
  slice_path: string;
  effect_path: string;
}

interface AssetDetail {
  asset: AssetEntry;
  tags: TagInfo[];
  rating: number;
  note: string;
  custom_paths: CustomPaths;
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
const FONT_EXTS = new Set(['ttf', 'otf', 'woff', 'woff2']);

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
  if (FONT_EXTS.has(ext)) return Type;
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
    ttf: '#14b8a6', otf: '#14b8a6', woff: '#14b8a6', woff2: '#14b8a6',
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
const ImageAnalysisSection: React.FC<{ filePath: string; thumbPath?: string }> = ({ filePath, thumbPath }) => {
  const [enabled, setEnabled] = useState(false);
  const [analysisData, setAnalysisData] = useState<{
    colors: { hex: string; pct: number }[];
    avgBrightness: number;
    contrastScore: number;
    colorCount: number;
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    if (analysisData || analysisError) return; // already analyzed or failed
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      // Determine which source to use for analysis
      // Browser-renderable extensions (can be loaded via <img>)
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const browserRenderable = new Set(['png','jpg','jpeg','gif','webp','bmp','svg','ico','avif']);
      const useOriginal = browserRenderable.has(ext);

      // Load image with crossOrigin to allow canvas pixel access (avoid taint)
      const loadImg = (url: string): Promise<HTMLImageElement> => new Promise((ok, fail) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => ok(i);
        i.onerror = () => fail(new Error('Image load failed: ' + url.slice(0, 80)));
        i.src = url;
      });

      // Fallback: read file via Tauri FS API and create blob URL (bypasses CORS entirely)
      const loadImgViaFs = async (path: string): Promise<HTMLImageElement> => {
        const { readBinaryFile } = await import('@tauri-apps/api/fs');
        const bytes = await readBinaryFile(path);
        const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' };
        const mime = mimeMap[ext] || 'image/png';
        const blob = new Blob([bytes], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        try {
          const img = await new Promise<HTMLImageElement>((ok, fail) => {
            const i = new Image();
            i.onload = () => ok(i);
            i.onerror = () => fail(new Error('Blob image load failed'));
            i.src = blobUrl;
          });
          // Revoke blob URL after image is loaded (data is already decoded into the Image)
          URL.revokeObjectURL(blobUrl);
          return img;
        } catch (e) {
          URL.revokeObjectURL(blobUrl);
          throw e;
        }
      };

      let img: HTMLImageElement;
      const targetPath = useOriginal ? filePath : (thumbPath || '');
      if (!targetPath) {
        throw new Error('No thumbnail available for non-browser format: ' + ext);
      }

      // Try loading with crossOrigin first, then try canvas access, fallback to FS API
      try {
        img = await loadImg(convertFileSrc(targetPath));
        // Test canvas access early to detect taint
        const testCanvas = document.createElement('canvas');
        testCanvas.width = 1; testCanvas.height = 1;
        const testCtx = testCanvas.getContext('2d')!;
        testCtx.drawImage(img, 0, 0, 1, 1);
        testCtx.getImageData(0, 0, 1, 1); // throws if tainted
      } catch {
        // crossOrigin load or canvas access failed — fallback to Tauri FS API
        try {
          img = await loadImgViaFs(targetPath);
        } catch {
          // Last resort: try thumbnail via FS
          if (thumbPath && targetPath !== thumbPath) {
            img = await loadImgViaFs(thumbPath);
          } else {
            throw new Error('Image load failed for: ' + targetPath.split(/[\\/]/).pop());
          }
        }
      }
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('Image analysis skipped for', filePath, ':', msg);
      setAnalysisError(msg);
    }
    setAnalyzing(false);
  }, [filePath, thumbPath, analysisData, analysisError]);

  useEffect(() => { if (enabled) runAnalysis(); }, [enabled, runAnalysis]);
  // Reset when file changes
  useEffect(() => { setAnalysisData(null); setAnalysisError(null); setEnabled(false); }, [filePath]);

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
            {analyzing && !analysisData && (
              <div className="space-y-3">
                <div>
                  <Skeleton className="h-2.5 w-12 mb-1.5" />
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="w-6 h-6 rounded" />
                    ))}
                  </div>
                </div>
                <div>
                  <Skeleton className="h-2.5 w-8 mb-1.5" />
                  <Skeleton className="h-4 w-full rounded-full" />
                </div>
                <div>
                  <Skeleton className="h-2.5 w-10 mb-1.5" />
                  <Skeleton className="h-4 w-full rounded-full" />
                </div>
              </div>
            )}
            {analysisError && (
              <div className="text-[11px] text-[#666] py-2 space-y-1">
                <div>{analysisError.includes('non-browser format') ? '此格式暂不支持图片分析' : '图片分析失败'}</div>
                {!analysisError.includes('non-browser format') && (
                  <button
                    onClick={() => { setAnalysisError(null); setAnalysisData(null); }}
                    className="text-[10px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
                  >
                    点击重试
                  </button>
                )}
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
  onSetCustomPaths: (paths: CustomPaths) => void;
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
}> = ({ asset, detail, allTags, onClose, onSetRating, onSetNote, onSetCustomPaths, onAddTag, onRemoveTag,
  isFavorite, onToggleFavorite,
  isTeamSpace, lockStatus, currentUser, onLock, onUnlock, fileHistory, onRestoreVersion }) => {
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [showTagPicker, setShowTagPicker] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [customPaths, setCustomPaths] = useState<CustomPaths>({ source_path: '', slice_path: '', effect_path: '' });
  const [editingPaths, setEditingPaths] = useState(false);

  useEffect(() => {
    if (detail) setNoteText(detail.note || '');
  }, [detail?.note]);

  useEffect(() => {
    if (detail?.custom_paths) setCustomPaths(detail.custom_paths);
  }, [detail?.custom_paths]);

  useEffect(() => {
    if (editingNote && noteRef.current) noteRef.current.focus();
  }, [editingNote]);

  // 有缩略图用缩略图；无缩略图时图片类型用原图路径回退
  const thumbUrl = asset.thumb_path
    ? convertFileSrc(asset.thumb_path)
    : (IMAGE_EXTS.has(asset.file_ext) ? convertFileSrc(asset.file_path) : '');
  const detailTags = detail?.tags || [];
  const availableTags = allTags.filter(t => !detailTags.some(dt => dt.id === t.id));
  const isVideoFile = VIDEO_EXTS.has(asset.file_ext);
  const is3DFile = MESH_EXTS.has(asset.file_ext);

  return (
    <div className="flex-none w-72 border-l border-[#222] bg-[#0d0d0d] flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a]">
        <span className="text-xs font-medium text-[#888]">资源详情</span>
        <button onClick={onClose} className="text-[#555] hover:text-[#aaa]"><X size={14} /></button>
      </div>

      {/* Preview - video / 3D / thumbnail */}
      <div className="p-3">
        {isVideoFile ? (
          /* Inline video player for sidebar */
          <div className="w-full rounded-lg overflow-hidden bg-[#1a1a1a] border border-[#2a2a2a]">
            <video
              key={asset.id}
              src={convertFileSrc(asset.file_path)}
              controls
              muted
              preload="metadata"
              className="w-full rounded-lg"
              style={{ maxHeight: 300 }}
              poster={thumbUrl || undefined}
            />
          </div>
        ) : is3DFile ? (
          /* Inline 3D viewer for sidebar */
          <div className="w-full rounded-lg overflow-hidden bg-[#1a1a1a] border border-[#2a2a2a]" style={{ height: 220 }}>
            <React.Suspense fallback={<SkeletonPreview className="w-full h-full" />}>
              <LazyModelViewer3D filePath={asset.file_path} fileExt={asset.file_ext} fileName={asset.file_name} />
            </React.Suspense>
          </div>
        ) : (
          <div className="w-full rounded-lg overflow-hidden bg-[#1a1a1a] border border-[#2a2a2a]" style={{ aspectRatio: asset.width && asset.height ? `${asset.width}/${asset.height}` : '1/1', maxHeight: 300 }}>
            {thumbUrl ? (
              <SkeletonImage
                src={thumbUrl}
                alt={asset.file_name}
                className="w-full h-full"
                imgClassName="w-full h-full object-contain"
                fadeDuration={250}
                fallback={<div className="w-full h-full flex items-center justify-center text-[#444]">{React.createElement(getFileIcon(asset.file_ext), { size: 48 })}</div>}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#444]">
                {React.createElement(getFileIcon(asset.file_ext), { size: 48 })}
              </div>
            )}
          </div>
        )}
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

      {/* Custom Paths */}
      <div className="border-t border-[#1a1a1a]" />
      <div className="px-3 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FolderOpen size={12} className="text-[#666]" />
            <span className="text-[11px] text-[#888]">关联路径</span>
          </div>
          <button
            onClick={() => {
              if (editingPaths) {
                onSetCustomPaths(customPaths);
                setEditingPaths(false);
              } else {
                setEditingPaths(true);
              }
            }}
            className="text-[#555] hover:text-[#3b82f6]"
          >
            {editingPaths ? <Check size={14} /> : <Edit3 size={12} />}
          </button>
        </div>
        {([
          ['source_path', '源文件路径'] as const,
          ['slice_path', '切图路径'] as const,
          ['effect_path', '动效路径'] as const,
        ]).map(([key, label]) => (
          <div key={key} className="mb-2 last:mb-0">
            <span className="text-[10px] text-[#555] block mb-0.5">{label}</span>
            {editingPaths ? (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={customPaths[key]}
                  onChange={e => setCustomPaths(prev => ({ ...prev, [key]: e.target.value }))}
                  onBlur={() => { onSetCustomPaths(customPaths); }}
                  className="flex-1 min-w-0 bg-[#111] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]"
                  placeholder={`输入${label}...`}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { open } = await import('@tauri-apps/api/dialog');
                      const selected = await open({ directory: key !== 'source_path', title: `选择${label}` });
                      if (selected && typeof selected === 'string') {
                        const next = { ...customPaths, [key]: selected };
                        setCustomPaths(next);
                        onSetCustomPaths(next);
                      }
                    } catch {}
                  }}
                  className="px-1.5 py-1 bg-[#1a1a1a] hover:bg-[#222] rounded text-[#555] hover:text-[#aaa]"
                  title="浏览..."
                >
                  <FolderOpen size={12} />
                </button>
              </div>
            ) : (
              customPaths[key] ? (
                <p
                  className="text-xs cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-[#1a1a1a] truncate text-[#3b82f6] hover:text-[#60a5fa] hover:underline"
                  title={`点击打开: ${customPaths[key]}`}
                  onClick={async () => {
                    try {
                      const { invoke: inv } = await import('@tauri-apps/api/tauri');
                      const p = customPaths[key];
                      const isFile = /\.[a-zA-Z0-9]+$/.test(p);
                      if (isFile) {
                        await inv('open_folder', { path: p.replace(/[\\/][^\\/]+$/, '') });
                      } else {
                        await inv('open_folder', { path: p });
                      }
                    } catch {}
                  }}
                >
                  {customPaths[key]}
                </p>
              ) : (
                <p
                  className="text-xs cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-[#1a1a1a] truncate text-[#444] italic"
                  onClick={() => setEditingPaths(true)}
                >
                  点击添加{label}
                </p>
              )
            )}
          </div>
        ))}
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
      {IMAGE_EXTS.has(asset.file_ext) && <ImageAnalysisSection filePath={asset.file_path} thumbPath={asset.thumb_path} />}
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
  onOpenInNewWindow?: () => void;
}> = ({ menu, allTags, assetTags, assetRating, onClose, onAddTag, onRemoveTag, onSetRating, onCopyPath, onShowDetail, onOpenInNewWindow }) => {
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
      {onOpenInNewWindow && (
        <button
          className="w-full text-left px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#2a2a2a] flex items-center gap-2"
          onClick={() => { onOpenInNewWindow(); onClose(); }}
        >
          <Columns size={12} /> 新窗口打开
        </button>
      )}

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
// Settings Panel (AI Models + FFmpeg)
// ============================================================

const FfmpegSettingsPanel: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const [status, setStatus] = useState<FfmpegStatusInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<FfmpegDownloadProgress | null>(null);
  const [aiModelsDir, setAiModelsDir] = useState('');
  const [aiDefaultDir, setAiDefaultDir] = useState('');
  const [aiIsCustom, setAiIsCustom] = useState(false);
  const [aiFilesReady, setAiFilesReady] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const s = await invoke<FfmpegStatusInfo>('ffmpeg_check');
        setStatus(s);
      } catch { /* ignore */ }
      try {
        const info = await invoke<{ models_dir: string; default_dir: string; is_custom: boolean }>('ai_get_models_dir');
        setAiModelsDir(info.models_dir);
        setAiDefaultDir(info.default_dir);
        setAiIsCustom(info.is_custom);
        const check = await invoke<{ all_ready: boolean }>('ai_check_model');
        setAiFilesReady(check.all_ready);
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

  const handleSelectAiDir = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: '选择 AI 模型存储目录' });
      if (!selected || typeof selected !== 'string') return;
      await invoke('ai_set_models_dir', { path: selected });
      setAiModelsDir(selected);
      setAiIsCustom(true);
      const check = await invoke<{ all_ready: boolean }>('ai_check_model');
      setAiFilesReady(check.all_ready);
      showToast('success', '模型目录已更新');
    } catch (e: any) {
      showToast('error', e?.toString() || '设置失败');
    }
  };

  const handleResetAiDir = async () => {
    try {
      await invoke('ai_set_models_dir', { path: aiDefaultDir });
      setAiModelsDir(aiDefaultDir);
      setAiIsCustom(false);
      const check = await invoke<{ all_ready: boolean }>('ai_check_model');
      setAiFilesReady(check.all_ready);
      showToast('success', '已恢复默认目录');
    } catch (e: any) {
      showToast('error', e?.toString() || '重置失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Settings size={16} className="text-[#3b82f6]" />
            资源管理设置
          </h3>
          <button onClick={onClose} className="text-[#555] hover:text-[#aaa]"><X size={16} /></button>
        </div>

        {/* AI Model Path Section */}
        <div className="mb-5">
          <h4 className="text-xs font-medium text-[#ccc] mb-3 flex items-center gap-2">
            <Sparkles size={13} className="text-purple-400" />
            AI 语义搜索模型
          </h4>

          <div className="bg-[#111] rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full flex-none ${aiFilesReady ? 'bg-[#22c55e]' : 'bg-[#666]'}`} />
              <span className="text-[11px] text-[#aaa]">
                {aiFilesReady ? '模型已就绪' : '模型未下载'}
              </span>
            </div>
            <div className="text-[10px] text-[#666] break-all font-mono leading-relaxed mb-2">
              {aiModelsDir || '加载中…'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAiDir}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-[#aaa] rounded text-[11px] border border-[#333] transition-colors"
              >
                <FolderOpen size={11} />
                选择目录
              </button>
              {aiIsCustom && (
                <button
                  onClick={handleResetAiDir}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[#888] hover:text-[#ccc] rounded text-[11px] transition-colors"
                >
                  <RotateCcw size={11} />
                  恢复默认
                </button>
              )}
            </div>
          </div>

          <p className="text-[10px] text-[#555] leading-relaxed">
            CLIP 视觉语义模型 (~600MB)。如本地已有模型文件，可直接指向对应目录（需包含 clip-vision.onnx、clip-text.onnx、tokenizer.json）。
            模型下载后可完全离线使用。
          </p>
        </div>

        <div className="h-px bg-[#222] mb-5" />

        {/* FFmpeg Section */}
        <div>
          <h4 className="text-xs font-medium text-[#ccc] mb-3 flex items-center gap-2">
            <Video size={13} className="text-[#3b82f6]" />
            FFmpeg 视频处理
          </h4>

          <div className={`flex items-center gap-3 p-3 rounded-lg mb-3 ${
            status?.installed ? 'bg-[#22c55e]/10' : 'bg-[#f59e0b]/10'
          }`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-none ${
              status?.installed ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#f59e0b]/20 text-[#f59e0b]'
            }`}>
              {status?.installed ? <Check size={14} /> : <AlertTriangle size={14} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[#ccc]">
                {status?.installed ? '已安装' : '未安装'}
              </div>
              {status?.version && <div className="text-[10px] text-[#666] truncate">{status.version}</div>}
              {status?.path && <div className="text-[10px] text-[#555] truncate">{status.path}</div>}
            </div>
          </div>

          <p className="text-[10px] text-[#555] leading-relaxed mb-3">
            用于生成视频缩略图。安装后自动支持 MP4、MOV、AVI、MKV 等格式。
          </p>

          {downloading && progress && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <Loader2 size={12} className="animate-spin text-[#3b82f6]" />
                <span className="text-[11px] text-[#aaa]">{progress.message}</span>
              </div>
              <div className="h-1.5 bg-[#222] rounded-full overflow-hidden">
                <div className="h-full bg-[#3b82f6] rounded-full transition-all" style={{ width: `${progress.progress * 100}%` }} />
              </div>
            </div>
          )}

          {!status?.installed && !downloading && (
            <button
              onClick={handleInstall}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#2563eb] text-white text-xs rounded-lg hover:bg-[#1d4ed8] transition-colors"
            >
              <Download size={14} />
              自动下载安装 FFmpeg
            </button>
          )}
        </div>
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
  colMinWidth: number;
}

const VirtualGrid: React.FC<VirtualGridProps> = ({ assets, containerRef, onClickAsset, onDoubleClickAsset, onContextMenu, selectedIds, onBoxSelect, assetTagsMap, assetRatingsMap, lockedPaths, colMinWidth }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(600);

  // Hover preview state
  const [hoverAsset, setHoverAsset] = useState<AssetEntry | null>(null);
  const [hoverRect, setHoverRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHoverAsset(null);
    setHoverRect(null);
  }, []);

  // Reset scroll state when assets change (e.g. folder switch)
  const prevAssetsRef = useRef(assets);
  useEffect(() => {
    if (prevAssetsRef.current !== assets) {
      prevAssetsRef.current = assets;
      setScrollTop(0);
      clearHover();
    }
  }, [assets, clearHover]);

  // Box select state
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);
  const boxSelectRef = useRef(false);

  const colMinW = colMinWidth;
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
      // 有缩略图用缩略图；无缩略图时图片类型用原图路径回退，避免部分图片不显示
      const thumbUrl = asset.thumb_path
        ? convertFileSrc(asset.thumb_path)
        : (IMAGE_EXTS.has(asset.file_ext) ? convertFileSrc(asset.file_path) : '');
      const hasThumbnail = !!thumbUrl;
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
          onMouseEnter={(e) => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = setTimeout(() => {
              const el = e.currentTarget as HTMLElement;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              setHoverAsset(asset);
              setHoverRect({ x: rect.right, y: rect.top, w: rect.width, h: rect.height });
            }, 350);
          }}
          onMouseLeave={() => clearHover()}
        >
          {/* Thumbnail - variable height */}
          <div
            className={'w-full rounded-lg overflow-hidden bg-[#1a1a1a] border transition-colors relative ' +
              (isSelected ? 'border-[#3b82f6]' : 'border-[#2a2a2a] group-hover:border-[#3b82f6]')}
            style={{ height: li.thumbH }}
          >
            {hasThumbnail ? (
              <SkeletonImage
                src={thumbUrl}
                alt={asset.file_name}
                className="w-full h-full"
                imgClassName="w-full h-full object-cover"
                fadeDuration={250}
                fallback={<div className="flex flex-col items-center text-[#555]"><Icon size={32} /><span className="text-xs mt-1 uppercase">{asset.file_ext}</span></div>}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-[#555]">
                <Icon size={32} />
                <span className="text-xs mt-1 uppercase">{asset.file_ext}</span>
              </div>
            )}
            {/* Video play overlay */}
            {VIDEO_EXTS.has(asset.file_ext) && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
                  <div className="w-0 h-0 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent border-l-[12px] border-l-white ml-1" />
                </div>
              </div>
            )}
            {/* 3D model overlay */}
            {MESH_EXTS.has(asset.file_ext) && !hasThumbnail && (
              <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-black/50 rounded px-1.5 py-0.5 backdrop-blur-sm">
                <Box size={10} className="text-[#a78bfa]" />
                <span className="text-[9px] text-[#a78bfa] font-medium">3D</span>
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

  // Hover preview content
  const hoverPreviewEl = useMemo(() => {
    if (!hoverAsset || !hoverRect) return null;
    const ext = hoverAsset.file_ext;
    const isImage = IMAGE_EXTS.has(ext);
    const isGif = ext === 'gif';
    const isVideo = VIDEO_EXTS.has(ext);
    const previewW = 320;
    const previewH = hoverAsset.height > 0 && hoverAsset.width > 0
      ? Math.min(400, Math.round(previewW * hoverAsset.height / hoverAsset.width))
      : 240;
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    let left = hoverRect.x + 8;
    let top = hoverRect.y;
    if (left + previewW > winW - 20) left = hoverRect.x - hoverRect.w - previewW - 8;
    if (top + previewH > winH - 20) top = winH - previewH - 20;
    if (top < 10) top = 10;

    const fileSrc = convertFileSrc(hoverAsset.file_path);
    const thumbSrc = hoverAsset.thumb_path ? convertFileSrc(hoverAsset.thumb_path) : (IMAGE_EXTS.has(hoverAsset.file_ext) ? fileSrc : '');
    const displaySrc = (isGif || isImage) ? fileSrc : thumbSrc;

    return (
      <div
        className="fixed z-[70] pointer-events-none rounded-xl overflow-hidden shadow-2xl border border-[#333] bg-[#111]"
        style={{ left, top, width: previewW }}
      >
        {isVideo ? (
          <video
            src={fileSrc}
            autoPlay
            muted
            loop
            playsInline
            className="w-full rounded-t-xl bg-black"
            style={{ maxHeight: 400 }}
          />
        ) : displaySrc ? (
          <img
            src={displaySrc}
            alt=""
            className="w-full object-contain bg-[#0a0a0a]"
            style={{ maxHeight: 400 }}
            draggable={false}
          />
        ) : null}
        <div className="px-3 py-2 bg-[#111]">
          <div className="text-[11px] text-[#ccc] truncate">{hoverAsset.file_name}</div>
          <div className="text-[10px] text-[#666] flex gap-2">
            {hoverAsset.width > 0 && <span>{hoverAsset.width}×{hoverAsset.height}</span>}
            <span>{formatFileSize(hoverAsset.file_size)}</span>
            <span className="uppercase" style={{ color: getExtColor(ext) }}>{ext}</span>
          </div>
        </div>
      </div>
    );
  }, [hoverAsset, hoverRect]);

  return (
    <div
      className="relative"
      style={{ height: totalHeight, minHeight: '100%' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={(e) => { handleMouseUp(); clearHover(); }}
    >
      {visibleItems}
      {boxRect && boxRect.width > 5 && boxRect.height > 5 && (
        <div
          className="absolute pointer-events-none border border-[#3b82f6] bg-[#3b82f6]/10 rounded z-30"
          style={boxRect}
        />
      )}
      {hoverPreviewEl}
    </div>
  );
};

// ============================================================
// List View (Eagle-style table)
// ============================================================

const LIST_ROW_HEIGHT = 36;
const LIST_THUMB_SIZE = 28;
const LIST_BUFFER = 400;

interface ListViewProps {
  assets: AssetEntry[];
  containerRef: React.RefObject<HTMLDivElement>;
  onClickAsset: (asset: AssetEntry, index: number) => void;
  onDoubleClickAsset: (asset: AssetEntry, index: number) => void;
  onContextMenu: (asset: AssetEntry, index: number, e: React.MouseEvent) => void;
  selectedIds: Set<number>;
  assetTagsMap: Map<number, TagInfo[]>;
  assetRatingsMap: Map<number, number>;
}

const ListView: React.FC<ListViewProps> = ({
  assets, containerRef, onClickAsset, onDoubleClickAsset, onContextMenu, selectedIds, assetTagsMap, assetRatingsMap,
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef]);

  const totalHeight = assets.length * LIST_ROW_HEIGHT;
  const viewTop = scrollTop - LIST_BUFFER;
  const viewBottom = scrollTop + containerHeight + LIST_BUFFER;
  const startIdx = Math.max(0, Math.floor(viewTop / LIST_ROW_HEIGHT));
  const endIdx = Math.min(assets.length - 1, Math.ceil(viewBottom / LIST_ROW_HEIGHT));

  const rows: React.ReactNode[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const a = assets[i];
    const isSelected = selectedIds.has(a.id);
    const thumbUrl = a.thumb_path ? convertFileSrc(a.thumb_path) : (IMAGE_EXTS.has(a.file_ext) ? convertFileSrc(a.file_path) : '');
    const Icon = getFileIcon(a.file_ext);
    const tags = assetTagsMap.get(a.id) || [];
    const rating = assetRatingsMap.get(a.id) || 0;

    rows.push(
      <div
        key={a.id}
        className={`absolute left-0 right-0 flex items-center gap-3 px-3 text-xs border-b border-[#1a1a1a] cursor-pointer transition-colors ${
          isSelected ? 'bg-[#1a2332] text-white' : 'text-[#ccc] hover:bg-[#111]'
        }`}
        style={{ top: i * LIST_ROW_HEIGHT, height: LIST_ROW_HEIGHT }}
        onClick={() => onClickAsset(a, i)}
        onDoubleClick={() => onDoubleClickAsset(a, i)}
        onContextMenu={e => onContextMenu(a, i, e)}
      >
        {/* Thumbnail */}
        <div className="flex-none w-7 h-7 rounded overflow-hidden bg-[#1a1a1a]">
          {thumbUrl ? (
            <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#555]"><Icon size={14} /></div>
          )}
        </div>
        {/* Name */}
        <span className="flex-1 min-w-0 truncate">{a.file_name}</span>
        {/* Tags */}
        <div className="flex-none flex gap-0.5 max-w-[120px] overflow-hidden">
          {tags.slice(0, 2).map(t => (
            <span key={t.id} className="text-[9px] px-1 py-0.5 rounded-full" style={{ background: t.color + '22', color: t.color }}>{t.name}</span>
          ))}
        </div>
        {/* Rating */}
        <div className="flex-none w-16 flex">
          {rating > 0 && Array.from({ length: rating }, (_, j) => (
            <Star key={j} size={9} className="text-yellow-400 fill-yellow-400" />
          ))}
        </div>
        {/* Ext */}
        <span className="flex-none w-10 text-[10px] uppercase text-center" style={{ color: getExtColor(a.file_ext) }}>{a.file_ext}</span>
        {/* Size */}
        <span className="flex-none w-16 text-right text-[10px] text-[#666]">{formatFileSize(a.file_size)}</span>
        {/* Dimensions */}
        <span className="flex-none w-20 text-right text-[10px] text-[#555]">
          {a.width > 0 ? `${a.width}×${a.height}` : ''}
        </span>
        {/* Date */}
        <span className="flex-none w-20 text-right text-[10px] text-[#555]">{formatDate(a.modified_at)}</span>
      </div>
    );
  }

  return (
    <div className="relative" style={{ height: totalHeight, minHeight: '100%' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-3 h-8 bg-[#0d0d0d] border-b border-[#222] text-[10px] text-[#666] uppercase tracking-wider font-medium">
        <span className="flex-none w-7" />
        <span className="flex-1">名称</span>
        <span className="flex-none w-[120px]">标签</span>
        <span className="flex-none w-16">评分</span>
        <span className="flex-none w-10 text-center">格式</span>
        <span className="flex-none w-16 text-right">大小</span>
        <span className="flex-none w-20 text-right">尺寸</span>
        <span className="flex-none w-20 text-right">日期</span>
      </div>
      {rows}
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
// Batch Rename Modal
// ============================================================

interface BatchRenameProps {
  assets: AssetEntry[];
  onRename: (renames: [number, string][]) => void;
  onClose: () => void;
}

const BatchRenameModal: React.FC<BatchRenameProps> = ({ assets, onRename, onClose }) => {
  const [mode, setMode] = useState<'pattern' | 'replace'>('pattern');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [startNum, setStartNum] = useState(1);
  const [digits, setDigits] = useState(3);
  const [baseName, setBaseName] = useState('');
  const [findStr, setFindStr] = useState('');
  const [replaceStr, setReplaceStr] = useState('');

  const preview = useMemo(() => {
    return assets.map((a, i) => {
      const ext = a.file_ext ? `.${a.file_ext}` : '';
      const stem = a.file_name.replace(/\.[^.]+$/, '');
      let newName: string;
      if (mode === 'pattern') {
        const num = String(startNum + i).padStart(digits, '0');
        const base = baseName || stem;
        newName = `${prefix}${base}${suffix}_${num}${ext}`;
      } else {
        if (!findStr) {
          newName = a.file_name;
        } else {
          const newStem = stem.split(findStr).join(replaceStr);
          newName = `${newStem}${ext}`;
        }
      }
      return { id: a.id, oldName: a.file_name, newName };
    });
  }, [assets, mode, prefix, suffix, startNum, digits, baseName, findStr, replaceStr]);

  const hasChanges = preview.some(p => p.oldName !== p.newName);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#222]">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Edit3 size={16} className="text-[#3b82f6]" />
            批量重命名 ({assets.length} 个文件)
          </h3>
          <button onClick={onClose} className="text-[#555] hover:text-[#aaa]"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <div className="flex gap-2">
            <button
              onClick={() => setMode('pattern')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${mode === 'pattern' ? 'bg-[#2563eb] text-white' : 'bg-[#222] text-[#888] hover:text-[#ccc]'}`}
            >
              模式命名
            </button>
            <button
              onClick={() => setMode('replace')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${mode === 'replace' ? 'bg-[#2563eb] text-white' : 'bg-[#222] text-[#888] hover:text-[#ccc]'}`}
            >
              查找替换
            </button>
          </div>

          {mode === 'pattern' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-[#888] mb-1">前缀</label>
                <input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="例如: hero_"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#888] mb-1">后缀</label>
                <input value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="例如: _final"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#888] mb-1">基础名称 (留空保持原名)</label>
                <input value={baseName} onChange={e => setBaseName(e.target.value)} placeholder="留空保持原名"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-[#888] mb-1">起始序号</label>
                  <input type="number" value={startNum} onChange={e => setStartNum(+e.target.value)} min={0}
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] outline-none focus:border-[#3b82f6]" />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-[#888] mb-1">位数</label>
                  <input type="number" value={digits} onChange={e => setDigits(+e.target.value)} min={1} max={6}
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] outline-none focus:border-[#3b82f6]" />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-[#888] mb-1">查找</label>
                <input value={findStr} onChange={e => setFindStr(e.target.value)} placeholder="要替换的文本"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#888] mb-1">替换为</label>
                <input value={replaceStr} onChange={e => setReplaceStr(e.target.value)} placeholder="新文本"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none focus:border-[#3b82f6]" />
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] text-[#888] mb-2 uppercase tracking-wider">预览 (前10个)</div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {preview.slice(0, 10).map(p => (
                <div key={p.id} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-[#111]">
                  <span className="text-[#666] truncate flex-1">{p.oldName}</span>
                  <ArrowRight size={10} className="text-[#555] flex-none" />
                  <span className={`truncate flex-1 ${p.oldName !== p.newName ? 'text-[#22c55e]' : 'text-[#555]'}`}>{p.newName}</span>
                </div>
              ))}
              {preview.length > 10 && <div className="text-[10px] text-[#555] text-center py-1">...还有 {preview.length - 10} 个</div>}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#222]">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[#888] hover:text-[#ccc] rounded-lg">取消</button>
          <button
            onClick={() => onRename(preview.filter(p => p.oldName !== p.newName).map(p => [p.id, p.newName]))}
            disabled={!hasChanges}
            className="px-4 py-1.5 text-xs bg-[#2563eb] text-white rounded-lg hover:bg-[#1d4ed8] disabled:opacity-40 transition-colors"
          >
            执行重命名
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Spotlight Quick Search
// ============================================================

const SpotlightSearch: React.FC<{
  onSelect: (asset: AssetEntry) => void;
  onClose: () => void;
}> = ({ onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AssetEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const r = await invoke<QueryResult>('asset_query', {
          params: {
            folder_id: null, search: query.trim(), extensions: null,
            min_width: null, max_width: null, tag_ids: null, min_rating: null,
            favorite_only: null, sort_by: 'modified', sort_order: 'desc',
            page: 1, page_size: 20,
          },
        });
        setResults(r.assets);
        setSelectedIdx(0);
      } catch { setResults([]); }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) onSelect(results[selectedIdx]);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="w-[520px] bg-[#1a1a1a] border border-[#333] rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#222]">
          <Search size={18} className="text-[#555] flex-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="快速搜索资源..."
            className="flex-1 bg-transparent text-sm text-[#eee] placeholder-[#555] outline-none"
          />
          <kbd className="text-[10px] text-[#555] bg-[#222] rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        {results.length > 0 && (
          <div className="max-h-80 overflow-y-auto py-1">
            {results.map((a, i) => {
              const thumbUrl = a.thumb_path ? convertFileSrc(a.thumb_path) : (IMAGE_EXTS.has(a.file_ext) ? convertFileSrc(a.file_path) : '');
              const Icon = getFileIcon(a.file_ext);
              return (
                <div
                  key={a.id}
                  className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${i === selectedIdx ? 'bg-[#2563eb]/20' : 'hover:bg-[#222]'}`}
                  onClick={() => onSelect(a)}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <div className="w-8 h-8 rounded overflow-hidden bg-[#111] flex-none">
                    {thumbUrl ? <img src={thumbUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[#555]"><Icon size={16} /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#ccc] truncate">{a.file_name}</div>
                    <div className="text-[10px] text-[#555]">{formatFileSize(a.file_size)} · <span className="uppercase" style={{ color: getExtColor(a.file_ext) }}>{a.file_ext}</span></div>
                  </div>
                  {a.width > 0 && <span className="text-[10px] text-[#555] flex-none">{a.width}×{a.height}</span>}
                </div>
              );
            })}
          </div>
        )}
        {query && results.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-[#555]">未找到匹配的资源</div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Duplicate Finder Modal
// ============================================================

const DuplicateFinderModal: React.FC<{
  onClose: () => void;
  onSelectAsset: (id: number) => void;
}> = ({ onClose, onSelectAsset }) => {
  const [groups, setGroups] = useState<{ md5: string; ids: number[]; assets: AssetEntry[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await invoke('asset_index_hashes');
        const dupes = await invoke<[string, number[]][]>('asset_find_duplicates');
        const allGroups: { md5: string; ids: number[]; assets: AssetEntry[] }[] = [];
        for (const [md5, ids] of dupes) {
          const r = await invoke<QueryResult>('asset_query', {
            params: { folder_id: null, search: null, extensions: null, min_width: null, max_width: null,
              tag_ids: null, min_rating: null, favorite_only: null, sort_by: 'name', sort_order: 'asc',
              page: 1, page_size: 500 },
          });
          const matched = r.assets.filter(a => ids.includes(a.id));
          if (matched.length > 1) allGroups.push({ md5, ids, assets: matched });
        }
        setGroups(allGroups);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#222]">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Copy size={16} className="text-[#f97316]" />
            重复文件检测
          </h3>
          <button onClick={onClose} className="text-[#555] hover:text-[#aaa]"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-xs text-[#888]">
              <Loader2 size={16} className="animate-spin" /> 正在计算文件哈希...
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#666]">没有检测到重复文件</div>
          ) : (
            <div className="space-y-4">
              {groups.map((g, i) => (
                <div key={g.md5} className="bg-[#111] rounded-lg p-3">
                  <div className="text-[10px] text-[#555] mb-2">重复组 {i + 1} · MD5: {g.md5.slice(0, 12)}... · {g.assets.length} 个文件</div>
                  <div className="space-y-1">
                    {g.assets.map(a => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#1a1a1a] cursor-pointer text-xs"
                        onClick={() => onSelectAsset(a.id)}
                      >
                        <div className="w-6 h-6 rounded overflow-hidden bg-[#1a1a1a] flex-none">
                          {(a.thumb_path || IMAGE_EXTS.has(a.file_ext)) ? <img src={a.thumb_path ? convertFileSrc(a.thumb_path) : convertFileSrc(a.file_path)} alt="" className="w-full h-full object-cover" /> : null}
                        </div>
                        <span className="flex-1 text-[#ccc] truncate">{a.file_name}</span>
                        <span className="text-[10px] text-[#555]">{formatFileSize(a.file_size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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

// ============================================================
// Annotation Canvas Component
// ============================================================

type AnnotationTool = 'arrow' | 'rect' | 'ellipse' | 'freehand' | 'text';
interface AnnotationItem {
  type: AnnotationTool;
  color: string;
  lineWidth: number;
  points?: { x: number; y: number }[];
  x?: number; y?: number; w?: number; h?: number;
  x2?: number; y2?: number;
  text?: string;
  fontSize?: number;
}

const ANNOTATION_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#000000'];

const AnnotationCanvas: React.FC<{
  assetId: number;
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  onClose: () => void;
}> = ({ assetId, imageSrc, imageWidth, imageHeight, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<AnnotationTool>('arrow');
  const [color, setColor] = useState('#ef4444');
  const [lineWidth, setLineWidth] = useState(3);
  const [items, setItems] = useState<AnnotationItem[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [current, setCurrent] = useState<AnnotationItem | null>(null);
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const maxW = Math.min(imageWidth, window.innerWidth * 0.85);
  const scale = maxW / imageWidth;
  const dispW = Math.round(imageWidth * scale);
  const dispH = Math.round(imageHeight * scale);

  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => { imgRef.current = img; setImgLoaded(true); };
  }, [imageSrc]);

  useEffect(() => {
    invoke<string>('asset_get_annotation', { assetId })
      .then(data => {
        try { const parsed = JSON.parse(data); if (Array.isArray(parsed)) setItems(parsed); } catch {}
      })
      .catch(() => {});
  }, [assetId]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imgRef.current;
    if (!canvas || !ctx || !img) return;
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(img, 0, 0, dispW, dispH);
    const allItems = current ? [...items, current] : items;
    for (const item of allItems) {
      ctx.strokeStyle = item.color;
      ctx.fillStyle = item.color;
      ctx.lineWidth = item.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (item.type === 'arrow' && item.x != null && item.y != null && item.x2 != null && item.y2 != null) {
        const dx = item.x2 - item.x, dy = item.y2 - item.y;
        const angle = Math.atan2(dy, dx);
        const headLen = 16;
        ctx.beginPath();
        ctx.moveTo(item.x, item.y);
        ctx.lineTo(item.x2, item.y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(item.x2, item.y2);
        ctx.lineTo(item.x2 - headLen * Math.cos(angle - Math.PI / 6), item.y2 - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(item.x2 - headLen * Math.cos(angle + Math.PI / 6), item.y2 - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      } else if (item.type === 'rect' && item.x != null && item.y != null && item.w != null && item.h != null) {
        ctx.strokeRect(item.x, item.y, item.w, item.h);
      } else if (item.type === 'ellipse' && item.x != null && item.y != null && item.w != null && item.h != null) {
        ctx.beginPath();
        ctx.ellipse(item.x + item.w / 2, item.y + item.h / 2, Math.abs(item.w / 2), Math.abs(item.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (item.type === 'freehand' && item.points && item.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(item.points[0].x, item.points[0].y);
        for (let i = 1; i < item.points.length; i++) ctx.lineTo(item.points[i].x, item.points[i].y);
        ctx.stroke();
      } else if (item.type === 'text' && item.x != null && item.y != null && item.text) {
        ctx.font = `${item.fontSize || 20}px sans-serif`;
        ctx.fillText(item.text, item.x, item.y);
      }
    }
  }, [items, current, dispW, dispH]);

  useEffect(() => { if (imgLoaded) redraw(); }, [imgLoaded, redraw]);

  const getPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (tool === 'text') {
      setTextInput(getPos(e));
      setTextValue('');
      return;
    }
    setDrawing(true);
    const pos = getPos(e);
    if (tool === 'freehand') {
      setCurrent({ type: 'freehand', color, lineWidth, points: [pos] });
    } else if (tool === 'arrow') {
      setCurrent({ type: 'arrow', color, lineWidth, x: pos.x, y: pos.y, x2: pos.x, y2: pos.y });
    } else {
      setCurrent({ type: tool, color, lineWidth, x: pos.x, y: pos.y, w: 0, h: 0 });
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !current) return;
    const pos = getPos(e);
    if (current.type === 'freehand') {
      setCurrent({ ...current, points: [...(current.points || []), pos] });
    } else if (current.type === 'arrow') {
      setCurrent({ ...current, x2: pos.x, y2: pos.y });
    } else {
      setCurrent({ ...current, w: pos.x - (current.x || 0), h: pos.y - (current.y || 0) });
    }
  };

  const onMouseUp = () => {
    if (!drawing || !current) return;
    setDrawing(false);
    setItems(prev => [...prev, current]);
    setCurrent(null);
  };

  const commitText = () => {
    if (textInput && textValue.trim()) {
      setItems(prev => [...prev, { type: 'text', color, lineWidth, x: textInput.x, y: textInput.y, text: textValue.trim(), fontSize: 20 }]);
    }
    setTextInput(null);
    setTextValue('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('asset_save_annotation', { assetId, data: JSON.stringify(items) });
    } catch (e) { console.error('Save annotation failed', e); }
    setSaving(false);
  };

  const handleUndo = () => setItems(prev => prev.slice(0, -1));
  const handleClear = () => setItems([]);

  const tools: { id: AnnotationTool; label: string; icon: string }[] = [
    { id: 'arrow', label: '箭头', icon: '↗' },
    { id: 'rect', label: '矩形', icon: '□' },
    { id: 'ellipse', label: '椭圆', icon: '○' },
    { id: 'freehand', label: '画笔', icon: '✎' },
    { id: 'text', label: '文字', icon: 'A' },
  ];

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-3 bg-[#1e1e1e] rounded-xl px-4 py-2 shadow-lg">
        {tools.map(t => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors ${tool === t.id ? 'bg-blue-500 text-white' : 'bg-[#333] text-[#aaa] hover:bg-[#444]'}`}
            title={t.label}
          >{t.icon}</button>
        ))}
        <div className="w-px h-6 bg-[#444] mx-1" />
        {ANNOTATION_COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-125' : 'border-transparent'}`}
            style={{ background: c }}
          />
        ))}
        <div className="w-px h-6 bg-[#444] mx-1" />
        <input type="range" min={1} max={10} value={lineWidth} onChange={e => setLineWidth(+e.target.value)} className="w-20 accent-blue-500" title={`线宽: ${lineWidth}px`} />
        <div className="w-px h-6 bg-[#444] mx-1" />
        <button onClick={handleUndo} disabled={items.length === 0} className="px-3 py-1 rounded text-xs bg-[#333] text-[#aaa] hover:bg-[#444] disabled:opacity-30">撤销</button>
        <button onClick={handleClear} disabled={items.length === 0} className="px-3 py-1 rounded text-xs bg-[#333] text-[#aaa] hover:bg-[#444] disabled:opacity-30">清空</button>
        <button onClick={handleSave} disabled={saving} className="px-3 py-1 rounded text-xs bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
        <button onClick={onClose} className="px-3 py-1 rounded text-xs bg-[#333] text-[#aaa] hover:bg-[#444]">关闭</button>
      </div>

      {/* Canvas */}
      <div className="relative" style={{ width: dispW, height: dispH }}>
        <canvas
          ref={canvasRef}
          width={dispW}
          height={dispH}
          className="rounded-lg cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
        {textInput && (
          <input
            type="text"
            autoFocus
            value={textValue}
            onChange={e => setTextValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextInput(null); }}
            onBlur={commitText}
            className="absolute bg-transparent border border-blue-400 text-white px-1 outline-none"
            style={{ left: textInput.x, top: textInput.y - 24, fontSize: 20, fontFamily: 'sans-serif', color }}
          />
        )}
      </div>
    </div>
  );
};

const FONT_SAMPLE_SIZES = [72, 48, 36, 24, 18, 14, 12];
const FONT_SAMPLE_TEXT_EN = 'The quick brown fox jumps over the lazy dog';
const FONT_SAMPLE_TEXT_CN = '天地玄黄宇宙洪荒 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !@#$%^&*()';

const FontPreview: React.FC<{ fontPath: string; fontName: string }> = ({ fontPath, fontName }) => {
  const [fontLoaded, setFontLoaded] = useState(false);
  const [customText, setCustomText] = useState('');
  const fontFamily = useRef(`preview-font-${Date.now()}`);

  useEffect(() => {
    const src = convertFileSrc(fontPath);
    const face = new FontFace(fontFamily.current, `url("${src}")`);
    face.load().then(loaded => {
      document.fonts.add(loaded);
      setFontLoaded(true);
    }).catch(() => setFontLoaded(false));
    return () => { document.fonts.delete(face); };
  }, [fontPath]);

  if (!fontLoaded) {
    return (
      <div className="flex flex-col items-center justify-center text-[#666] gap-3 p-12">
        <Loader2 size={48} className="animate-spin text-blue-400" />
        <span>加载字体中…</span>
      </div>
    );
  }

  return (
    <div
      className="bg-[#1a1a1a] rounded-xl p-8 max-w-[85vw] max-h-[80vh] overflow-y-auto w-[800px]"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 mb-6 border-b border-[#333] pb-4">
        <Type size={28} className="text-blue-400" />
        <span className="text-white text-xl font-semibold">{fontName}</span>
      </div>

      <div className="mb-6">
        <input
          type="text"
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          placeholder="输入自定义预览文本…"
          className="w-full bg-[#252525] border border-[#444] rounded-lg px-4 py-2 text-white placeholder:text-[#666] focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="space-y-6">
        {FONT_SAMPLE_SIZES.map(size => (
          <div key={size} className="border-b border-[#282828] pb-4 last:border-0">
            <div className="text-[#666] text-xs mb-2">{size}px</div>
            <div
              style={{ fontFamily: fontFamily.current, fontSize: `${size}px`, lineHeight: 1.4 }}
              className="text-white break-words"
            >
              {customText || FONT_SAMPLE_TEXT_EN}
            </div>
          </div>
        ))}
      </div>

      {!customText && (
        <div className="mt-8 pt-6 border-t border-[#333]">
          <div className="text-[#888] text-sm mb-3">字符集预览</div>
          <div
            style={{ fontFamily: fontFamily.current, fontSize: '20px', lineHeight: 1.8 }}
            className="text-[#ccc] break-words"
          >
            {FONT_SAMPLE_TEXT_CN}
          </div>
        </div>
      )}
    </div>
  );
};

const PreviewModal: React.FC<PreviewProps> = ({ asset, assets, currentIndex, onClose, onNavigate }) => {
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const [annotating, setAnnotating] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setAnnotating(false);
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
  const isAudio = AUDIO_EXTS.has(asset.file_ext);
  const is3D = MESH_EXTS.has(asset.file_ext);
  const isFont = FONT_EXTS.has(asset.file_ext);

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
      <div
        className="max-w-[90vw] max-h-[85vh] flex items-center justify-center overflow-hidden"
        onClick={e => e.stopPropagation()}
        onWheel={e => {
          if (canPreviewImage) {
            e.stopPropagation();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom(z => Math.max(0.1, Math.min(10, z * delta)));
          }
        }}
        onMouseDown={e => {
          if (canPreviewImage && zoom > 1 && e.button === 0) {
            setIsPanning(true);
            panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
          }
        }}
        onMouseMove={e => {
          if (isPanning) {
            setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
          }
        }}
        onMouseUp={() => setIsPanning(false)}
        onMouseLeave={() => setIsPanning(false)}
        onDoubleClick={e => {
          if (canPreviewImage) {
            e.stopPropagation();
            if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); }
            else setZoom(3);
          }
        }}
        style={{ cursor: canPreviewImage ? (zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in') : 'default' }}
      >
        {canPreviewImage ? (
          <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: isPanning ? 'none' : 'transform 0.15s ease', transformOrigin: 'center' }}>
          <SkeletonImage
            src={previewSrc}
            alt={asset.file_name}
            className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
            imgClassName="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            skeletonClassName="min-w-[256px] min-h-[256px]"
            fadeDuration={300}
            draggable={false}
            loading="eager"
            onLoad={() => setLoaded(true)}
            fallback={<div className="flex flex-col items-center justify-center text-[#666] gap-3 p-12">{React.createElement(getFileIcon(asset.file_ext), { size: 64 })}<span className="text-lg">图片加载失败</span></div>}
          />
          </div>
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
            <React.Suspense fallback={<SkeletonPreview className="w-full h-full" />}>
              <LazyModelViewer3D filePath={asset.file_path} fileExt={asset.file_ext} fileName={asset.file_name} />
            </React.Suspense>
          </div>
        ) : isFont ? (
          <FontPreview fontPath={asset.file_path} fontName={asset.file_name} />
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
        {zoom !== 1 && (
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="text-[#3b82f6] hover:text-[#60a5fa] text-xs">
            {Math.round(zoom * 100)}% · 重置
          </button>
        )}
        {canPreviewImage && (
          <button
            onClick={() => setAnnotating(!annotating)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${annotating ? 'bg-blue-500 text-white' : 'bg-[#333] text-[#aaa] hover:bg-[#444] hover:text-white'}`}
          >
            <Edit3 size={14} className="inline mr-1" />标注
          </button>
        )}
        <span className="ml-auto text-[#666]">{currentIndex + 1} / {assets.length}</span>
      </div>

      {annotating && canPreviewImage && asset && (
        <AnnotationCanvas
          assetId={asset.id}
          imageSrc={previewSrc}
          imageWidth={asset.width || 800}
          imageHeight={asset.height || 600}
          onClose={() => setAnnotating(false)}
        />
      )}
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
  { value: 'random', label: '随机打乱' },
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

  // Grid size — continuous zoom (min col width in px, 100–400)
  const [thumbScale, setThumbScale] = useState<number>(() => {
    const saved = localStorage.getItem('arthub_asset_thumb_scale');
    return saved ? Math.max(100, Math.min(400, parseInt(saved, 10))) : 180;
  });
  useEffect(() => { localStorage.setItem('arthub_asset_thumb_scale', String(thumbScale)); }, [thumbScale]);

  // View mode: masonry (waterfall) | list
  type ViewMode = 'masonry' | 'list';
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('arthub_asset_view_mode') as ViewMode) || 'masonry';
  });
  useEffect(() => { localStorage.setItem('arthub_asset_view_mode', viewMode); }, [viewMode]);

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
  const heartbeatTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // ---- Phase 4: FFmpeg State ----
  const [showFfmpegSettings, setShowFfmpegSettings] = useState(false);

  // ---- Compare Panel State ----
  const [showComparePanel, setShowComparePanel] = useState(false);
  const [showMultiVideo, setShowMultiVideo] = useState(false);
  const [showBatchRename, setShowBatchRename] = useState(false);
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  // ---- Favorites State ----
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [filterMinRating, setFilterMinRating] = useState(0);

  // ---- Color Search State ----
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [colorFilterIds, setColorFilterIds] = useState<Set<number> | null>(null);

  // ---- AI Semantic Search State ----
  const [aiMode, setAiMode] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDownloading, setAiDownloading] = useState(false);
  const [aiDownloadProgress, setAiDownloadProgress] = useState('');
  const [aiIndexing, setAiIndexing] = useState(false);
  const [aiStats, setAiStats] = useState<{ indexed: number; total: number; progress: number } | null>(null);
  const [aiResults, setAiResults] = useState<Map<number, number> | null>(null); // asset_id → score

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

  // AI model check on mount
  useEffect(() => {
    (async () => {
      try {
        const status = await invoke<{ all_ready: boolean; loaded: boolean }>('ai_check_model');
        setAiReady(status.all_ready);
        if (status.all_ready) {
          const stats = await invoke<{ indexed: number; total: number; progress: number }>('ai_embedding_stats');
          setAiStats(stats);
        }
      } catch {}
    })();
  }, []);

  const handleAiSetup = useCallback(async () => {
    try {
      const status = await invoke<{ all_ready: boolean; loaded: boolean }>('ai_check_model');
      if (!status.all_ready) {
        // If user has set a local storage directory, auto-set AI models dir there
        try {
          const dirInfo = await invoke<{ is_custom: boolean }>('ai_get_models_dir');
          if (!dirInfo.is_custom) {
            const storagePath = await getSavedStoragePath();
            if (storagePath) {
              const aiDir = storagePath.replace(/[\\/]$/, '') + (storagePath.includes('\\') ? '\\ai_models' : '/ai_models');
              await invoke('ai_set_models_dir', { path: aiDir });
            }
          }
        } catch { /* ignore - use current dir */ }

        setAiDownloading(true);
        setAiDownloadProgress('准备下载…');
        const unlisten = await listen<{ file: string; downloaded: number; total: number }>('ai-download-progress', (event) => {
          const { file, downloaded, total } = event.payload;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            const dlMB = (downloaded / 1048576).toFixed(1);
            const totalMB = (total / 1048576).toFixed(1);
            setAiDownloadProgress(`${file} ${dlMB}/${totalMB} MB (${pct}%)`);
          }
        });
        try {
          await invoke('ai_download_model');
        } finally {
          unlisten();
        }
        setAiDownloading(false);
        setAiDownloadProgress('');
      }
      setAiLoading(true);
      await invoke('ai_load_model');
      setAiReady(true);
      setAiLoading(false);
      setAiMode(true);
      handleAiIndex();
    } catch (e) {
      console.error('AI setup failed', e);
      setAiDownloading(false);
      setAiLoading(false);
    }
  }, []);

  const aiIndexingRef = useRef(false);
  const handleAiIndex = useCallback(async () => {
    if (aiIndexingRef.current) {
      consoleService.addLog('warn', ['[AI 索引] 索引任务已在进行中，忽略重复调用']);
      return;
    }
    aiIndexingRef.current = true;
    setAiIndexing(true);
    const startTime = Date.now();
    let batchCount = 0;
    let totalProcessed = 0;
    let totalFailed = 0;
    
    // 记录开始时的内存状态
    const memoryBefore = (performance as any).memory ? {
      used: Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round((performance as any).memory.totalJSHeapSize / 1024 / 1024),
      limit: Math.round((performance as any).memory.jsHeapSizeLimit / 1024 / 1024)
    } : null;
    
    try {
      consoleService.addLog('info', [
        '[AI 索引] 开始索引任务',
        memoryBefore ? `初始内存: ${memoryBefore.used}MB / ${memoryBefore.limit}MB` : ''
      ]);
      
      let hasMore = true;
      let consecutiveEmptyBatches = 0;
      let consecutiveAllFailedBatches = 0;
      const maxEmptyBatches = 3; // 如果连续3批都是空的，停止
      const maxAllFailedBatches = 5; // 如果连续5批全部失败，停止（可能是文件问题）
      let lastTotalIndexed = 0;
      
      while (hasMore) {
        const batchStartTime = Date.now();
        batchCount++;
        
        try {
          // 记录调用前的状态
          const memoryBeforeCall = (performance as any).memory ? {
            used: Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024)
          } : null;
          
          const result = await invoke<{ batch_indexed: number; batch_failed: number; total_indexed: number; total_images: number }>('ai_index_embeddings');
          const batchDuration = Date.now() - batchStartTime;
          
          // 记录调用后的内存状态
          const memoryAfterCall = (performance as any).memory ? {
            used: Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024)
          } : null;
          const memoryDelta = memoryBeforeCall && memoryAfterCall 
            ? memoryAfterCall.used - memoryBeforeCall.used 
            : null;
          
          // 记录批次结果（详细日志）
          consoleService.addLog('info', [
            `[AI 索引] 批次 ${batchCount} 完成`,
            `成功: ${result.batch_indexed}, 失败: ${result.batch_failed}`,
            `总进度: ${result.total_indexed}/${result.total_images}`,
            `耗时: ${batchDuration}ms`,
            `平均速度: ${result.batch_indexed > 0 ? Math.round(batchDuration / result.batch_indexed) : 0}ms/项`,
            memoryDelta !== null ? `内存变化: ${memoryDelta > 0 ? '+' : ''}${memoryDelta}MB` : ''
          ]);
          
          console.log('[AI Index] Batch result:', result);
          totalProcessed += result.batch_indexed;
          totalFailed += result.batch_failed;
          
          setAiStats({ indexed: result.total_indexed, total: result.total_images, progress: result.total_images > 0 ? result.total_indexed / result.total_images : 0 });
          const batchProcessed = result.batch_indexed + result.batch_failed;
          
          // 记录批次性能信息
          if (batchDuration > 5000) {
            consoleService.addLog('warn', [
              `[AI 索引] 批次 ${batchCount} 处理较慢`,
              `耗时: ${batchDuration}ms`,
              `成功: ${result.batch_indexed}, 失败: ${result.batch_failed}`,
              `建议: 检查文件大小或模型加载状态`
            ]);
          }
          
          // 检查是否有进展（total_indexed 是否增加）
          const madeProgress = result.total_indexed > lastTotalIndexed;
          lastTotalIndexed = result.total_indexed;
          
          if (batchProcessed === 0) {
            // 空批次：没有资产需要处理
            consecutiveEmptyBatches++;
            consecutiveAllFailedBatches = 0; // 重置全部失败计数器
            if (consecutiveEmptyBatches >= maxEmptyBatches) {
              consoleService.addLog('info', [
                `[AI 索引] 停止: 连续 ${consecutiveEmptyBatches} 批为空`,
                `总批次数: ${batchCount}, 总耗时: ${Date.now() - startTime}ms`
              ]);
              hasMore = false;
              break;
            }
          } else if (!madeProgress) {
            // 处理了资产但没有进展（全部失败或失败后重试仍然失败）
            consecutiveAllFailedBatches++;
            consecutiveEmptyBatches = 0; // 重置空批次计数器
            
            consoleService.addLog('warn', [
              `[AI 索引] 批次 ${batchCount} 无进展`,
              `成功: ${result.batch_indexed}, 失败: ${result.batch_failed}`,
              `连续无进展批次: ${consecutiveAllFailedBatches}/${maxAllFailedBatches}`,
              `耗时: ${batchDuration}ms`
            ]);
            
            if (consecutiveAllFailedBatches >= maxAllFailedBatches) {
              consoleService.addLog('error', [
                `[AI 索引] 停止: 连续 ${maxAllFailedBatches} 批无进展`,
                `可能原因: 文件损坏、模型加载失败、内存不足`,
                `总批次数: ${batchCount}, 总成功: ${totalProcessed}, 总失败: ${totalFailed}`,
                `总耗时: ${Date.now() - startTime}ms`
              ]);
              showToast(`警告: 连续 ${maxAllFailedBatches} 批资产索引无进展，可能文件有问题或已全部处理完成`, 'warning');
              hasMore = false;
              break;
            }
          } else {
            // 有成功的索引，重置所有计数器
            consecutiveEmptyBatches = 0;
            consecutiveAllFailedBatches = 0;
            
            // 记录成功批次（每10批记录一次，避免日志过多）
            if (batchCount % 10 === 0) {
              consoleService.addLog('info', [
                `[AI 索引] 进度更新`,
                `批次: ${batchCount}, 已索引: ${result.total_indexed}/${result.total_images}`,
                `本批成功: ${result.batch_indexed}, 失败: ${result.batch_failed}`,
                `平均耗时: ${Math.round((Date.now() - startTime) / batchCount)}ms/批`
              ]);
            }
          }
          
          // 如果已经全部索引完成，停止
          if (result.total_indexed >= result.total_images) {
            const totalDuration = Date.now() - startTime;
            consoleService.addLog('info', [
              `[AI 索引] 完成`,
              `总批次数: ${batchCount}`,
              `总成功: ${totalProcessed}, 总失败: ${totalFailed}`,
              `总耗时: ${totalDuration}ms (${Math.round(totalDuration / 1000)}秒)`,
              `平均速度: ${batchCount > 0 ? Math.round(totalDuration / batchCount) : 0}ms/批`
            ]);
            hasMore = false;
            break;
          }
          
          // 如果本批处理了资产，且还有未索引的，继续
          hasMore = batchProcessed > 0 && result.total_indexed < result.total_images;
        } catch (batchError: any) {
          const batchDuration = Date.now() - batchStartTime;
          const errorMessage = batchError?.message || String(batchError);
          const errorStack = batchError?.stack;
          const errorCode = batchError?.code;
          const errorName = batchError?.name;
          
          // 详细记录错误信息
          consoleService.addLog('error', [
            `[AI 索引] 批次 ${batchCount} 调用失败`,
            `错误类型: ${errorName || 'Unknown'}`,
            `错误消息: ${errorMessage}`,
            errorCode ? `错误代码: ${errorCode}` : '',
            `耗时: ${batchDuration}ms`,
            `连续失败批次: ${consecutiveAllFailedBatches + 1}/${maxAllFailedBatches}`,
            `总成功: ${totalProcessed}, 总失败: ${totalFailed}`,
            errorStack ? `堆栈:\n${errorStack}` : '',
            { 
              error: batchError, 
              stack: errorStack,
              batchCount,
              totalProcessed,
              totalFailed,
              duration: batchDuration
            }
          ]);
          
          consecutiveAllFailedBatches++;
          if (consecutiveAllFailedBatches >= maxAllFailedBatches) {
            consoleService.addLog('error', [
              `[AI 索引] 达到最大连续失败次数，停止索引`,
              `连续失败: ${consecutiveAllFailedBatches} 批`,
              `总批次数: ${batchCount}`,
              `总成功: ${totalProcessed}, 总失败: ${totalFailed}`,
              `总耗时: ${Date.now() - startTime}ms`
            ]);
            throw batchError; // 重新抛出，让外层 catch 处理
          }
          
          // 短暂延迟后重试
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (e: any) {
      const totalDuration = Date.now() - startTime;
      const errorMessage = e?.message || String(e);
      const errorStack = e?.stack;
      const errorCode = e?.code;
      const errorName = e?.name;
      
      // 记录结束时的内存状态
      const memoryAfter = (performance as any).memory ? {
        used: Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round((performance as any).memory.totalJSHeapSize / 1024 / 1024),
        limit: Math.round((performance as any).memory.jsHeapSizeLimit / 1024 / 1024)
      } : null;
      const memoryTotalDelta = memoryBefore && memoryAfter 
        ? memoryAfter.used - memoryBefore.used 
        : null;
      
      // 详细记录错误信息（这是关键的错误记录点）
      consoleService.addLog('error', [
        `[AI 索引] 任务失败`,
        `错误类型: ${errorName || 'Unknown'}`,
        `错误消息: ${errorMessage}`,
        errorCode ? `错误代码: ${errorCode}` : '',
        `已处理批次: ${batchCount}`,
        `总成功: ${totalProcessed}, 总失败: ${totalFailed}`,
        `总耗时: ${totalDuration}ms (${Math.round(totalDuration / 1000)}秒)`,
        `平均速度: ${batchCount > 0 ? Math.round(totalDuration / batchCount) : 0}ms/批`,
        memoryAfter ? `最终内存: ${memoryAfter.used}MB / ${memoryAfter.limit}MB` : '',
        memoryTotalDelta !== null ? `内存总变化: ${memoryTotalDelta > 0 ? '+' : ''}${memoryTotalDelta}MB` : '',
        errorStack ? `堆栈:\n${errorStack}` : '',
        { 
          error: e, 
          stack: errorStack,
          context: { 
            batchCount, 
            totalProcessed, 
            totalFailed,
            startTime,
            totalDuration,
            errorName,
            errorCode,
            memoryBefore,
            memoryAfter,
            memoryTotalDelta
          } 
        }
      ]);
      
      console.error('[AI Index] Task failed:', e);
      showToast(`AI 索引失败: ${errorMessage}`, 'error');
    } finally {
      const finalDuration = Date.now() - startTime;
      const finalMemory = (performance as any).memory ? {
        used: Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024),
        limit: Math.round((performance as any).memory.jsHeapSizeLimit / 1024 / 1024)
      } : null;
      
      consoleService.addLog('info', [
        `[AI 索引] 任务结束`,
        `总批次数: ${batchCount}`,
        `总成功: ${totalProcessed}, 总失败: ${totalFailed}`,
        `总耗时: ${finalDuration}ms (${Math.round(finalDuration / 1000)}秒)`,
        finalMemory ? `最终内存: ${finalMemory.used}MB / ${finalMemory.limit}MB` : ''
      ]);
      
      aiIndexingRef.current = false;
      setAiIndexing(false);
    }
  }, [showToast]);

  const handleAiSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setAiResults(null); return; }
    try {
      const results = await invoke<[number, number][]>('ai_semantic_search', { query, topK: 200 });
      const map = new Map<number, number>();
      results.forEach(([id, score]) => map.set(id, score));
      setAiResults(map);
    } catch (e) {
      console.error('AI search failed', e);
      setAiResults(null);
    }
  }, []);

  // Debounced AI search when aiMode + searchText changes
  useEffect(() => {
    if (!aiMode) { setAiResults(null); return; }
    if (!searchText.trim()) { setAiResults(null); return; }
    const timer = setTimeout(() => handleAiSearch(searchText), 400);
    return () => clearTimeout(timer);
  }, [aiMode, searchText, handleAiSearch]);

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

  // Track current page for pagination (use ref to avoid stale closure in infinite scroll)
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);

  // ---- Load assets ----
  // Use a ref to track the latest request and avoid stale results
  const loadRequestRef = useRef(0);
  // Keep a ref to the latest loadAssets so event listeners always call the current version
  const loadAssetsRef = useRef<(append?: boolean) => Promise<void>>(async () => {});

  const loadAssets = useCallback(async (append = false) => {
    const requestId = ++loadRequestRef.current;
    if (!append) {
      // Immediately clear assets and reset scroll for a clean transition
      setAssets([]);
      setLoading(true);
      // Reset scroll position to top
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    } else {
      setLoading(true);
    }
    try {
      const page = append ? currentPageRef.current + 1 : 1;
      const effectiveSortBy = sortBy === 'random' ? 'modified' : sortBy;
      const result = await invoke<QueryResult>('asset_query', {
        params: {
          folder_id: selectedFolderId,
          search: (aiMode ? null : searchText) || null,
          extensions: formatFilter.length > 0 ? formatFilter : null,
          min_width: null,
          max_width: null,
          tag_ids: filterByTag ? [filterByTag] : null,
          min_rating: filterMinRating > 0 ? filterMinRating : null,
          favorite_only: filterFavorites || null,
          sort_by: effectiveSortBy,
          sort_order: sortDesc ? 'desc' : 'asc',
          page,
          page_size: PAGE_SIZE,
        },
      });
      if (requestId !== loadRequestRef.current) return;
      let resultAssets = result.assets;
      if (sortBy === 'random' && !append) {
        for (let i = resultAssets.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [resultAssets[i], resultAssets[j]] = [resultAssets[j], resultAssets[i]];
        }
      }
      if (append) {
        setAssets(prev => [...prev, ...resultAssets]);
      } else {
        setAssets(resultAssets);
      }
      setTotalAssets(result.total);
      setCurrentPage(page);
      currentPageRef.current = page;
    } catch (e) {
      if (requestId !== loadRequestRef.current) return;
      console.error('加载资源失败:', e);
    }
    if (requestId === loadRequestRef.current) {
      setLoading(false);
    }
  }, [selectedFolderId, searchText, formatFilter, sortBy, sortDesc, filterByTag, filterMinRating, filterFavorites, aiMode]);

  // Always keep loadAssetsRef pointing to the latest loadAssets
  useEffect(() => {
    loadAssetsRef.current = loadAssets;
  }, [loadAssets]);

  // Load when filters change — use a dedicated effect that directly queries
  useEffect(() => {
    const requestId = ++loadRequestRef.current;
    setCurrentPage(1);
    currentPageRef.current = 1;
    setAssets([]);
    setLoading(true);
    // Reset scroll position
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    (async () => {
      try {
        const effectiveSortBy2 = sortBy === 'random' ? 'modified' : sortBy;
        const result = await invoke<QueryResult>('asset_query', {
          params: {
            folder_id: selectedFolderId,
          search: (aiMode ? null : searchText) || null,
          extensions: formatFilter.length > 0 ? formatFilter : null,
          min_width: null,
          max_width: null,
          tag_ids: filterByTag ? [filterByTag] : null,
          min_rating: filterMinRating > 0 ? filterMinRating : null,
            favorite_only: filterFavorites || null,
            sort_by: effectiveSortBy2,
            sort_order: sortDesc ? 'desc' : 'asc',
            page: 1,
            page_size: PAGE_SIZE,
          },
        });
        if (requestId !== loadRequestRef.current) return;
        let resultAssets2 = result.assets;
        if (sortBy === 'random') {
          for (let i = resultAssets2.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [resultAssets2[i], resultAssets2[j]] = [resultAssets2[j], resultAssets2[i]];
          }
        }
        setAssets(resultAssets2);
        setTotalAssets(result.total);
        setCurrentPage(1);
      } catch (e) {
        if (requestId !== loadRequestRef.current) return;
        console.error('加载资源失败:', e);
      }
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    })();
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
          loadAssetsRef.current(false);
          // Background indexing: colors + hashes (silent, non-blocking)
          invoke('asset_index_colors').catch(() => {});
          invoke('asset_index_hashes').catch(() => {});
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

  // Background color/hash index on startup (delayed to avoid lock contention with initial queries)
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke('asset_index_colors').catch(() => {});
      invoke('asset_index_hashes').catch(() => {});
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  // Color search effect
  useEffect(() => {
    if (!colorFilter) {
      setColorFilterIds(null);
      return;
    }
    const hex = colorFilter;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const rf = r / 255, gf = g / 255, bf = b / 255;
    const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
      else if (max === gf) h = ((bf - rf) / d + 2) / 6;
      else h = ((rf - gf) / d + 4) / 6;
      h *= 360;
    }
    const hRange = 25;
    invoke<number[]>('asset_search_by_color', {
      hMin: (h - hRange + 360) % 360,
      hMax: (h + hRange) % 360,
      sMin: Math.max(0, s - 0.3),
      lMin: Math.max(0, l - 0.3),
      lMax: Math.min(1, l + 0.3),
    }).then(ids => {
      setColorFilterIds(new Set(ids));
    }).catch(() => setColorFilterIds(null));
  }, [colorFilter]);

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

  const handleSetCustomPaths = async (assetId: number, paths: CustomPaths) => {
    try {
      await invoke('asset_set_custom_paths', {
        assetId,
        sourcePath: paths.source_path,
        slicePath: paths.slice_path,
        effectPath: paths.effect_path,
      });
      if (detailAssetId === assetId) loadAssetDetail(assetId);
    } catch (e: any) {
      showToast('error', e?.toString() || '设置自定义路径失败');
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

  const handleBatchRename = async (renames: [number, string][]) => {
    try {
      const count = await invoke<number>('asset_batch_rename', { renames });
      showToast('success', `已重命名 ${count} 个文件`);
      setSelectedIds(new Set());
      setShowBatchRename(false);
      loadAssets(false);
    } catch (e: any) {
      showToast('error', e?.toString() || '批量重命名失败');
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
        heartbeatTimersRef.current.set(filePath, timer);
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
      const timer = heartbeatTimersRef.current.get(filePath);
      if (timer) { clearInterval(timer); heartbeatTimersRef.current.delete(filePath); }
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
      heartbeatTimersRef.current.forEach(timer => clearInterval(timer));
      heartbeatTimersRef.current.clear();
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
      // Ctrl+Shift+F: Spotlight quick search
      if (e.key === 'F' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setShowSpotlight(true);
        return;
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
      const folder = await invoke<AssetFolder>('asset_add_folder', { path: selected, spaceType: space });
      await loadFolders();
      showToast('success', '文件夹已添加，正在扫描...');
      // 自动选中新添加的文件夹
      setSelectedFolderId(folder.id);
      // 自动扫描新添加的文件夹
      handleScanFolder(folder.id);
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
  const lockedPathsSet = useMemo(() => new Set(activeLocks.map(l => l.file_path)), [activeLocks]);
  const displayAssets = useMemo(() => {
    let result = assets;
    if (colorFilterIds) {
      result = result.filter(a => colorFilterIds.has(a.id));
    }
    if (aiMode && aiResults) {
      const matched = result.filter(a => aiResults.has(a.id));
      matched.sort((a, b) => (aiResults.get(b.id) || 0) - (aiResults.get(a.id) || 0));
      return matched;
    }
    return result;
  }, [assets, colorFilterIds, aiMode, aiResults]);

  // ---- Render ----
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar - Row 1: Navigation & Search */}
      <div className="flex-none flex items-center gap-2 px-4 py-2 border-b border-[#222]">
        {/* Space switch */}
        <div className="flex bg-[#1a1a1a] rounded-lg p-0.5 gap-0.5 flex-none">
          <button
            onClick={() => { setSpace('personal'); setSelectedFolderId(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              space === 'personal' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-[#aaa]'
            }`}
          >
            <HardDrive size={13} /> 个人
          </button>
          <button
            onClick={() => { setSpace('team'); setSelectedFolderId(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              space === 'team' ? 'bg-[#2a2a2a] text-white' : 'text-[#888] hover:text-[#aaa]'
            }`}
          >
            <Globe size={13} /> 团队
          </button>
        </div>

        {/* Search */}
        <div className="flex-1 relative flex items-center gap-1.5">
          <div className="relative flex-1">
            {aiMode ? (
              <Sparkles size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-400" />
            ) : (
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
            )}
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={aiMode ? 'AI 语义搜索：描述你想找的内容…' : '搜索 (支持 A B 多词 | 或 -排除)'}
              className={`w-full bg-[#1a1a1a] border rounded-lg pl-9 pr-8 py-1.5 text-xs text-[#ccc] placeholder-[#555] outline-none transition-colors ${
                aiMode ? 'border-purple-500/50 focus:border-purple-500' : 'border-[#2a2a2a] focus:border-[#3b82f6]'
              }`}
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
          <button
            onClick={() => {
              if (!aiReady) { handleAiSetup(); return; }
              setAiMode(!aiMode);
              if (aiMode) { setAiResults(null); }
            }}
            title={aiReady ? (aiMode ? '关闭 AI 搜索' : '开启 AI 语义搜索') : '下载 AI 模型 (~600MB)'}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap flex-none ${
              aiDownloading || aiLoading ? 'bg-purple-500/20 text-purple-300 animate-pulse cursor-wait' :
              aiMode ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20' :
              aiReady ? 'bg-[#1a1a1a] text-purple-400 hover:bg-purple-500/20 border border-purple-500/30' :
              'bg-[#1a1a1a] text-[#888] hover:text-purple-400 border border-[#2a2a2a]'
            }`}
          >
            <Sparkles size={12} />
            {aiDownloading ? '下载中…' : aiLoading ? '加载中…' : 'AI'}
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-[#333] flex-none" />

        {/* View mode + Zoom slider */}
        <div className="flex items-center gap-1.5 bg-[#1a1a1a] rounded-lg px-2 py-1 flex-none">
          <button
            onClick={() => setViewMode('masonry')}
            className={`p-1 rounded ${viewMode === 'masonry' ? 'bg-[#2a2a2a] text-white' : 'text-[#666] hover:text-[#aaa]'}`}
            title="瀑布流"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1 rounded ${viewMode === 'list' ? 'bg-[#2a2a2a] text-white' : 'text-[#666] hover:text-[#aaa]'}`}
            title="列表"
          >
            <Grid size={14} />
          </button>
          {viewMode === 'masonry' && (
            <>
              <div className="w-px h-4 bg-[#333] mx-0.5" />
              <Grid size={11} className="text-[#555] flex-none" />
              <input
                type="range"
                min={100}
                max={400}
                step={10}
                value={thumbScale}
                onChange={e => setThumbScale(+e.target.value)}
                className="w-20 accent-[#3b82f6] cursor-pointer"
                title={`缩略图宽度: ${thumbScale}px`}
              />
              <LayoutGrid size={11} className="text-[#555] flex-none" />
            </>
          )}
        </div>

        {/* Tool buttons group */}
        <div className="flex items-center gap-1 flex-none">
          <button
            onClick={() => setShowSpotlight(true)}
            className="p-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-[#666] hover:text-[#aaa] rounded transition-colors"
            title="快速搜索 (Ctrl+Shift+F)"
          >
            <Search size={13} />
          </button>
          <button
            onClick={() => setShowDuplicates(true)}
            className="p-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-[#666] hover:text-[#aaa] rounded transition-colors"
            title="重复文件检测"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => setShowFfmpegSettings(true)}
            className="p-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-[#666] hover:text-[#aaa] rounded transition-colors"
            title="FFmpeg 设置"
          >
            <Settings size={13} />
          </button>
          <button
            onClick={handleScanAll}
            disabled={scanning || spaceFolders.length === 0}
            className="flex items-center gap-1 px-2 py-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-[#aaa] rounded text-[11px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="扫描所有文件夹"
          >
            <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
            {scanning ? '扫描中' : '刷新'}
          </button>
        </div>
      </div>

      {/* Top Bar - Row 2: Filters */}
      <div className="flex-none flex items-center gap-2 px-4 py-1.5 border-b border-[#1a1a1a] bg-[#111]">
        {/* Format filters */}
        <div className="flex gap-0.5 flex-none">
          {FORMAT_GROUPS.map(g => {
            const active = g.exts.length === 0
              ? formatFilter.length === 0
              : JSON.stringify(formatFilter) === JSON.stringify(g.exts);
            return (
              <button
                key={g.label}
                onClick={() => setFormatFilter(g.exts)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  active ? 'bg-[#2563eb] text-white' : 'text-[#777] hover:text-[#ccc] hover:bg-[#1a1a1a]'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>

        <div className="w-px h-4 bg-[#222] flex-none" />

        {/* Color filter */}
        <div className="relative flex items-center flex-none">
          <input
            type="color"
            value={colorFilter || '#ff0000'}
            onChange={e => setColorFilter(e.target.value)}
            className="w-0 h-0 opacity-0 absolute"
            id="color-filter-input"
          />
          <button
            onClick={() => {
              if (colorFilter) { setColorFilter(null); }
              else { (document.getElementById('color-filter-input') as HTMLInputElement)?.click(); }
            }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              colorFilter ? 'text-white' : 'text-[#777] hover:text-[#ccc] hover:bg-[#1a1a1a]'
            }`}
            style={colorFilter ? { background: colorFilter } : {}}
            title={colorFilter ? '点击清除颜色过滤' : '按颜色搜索'}
          >
            <Palette size={12} />
            {!colorFilter && '颜色'}
          </button>
          {!colorFilter && (
            <label htmlFor="color-filter-input" className="cursor-pointer ml-0.5">
              <div className="w-3.5 h-3.5 rounded-full border border-[#333] bg-gradient-to-br from-red-500 via-green-500 to-blue-500 hover:scale-110 transition-transform" title="选择颜色" />
            </label>
          )}
        </div>

        {/* Favorite filter */}
        <button
          onClick={() => setFilterFavorites(!filterFavorites)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex-none ${
            filterFavorites ? 'bg-[#f59e0b] text-white' : 'text-[#777] hover:text-[#ccc] hover:bg-[#1a1a1a]'
          }`}
          title="只看收藏"
        >
          <Bookmark size={11} /> 收藏
        </button>

        {/* Min rating filter */}
        <div className="flex items-center gap-0.5 flex-none">
          {[1, 2, 3, 4, 5].map(r => (
            <button
              key={r}
              onClick={() => setFilterMinRating(filterMinRating === r ? 0 : r)}
              className="transition-colors hover:scale-110"
              title={filterMinRating === r ? '取消评分过滤' : `最少 ${r} 星`}
            >
              <Star
                size={12}
                className={r <= filterMinRating ? 'text-yellow-400 fill-yellow-400' : 'text-[#444]'}
              />
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[#222] flex-none" />

        {/* Tag filter */}
        {allTags.length > 0 && (
          <select
            value={filterByTag ?? ''}
            onChange={e => setFilterByTag(e.target.value ? Number(e.target.value) : null)}
            className="bg-[#1a1a1a] border border-[#222] rounded text-[11px] text-[#aaa] px-2 py-0.5 outline-none cursor-pointer flex-none"
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
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex-none ${
            showTagManager ? 'bg-[#2563eb] text-white' : 'text-[#777] hover:text-[#ccc] hover:bg-[#1a1a1a]'
          }`}
          title="标签管理"
        >
          <Tag size={11} /> 标签
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sort */}
        <div className="flex items-center gap-1 flex-none">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-[#1a1a1a] border border-[#222] rounded text-[11px] text-[#aaa] px-2 py-0.5 outline-none cursor-pointer"
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

      {/* AI indexing / download status */}
      {(aiDownloading || aiIndexing || (aiMode && aiStats && aiStats.indexed < aiStats.total)) && (
        <div className="flex-none px-4 py-1.5 bg-[#1a1024] border-b border-purple-500/20">
          <div className="flex items-center gap-3 text-xs text-purple-300">
            <Sparkles size={13} className={aiDownloading || aiIndexing ? 'animate-pulse' : ''} />
            <span className="truncate max-w-[400px]">
              {aiDownloading ? `正在下载 AI 模型 — ${aiDownloadProgress || '准备中…'}` :
               aiIndexing && aiStats ? `AI 向量索引中 ${aiStats.indexed}/${aiStats.total}` :
               aiStats ? `AI 索引: ${aiStats.indexed}/${aiStats.total} 张图片` : 'AI 准备中…'}
            </span>
            {aiDownloading && aiDownloadProgress && (
              <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden max-w-[200px]">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all duration-300"
                  style={{ width: aiDownloadProgress.match(/\((\d+)%\)/)?.[1] ? `${aiDownloadProgress.match(/\((\d+)%\)/)?.[1]}%` : '0%' }}
                />
              </div>
            )}
            {!aiDownloading && aiStats && aiStats.total > 0 && (
              <div className="flex-1 h-1 bg-[#1a1a1a] rounded-full overflow-hidden max-w-[200px]">
                <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${aiStats.progress * 100}%` }} />
              </div>
            )}
            {!aiIndexing && aiReady && aiStats && aiStats.indexed < aiStats.total && (
              <button onClick={handleAiIndex} className="text-purple-400 hover:text-purple-300 text-[10px] underline">继续索引</button>
            )}
          </div>
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
            onClick={() => setShowBatchRename(true)}
            className="text-xs px-2 py-1 rounded bg-[#f97316]/20 text-[#f97316] hover:bg-[#f97316]/30 flex items-center gap-1"
            title="批量重命名 (Ctrl+R)"
          >
            <Edit3 size={12} /> 重命名
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

          {/* Scrollable grid / list */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
            {displayAssets.length > 0 ? (
              viewMode === 'list' ? (
              <ListView
                assets={displayAssets}
                containerRef={scrollRef}
                onClickAsset={(asset, _idx) => {
                  if (window.event && (window.event as any).ctrlKey) {
                    setSelectedIds(prev => { const next = new Set(prev); if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id); return next; });
                    return;
                  }
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
                onDoubleClickAsset={(_asset, idx) => { setPreviewIndex(idx); }}
                onContextMenu={handleContextMenu}
                selectedIds={selectedIds}
                assetTagsMap={assetTagsMap}
                assetRatingsMap={assetRatingsMap}
              />
              ) : (
              <VirtualGrid
                assets={displayAssets}
                containerRef={scrollRef}
                onClickAsset={(asset, _idx) => {
                  if (window.event && (window.event as any).ctrlKey) {
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(asset.id)) next.delete(asset.id);
                      else next.add(asset.id);
                      return next;
                    });
                    return;
                  }
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
                lockedPaths={lockedPathsSet}
                colMinWidth={thumbScale}
              />
              )
            ) : loading ? (
              <SkeletonMasonryGrid columns={thumbScale > 280 ? 3 : thumbScale > 180 ? 5 : 7} items={15} gap={12} className="p-1" />
            ) : (
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
            )}
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
              onSetCustomPaths={p => handleSetCustomPaths(detailAssetId, p)}
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
          onOpenInNewWindow={async () => {
            const asset = assets.find(a => a.id === contextMenu.assetId);
            if (!asset) return;
            try {
              const { WebviewWindow } = await import('@tauri-apps/api/window');
              const label = `preview_${asset.id}`;
              const previewUrl = IMAGE_EXTS.has(asset.file_ext)
                ? convertFileSrc(asset.file_path)
                : (asset.thumb_path ? convertFileSrc(asset.thumb_path) : '');
              if (!previewUrl) return;
              new WebviewWindow(label, {
                url: previewUrl,
                title: asset.file_name,
                width: Math.min(asset.width || 800, 1200),
                height: Math.min(asset.height || 600, 900),
                alwaysOnTop: true,
                decorations: true,
                resizable: true,
              });
            } catch (e) { console.error('Open new window failed', e); }
          }}
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

      {/* Batch Rename */}
      {showBatchRename && selectedIds.size > 0 && (
        <BatchRenameModal
          assets={assets.filter(a => selectedIds.has(a.id))}
          onRename={handleBatchRename}
          onClose={() => setShowBatchRename(false)}
        />
      )}

      {/* Spotlight Quick Search */}
      {showSpotlight && (
        <SpotlightSearch
          onSelect={(asset) => {
            setShowSpotlight(false);
            setDetailAssetId(asset.id);
            const idx = displayAssets.findIndex(a => a.id === asset.id);
            if (idx >= 0) setPreviewIndex(idx);
          }}
          onClose={() => setShowSpotlight(false)}
        />
      )}

      {/* Duplicate Finder */}
      {showDuplicates && (
        <DuplicateFinderModal
          onClose={() => setShowDuplicates(false)}
          onSelectAsset={(id) => { setShowDuplicates(false); setDetailAssetId(id); }}
        />
      )}
    </div>
  );
}
