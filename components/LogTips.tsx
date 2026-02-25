import React, { useState, useEffect, useCallback, useRef } from 'react';
import { logCollectorService } from '../services/logCollectorService';
import { consoleService } from '../services/consoleService';

const LogTips: React.FC = () => {
  const [stats, setStats] = useState({ total: 0, errors: 0, warns: 0, hasLastCrash: false });
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => setStats(logCollectorService.getStats());
    // 延迟首次刷新，避免阻塞启动
    const initTimer = setTimeout(refresh, 2000);
    // 订阅日志更新，但做 500ms 防抖（启动时日志密集，避免频繁 re-render）
    const unsub = consoleService.subscribe(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(refresh, 500);
    });
    return () => {
      clearTimeout(initTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
      unsub();
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      const report = logCollectorService.generateReport();
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const report = logCollectorService.generateReport();
      const ta = document.createElement('textarea');
      ta.value = report;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, []);

  const hasIssues = stats.errors > 0 || stats.hasLastCrash;

  return (
    <div
      className="fixed bottom-3 right-3 z-[9990] select-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tooltip */}
      {hovered && !copied && (
        <div className="absolute bottom-full right-0 mb-1.5 whitespace-nowrap
                        bg-[#1a1a1a] border border-[#2a2a2a] rounded-md
                        px-2.5 py-1.5 text-[11px] text-[#888] shadow-lg shadow-black/40
                        pointer-events-none">
          <span className="text-[#aaa]">日志 {stats.total}</span>
          {stats.errors > 0 && <span className="text-red-400 ml-1.5">错误 {stats.errors}</span>}
          {stats.warns > 0 && <span className="text-yellow-500 ml-1.5">警告 {stats.warns}</span>}
          {stats.hasLastCrash && <span className="text-orange-400 ml-1.5">有崩溃记录</span>}
          <div className="text-[10px] text-[#555] mt-0.5">点击复制诊断报告</div>
        </div>
      )}

      {/* 复制成功反馈 */}
      {copied && (
        <div className="absolute bottom-full right-0 mb-1.5 whitespace-nowrap
                        bg-[#1a1a1a] border border-emerald-500/30 rounded-md
                        px-2.5 py-1.5 text-[11px] text-emerald-400 shadow-lg shadow-black/40
                        pointer-events-none">
          已复制诊断报告
        </div>
      )}

      {/* 按钮 */}
      <button
        onClick={handleCopy}
        title="复制诊断日志"
        className={`
          w-6 h-6 rounded flex items-center justify-center
          transition-all duration-150 cursor-pointer
          ${copied
            ? 'bg-emerald-500/15 text-emerald-400'
            : hasIssues
              ? 'bg-red-500/10 text-red-400/60 hover:text-red-400 hover:bg-red-500/20'
              : 'bg-transparent text-[#444] hover:text-[#777] hover:bg-[#1a1a1a]'
          }
        `}
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          </svg>
        )}
      </button>

      {/* 有问题时的小红点 */}
      {hasIssues && !copied && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-500/80" />
      )}
    </div>
  );
};

export default LogTips;
