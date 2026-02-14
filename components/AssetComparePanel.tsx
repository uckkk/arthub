import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, Loader2, ChevronLeft, ChevronRight, Download, Maximize2, Minimize2 } from 'lucide-react';
import { ImgComparisonSlider } from '@img-comparison-slider/react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { encodeZopfliPNG } from '../utils/zopflipng';

interface AssetEntry {
  id: number; folder_id: number; file_path: string; file_name: string;
  file_ext: string; file_size: number; width: number; height: number;
  thumb_path: string; modified_at: number;
}
interface LImg {
  asset: AssetEntry; previewUrl: string; imageData: ImageData;
  pngBuffer: ArrayBuffer; width: number; height: number;
}
interface CR { blob: Blob; url: string; size: number; ratio: number; time: number; }
type AId = 'pngquant' | 'oxipng' | 'zopfli' | 'webp' | 'avif';
const ALGOS: { id: AId; name: string; tag: string; c: string }[] = [
  { id: 'pngquant', name: '\u667A\u80FD\u91CF\u5316', tag: '\u6709\u635F', c: '#f59e0b' },
  { id: 'oxipng', name: '\u65E0\u635F\u4F18\u5316', tag: '\u65E0\u635F', c: '#22c55e' },
  { id: 'zopfli', name: '\u6781\u81F4\u538B\u7F29', tag: '\u6781\u81F4\u65E0\u635F', c: '#3b82f6' },
  { id: 'webp', name: 'WebP', tag: '\u65E0\u635F', c: '#06b6d4' },
  { id: 'avif', name: 'AVIF', tag: '\u6B21\u4E16\u4EE3', c: '#a855f7' },
];
function fS(b: number) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(2) + ' MB'; }
function fR(r: number) { const p = ((1 - r) * 100).toFixed(1); return r < 1 ? '-' + p + '%' : '+' + Math.abs(+p) + '%'; }

function fAD(px: Uint8Array, w: number, h: number, lv: number) {
  const step = 255 / (lv - 1), err = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x, i = idx * 4 + 3, o = px[i];
    if (o <= 2 || o >= 253) continue;
    const a = o + err[idx], q = Math.round(a / step) * step;
    const cl = Math.max(0, Math.min(255, Math.round(q)));
    px[i] = cl; const e = a - cl;
    if (x + 1 < w) err[idx + 1] += e * 7 / 16;
    if (y + 1 < h) { if (x > 0) err[idx + w - 1] += e * 3 / 16; err[idx + w] += e * 5 / 16; if (x + 1 < w) err[idx + w + 1] += e / 16; }
  }
}
function ym() { return new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0))); }

async function loadI(asset: AssetEntry): Promise<LImg> {
  const url = convertFileSrc(asset.file_path);
  const el = await new Promise<HTMLImageElement>((ok, f) => { const i = new Image(); i.onload = () => ok(i); i.onerror = f; i.src = url; });
  const w = el.width, h = el.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!; ctx.drawImage(el, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const buf = await new Promise<ArrayBuffer>(ok => { c.toBlob(b => ok(b!.arrayBuffer()), 'image/png'); });
  return { asset, previewUrl: url, imageData: id, pngBuffer: buf, width: w, height: h };
}

async function cPQ(i: LImg, q: number, es: boolean): Promise<CR> {
  const m = await import('imagequant'); const t0 = performance.now();
  const px = new Uint8Array(i.imageData.data.length); px.set(i.imageData.data);
  if (es) fAD(px, i.width, i.height, 32);
  let inst: any = null, img: any = null;
  try { inst = new m.Imagequant(); inst.set_quality(0, q); inst.set_speed(1);
    img = new m.ImagequantImage(new Uint8Array(px), i.width, i.height, 0);
    const o = inst.process(img), b = new Blob([o], { type: 'image/png' });
    return { blob: b, url: URL.createObjectURL(b), size: b.size, ratio: b.size / i.asset.file_size, time: performance.now() - t0 };
  } finally { try { img?.free(); } catch {} try { inst?.free(); } catch {} }
}
async function cOX(i: LImg, l: number): Promise<CR> {
  const m = await import('@jsquash/oxipng'), op = m.optimise || m.default, t0 = performance.now();
  const o = await op!(i.pngBuffer.slice(0), { level: l }), b = new Blob([o], { type: 'image/png' });
  return { blob: b, url: URL.createObjectURL(b), size: b.size, ratio: b.size / i.asset.file_size, time: performance.now() - t0 };
}
async function cZP(i: LImg, it: number): Promise<CR> {
  const t0 = performance.now(), o = await encodeZopfliPNG(i.imageData, { numiterations: it });
  const b = new Blob([o], { type: 'image/png' });
  return { blob: b, url: URL.createObjectURL(b), size: b.size, ratio: b.size / i.asset.file_size, time: performance.now() - t0 };
}
async function cWP(i: LImg, ll: boolean, q: number): Promise<CR> {
  const t0 = performance.now(), c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
  c.getContext('2d')!.putImageData(i.imageData, 0, 0);
  const b = await new Promise<Blob>((ok, f) => { c.toBlob(x => x ? ok(x) : f(), 'image/webp', ll ? 1.0 : q / 100); });
  return { blob: b, url: URL.createObjectURL(b), size: b.size, ratio: b.size / i.asset.file_size, time: performance.now() - t0 };
}
async function cAV(i: LImg, q: number): Promise<CR> {
  const t0 = performance.now(), m = await import('@jsquash/avif'), enc = m.encode || m.default;
  const cq = Math.round(63 * (1 - q / 100));
  const buf: ArrayBuffer = await enc!(i.imageData, { cqLevel: cq, cqAlphaLevel: -1, speed: 6, subsample: 1 });
  const b = new Blob([buf], { type: 'image/avif' });
  return { blob: b, url: URL.createObjectURL(b), size: b.size, ratio: b.size / i.asset.file_size, time: performance.now() - t0 };
}

export default function AssetComparePanel({ assets, onClose }: { assets: AssetEntry[]; onClose: () => void }) {
  const IE = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'psd']);
  const ia = assets.filter(a => IE.has(a.file_ext));
  const [ld, sLd] = useState<LImg[]>([]);
  const [lc, sLc] = useState(0);
  const [al, sAl] = useState<AId>('pngquant');
  const [rs, sRs] = useState<Map<number, CR>>(new Map());
  const [pr, sPr] = useState<Set<number>>(new Set());
  const [arR, sArR] = useState(false);
  const [vw, sVw] = useState<'grid' | 'single'>('grid');
  const [fi, sFi] = useState(0);
  const [pq, sPq] = useState(75); const [pe, sPe] = useState(true);
  const [ol, sOl] = useState(4); const [zi, sZi] = useState(5);
  const [wl, sWl] = useState(true); const [wq, sWq] = useState(90); const [avq, sAvq] = useState(80);
  const ab = useRef(false);

  useEffect(() => {
    ab.current = false; sLc(0); sLd([]); sRs(new Map());
    let d = false;
    (async () => { const a: LImg[] = []; for (const x of ia) { if (d) break; try { a.push(await loadI(x)); sLd([...a]); sLc(a.length); } catch {} } })();
    return () => { d = true; };
  }, [assets]);

  const comp = useCallback(async (img: LImg) => {
    const id = img.asset.id; sPr(p => new Set(p).add(id));
    try { let r: CR;
      switch (al) { case 'pngquant': r = await cPQ(img, pq, pe); break; case 'oxipng': r = await cOX(img, ol); break;
        case 'zopfli': r = await cZP(img, zi); break; case 'webp': r = await cWP(img, wl, wq); break; case 'avif': r = await cAV(img, avq); break; }
      sRs(p => { const n = new Map(p); const o = n.get(id); if (o?.url) URL.revokeObjectURL(o.url); n.set(id, r!); return n; });
    } catch (e) { console.error('Compress fail:', e); }
    sPr(p => { const s = new Set(p); s.delete(id); return s; });
  }, [al, pq, pe, ol, zi, wl, wq, avq]);

  const cAll = useCallback(async () => {
    ab.current = false; sArR(true);
    for (const i of ld) { if (ab.current) break; await comp(i); await ym(); }
    sArR(false);
  }, [ld, comp]);

  useEffect(() => { rs.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); }); sRs(new Map()); }, [al]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose();
      if (vw === 'single') { if (e.key === 'ArrowLeft' && fi > 0) sFi(fi - 1); if (e.key === 'ArrowRight' && fi < ld.length - 1) sFi(fi + 1); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose, vw, fi, ld.length]);

  const tO = ld.reduce((s, i) => s + i.asset.file_size, 0);
  const tC = ld.reduce((s, i) => s + (rs.get(i.asset.id)?.size ?? i.asset.file_size), 0);
  const tR = tO > 0 ? tC / tO : 1;

  const stg = (): React.ReactNode => {
    switch (al) {
      case 'pngquant': return (<div className="flex items-center gap-3"><span className="text-[11px] text-[#888]">{'\u753B\u8D28'}</span><input type="range" min={10} max={100} value={pq} onChange={e => sPq(+e.target.value)} className="w-24 accent-[#f59e0b]" /><span className="text-[11px] text-[#ccc] w-8">{pq}</span><label className="flex items-center gap-1.5 text-[11px] text-[#888] cursor-pointer"><input type="checkbox" checked={pe} onChange={e => sPe(e.target.checked)} className="accent-[#f59e0b]" />{'\u8FB9\u7F18\u67D4\u5316'}</label></div>);
      case 'oxipng': return (<div className="flex items-center gap-3"><span className="text-[11px] text-[#888]">{'\u7EA7\u522B'}</span><input type="range" min={1} max={6} value={ol} onChange={e => sOl(+e.target.value)} className="w-24 accent-[#22c55e]" /><span className="text-[11px] text-[#ccc] w-8">{ol}</span></div>);
      case 'zopfli': return (<div className="flex items-center gap-3"><span className="text-[11px] text-[#888]">{'\u8FED\u4EE3'}</span><input type="range" min={1} max={15} value={zi} onChange={e => sZi(+e.target.value)} className="w-24 accent-[#3b82f6]" /><span className="text-[11px] text-[#ccc] w-8">{zi}</span></div>);
      case 'webp': return (<div className="flex items-center gap-3"><label className="flex items-center gap-1.5 text-[11px] text-[#888] cursor-pointer"><input type="checkbox" checked={wl} onChange={e => sWl(e.target.checked)} className="accent-[#06b6d4]" />{'\u65E0\u635F'}</label>{!wl && <><span className="text-[11px] text-[#888]">{'\u753B\u8D28'}</span><input type="range" min={10} max={100} value={wq} onChange={e => sWq(+e.target.value)} className="w-24 accent-[#06b6d4]" /><span className="text-[11px] text-[#ccc] w-8">{wq}</span></>}</div>);
      case 'avif': return (<div className="flex items-center gap-3"><span className="text-[11px] text-[#888]">{'\u753B\u8D28'}</span><input type="range" min={1} max={100} value={avq} onChange={e => sAvq(+e.target.value)} className="w-24 accent-[#a855f7]" /><span className="text-[11px] text-[#ccc] w-8">{avq}</span></div>);
    }
  };

  const cd = (img: LImg, idx: number, big = false) => {
    const r = rs.get(img.asset.id), ip = pr.has(img.asset.id);
    return (
      <div key={img.asset.id} className={'relative rounded-xl border border-[#222] bg-[#111] overflow-hidden flex flex-col' + (big ? ' flex-1' : '')}>
        <div className={'flex-1 relative overflow-hidden flex items-center justify-center' + (big ? '' : ' h-64')}>
          {r ? (<>
            <ImgComparisonSlider hover={true} className="outline-none [--divider-width:1px] [--divider-color:rgba(255,255,255,0.4)]"
              style={{ display: 'block', width: '100%', height: '100%', overflow: 'hidden' }}>
              <img slot="first" src={img.previewUrl} alt="O" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
              <img slot="second" src={r.url} alt="C" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
              <div slot="handle" className="w-[1px] h-full bg-white/40 flex items-center justify-center">
                <div className="w-7 h-7 bg-white/15 backdrop-blur-md border border-white/25 rounded-full flex items-center justify-center shadow-lg">
                  <div className="flex gap-0.5"><ChevronLeft className="w-2.5 h-2.5 text-white/70" /><ChevronRight className="w-2.5 h-2.5 text-white/70" /></div>
                </div></div>
            </ImgComparisonSlider>
            <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded text-[10px] text-white/80 pointer-events-none z-10">{'\u539F\u56FE'} {fS(img.asset.file_size)}</div>
            <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded text-[10px] text-white/80 pointer-events-none z-10">{ALGOS.find(a => a.id === al)?.name} {fS(r.size)}</div>
          </>) : (<>
            <img src={img.previewUrl} alt={img.asset.file_name} className="w-full h-full object-contain" />
            {ip && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="animate-spin text-white" size={24} /></div>}
          </>)}
          {!big && <button className="absolute bottom-2 right-2 p-1 bg-black/50 hover:bg-black/70 rounded text-white/60 hover:text-white z-10" onClick={() => { sVw('single'); sFi(idx); }}><Maximize2 size={12} /></button>}
        </div>
        <div className="flex-none flex items-center gap-2 px-3 py-2 border-t border-[#1a1a1a] bg-[#0d0d0d]">
          <span className="text-[11px] text-[#ccc] truncate flex-1" title={img.asset.file_name}>{img.asset.file_name}</span>
          <span className="text-[10px] text-[#666]">{img.width}x{img.height}</span>
          <span className="text-[10px] text-[#666]">{fS(img.asset.file_size)}</span>
          {r && <span className={'text-[10px] font-medium ' + (r.ratio < 1 ? 'text-[#22c55e]' : 'text-[#ef4444]')}>{fS(r.size)} ({fR(r.ratio)})</span>}
          {!r && !ip && <button onClick={() => comp(img)} className="text-[10px] px-2 py-0.5 rounded bg-[#2563eb]/20 text-[#3b82f6] hover:bg-[#2563eb]/30">{'\u538B\u7F29'}</button>}
        </div>
      </div>);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a]/95 flex flex-col">
      <div className="flex-none flex items-center gap-4 px-5 py-3 border-b border-[#222] bg-[#111] flex-wrap">
        <h2 className="text-sm font-medium text-[#eee]">{'\u56FE\u7247\u5BF9\u6BD4'} - {ld.length} {'\u5F20'}</h2>
        <div className="flex gap-1 ml-4">{ALGOS.map(a => (
          <button key={a.id} onClick={() => sAl(a.id)}
            className={'px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1.5 ' + (al === a.id ? 'text-white' : 'text-[#888] hover:text-[#ccc] bg-[#1a1a1a]')}
            style={al === a.id ? { background: a.c + '33', color: a.c } : {}}>
            {a.name}<span className="text-[9px] opacity-60">{a.tag}</span></button>))}</div>
        <div className="ml-4">{stg()}</div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={arR ? () => { ab.current = true; } : cAll} disabled={ld.length === 0}
            className={'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ' + (arR ? 'bg-[#ef4444]/20 text-[#ef4444]' : 'bg-[#2563eb]/20 text-[#3b82f6]')}>
            {arR ? <><X size={13} />{'\u505C\u6B62'}</> : <><Download size={13} />{'\u5168\u90E8\u538B\u7F29'}</>}</button>
          <div className="flex bg-[#1a1a1a] rounded p-0.5 gap-0.5">
            <button onClick={() => sVw('grid')} className={'p-1 rounded ' + (vw === 'grid' ? 'bg-[#2a2a2a] text-white' : 'text-[#666]')}><Minimize2 size={13} /></button>
            <button onClick={() => sVw('single')} className={'p-1 rounded ' + (vw === 'single' ? 'bg-[#2a2a2a] text-white' : 'text-[#666]')}><Maximize2 size={13} /></button></div>
          <button onClick={onClose} className="text-[#666] hover:text-white transition-colors p-1"><X size={18} /></button></div>
      </div>
      {rs.size > 0 && (<div className="flex-none flex items-center gap-6 px-5 py-2 border-b border-[#1a1a1a] bg-[#0d0d0d] text-[11px]">
        <span className="text-[#888]">{'\u5DF2\u538B\u7F29'} <span className="text-[#ccc]">{rs.size}/{ld.length}</span></span>
        <span className="text-[#888]">{'\u539F\u59CB'} <span className="text-[#ccc]">{fS(tO)}</span></span>
        <span className="text-[#888]">{'\u538B\u7F29\u540E'} <span className={tR < 1 ? 'text-[#22c55e]' : 'text-[#ccc]'}>{fS(tC)}</span></span>
        <span className={'font-medium ' + (tR < 1 ? 'text-[#22c55e]' : 'text-[#ef4444]')}>{fR(tR)}</span></div>)}
      {lc < ia.length && (<div className="flex-none px-5 py-2 border-b border-[#1a1a1a] text-[11px] text-[#888] flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-[#3b82f6]" />{'\u52A0\u8F7D\u56FE\u7247'} {lc}/{ia.length}</div>)}
      <div className="flex-1 overflow-auto p-4">
        {vw === 'grid' ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(' + (ld.length <= 2 ? '400px' : ld.length <= 4 ? '320px' : '260px') + ', 1fr))' }}>
            {ld.map((i, x) => cd(i, x))}</div>
        ) : (
          <div className="h-full flex flex-col">{ld.length > 0 && (<>
            <div className="flex-1 relative">{cd(ld[fi], fi, true)}
              {fi > 0 && <button className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white/60 hover:text-white z-20" onClick={() => sFi(fi - 1)}><ChevronLeft size={20} /></button>}
              {fi < ld.length - 1 && <button className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white/60 hover:text-white z-20" onClick={() => sFi(fi + 1)}><ChevronRight size={20} /></button>}</div>
            {ld.length > 1 && (<div className="flex-none flex items-center gap-2 mt-3 px-4 overflow-x-auto py-2">
              {ld.map((i, x) => { const r = rs.get(i.asset.id); return (
                <button key={i.asset.id} onClick={() => sFi(x)}
                  className={'flex-none w-16 h-16 rounded-lg overflow-hidden border-2 relative ' + (x === fi ? 'border-[#3b82f6]' : 'border-[#222] hover:border-[#444]')}>
                  <img src={i.previewUrl} alt="" className="w-full h-full object-contain bg-[#111]" />
                  {r && <div className={'absolute bottom-0 left-0 right-0 h-1 ' + (r.ratio < 1 ? 'bg-[#22c55e]' : 'bg-[#ef4444]')} />}</button>); })}</div>)}
          </>)}</div>
        )}
      </div>
    </div>
  );
}
