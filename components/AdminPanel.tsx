import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, RefreshCw, Save, Key, ExternalLink, HelpCircle, CheckCircle, Edit2, Copy, AlertCircle } from 'lucide-react';
import { useToast } from './Toast';
import {
  isAdmin,
  fetchAccountList,
  addAccount,
  deleteAccount,
  updateAccount,
  generateRandomPassword,
  verifyGitHubToken,
  AccountInfo,
} from '../services/adminService';
import { logCollectorService } from '../services/logCollectorService';
import { consoleService } from '../services/consoleService';

interface AdminPanelProps {
  onClose: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ onClose }) => {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [githubToken, setGithubToken] = useState(() => {
    return localStorage.getItem('arthub_github_token') || '';
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenMessage, setTokenMessage] = useState('');
  const [editingAccount, setEditingAccount] = useState<AccountInfo | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [adminErrors, setAdminErrors] = useState<Array<{ timestamp: string; operation: string; error: string; details?: any }>>([]);
  const [copied, setCopied] = useState(false);

  // 记录管理员错误
  const recordError = useCallback((operation: string, error: any, details?: any) => {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      operation,
      error: error?.message || String(error),
      details,
    };
    setAdminErrors(prev => [...prev, errorEntry]);
    // 同时记录到全局日志服务
    consoleService.addLog('error', [
      `[管理员面板] ${operation} 失败`,
      error?.message || String(error),
      details ? JSON.stringify(details, null, 2) : undefined,
    ].filter(Boolean) as any);
  }, []);

  useEffect(() => {
    if (!isAdmin()) {
      showToast('error', '您没有管理员权限');
      onClose();
      return;
    }
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const accountList = await fetchAccountList();
      setAccounts(accountList);
    } catch (error: any) {
      const errorMsg = `加载账号列表失败: ${error.message}`;
      showToast('error', errorMsg);
      recordError('加载账号列表', error, { stack: error.stack });
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePassword = () => {
    setNewPassword(generateRandomPassword());
  };

  const handleAddAccount = async () => {
    if (!newUsername.trim()) {
      showToast('error', '请输入用户名');
      return;
    }
    if (!newPassword.trim()) {
      showToast('error', '请生成或输入密码');
      return;
    }
    if (!githubToken.trim()) {
      showToast('error', '请先配置GitHub Token');
      return;
    }

    setLoading(true);
    try {
      await addAccount(newUsername, newPassword, githubToken);
      showToast('success', `账号 "${newUsername}" 已创建，密码: ${newPassword}`);
      setNewUsername('');
      setNewPassword('');
      await loadAccounts();
    } catch (error: any) {
      const errorMsg = `创建账号失败: ${error.message}`;
      showToast('error', errorMsg);
      recordError('创建账号', error, { username: newUsername });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async (username: string) => {
    if (!window.confirm(`确定要删除账号 "${username}" 吗？\n\n此操作将同步到GitHub，无法撤销。`)) {
      return;
    }

    if (!githubToken.trim()) {
      showToast('error', '请先配置GitHub Token');
      return;
    }

    setLoading(true);
    try {
      await deleteAccount(username, githubToken);
      showToast('success', `账号 "${username}" 已删除`);
      await loadAccounts();
    } catch (error: any) {
      const errorMsg = `删除账号失败: ${error.message}`;
      showToast('error', errorMsg);
      recordError('删除账号', error, { username });
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (account: AccountInfo) => {
    setEditingAccount(account);
    setEditUsername(account.username);
    setEditPassword(account.userId);
  };

  const handleCancelEdit = () => {
    setEditingAccount(null);
    setEditUsername('');
    setEditPassword('');
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    if (!editUsername.trim()) {
      showToast('error', '请输入用户名');
      return;
    }
    if (!editPassword.trim()) {
      showToast('error', '请输入密码');
      return;
    }
    if (!githubToken.trim()) {
      showToast('error', '请先配置GitHub Token');
      return;
    }

    setLoading(true);
    try {
      await updateAccount(editingAccount.username, editUsername, editPassword, githubToken);
      showToast('success', `账号已更新：${editUsername}`);
      handleCancelEdit();
      await loadAccounts();
    } catch (error: any) {
      const errorMsg = `更新账号失败: ${error.message}`;
      showToast('error', errorMsg);
      recordError('更新账号', error, { oldUsername: editingAccount.username, newUsername: editUsername });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToken = () => {
    if (githubToken.trim()) {
      localStorage.setItem('arthub_github_token', githubToken.trim());
      showToast('success', 'GitHub Token 已保存');
      setTokenValid(null);
      setTokenMessage('');
    } else {
      showToast('error', '请输入GitHub Token');
    }
  };

  const handleVerifyToken = async () => {
    if (!githubToken.trim()) {
      showToast('error', '请先输入GitHub Token');
      return;
    }

    setVerifyingToken(true);
    setTokenValid(null);
    setTokenMessage('');

    try {
      const result = await verifyGitHubToken(githubToken);
      setTokenValid(result.valid);
      setTokenMessage(result.message);
      if (result.valid) {
        showToast('success', result.message);
        localStorage.setItem('arthub_github_token', githubToken.trim());
      } else {
        showToast('error', result.message);
      }
    } catch (error: any) {
      const errorMsg = error.message || '验证失败';
      setTokenValid(false);
      setTokenMessage(errorMsg);
      showToast('error', errorMsg);
      recordError('验证Token', error, { tokenLength: githubToken.length });
    } finally {
      setVerifyingToken(false);
    }
  };

  // 生成管理员错误报告
  const generateAdminErrorReport = useCallback((): string => {
    const lines: string[] = [];
    const hr = '─'.repeat(60);

    lines.push(`${hr}`);
    lines.push(`管理员面板错误诊断报告`);
    lines.push(`生成时间: ${new Date().toLocaleString('zh-CN')}`);
    lines.push(`${hr}`);
    lines.push('');

    // 系统信息
    lines.push('## 系统环境');
    lines.push(`  UA: ${navigator.userAgent}`);
    lines.push(`  屏幕: ${screen.width}×${screen.height} (DPI: ${devicePixelRatio})`);
    lines.push(`  当前Token长度: ${githubToken.length > 0 ? githubToken.length + ' 字符' : '未设置'}`);
    lines.push(`  Token前缀: ${githubToken.trim().substring(0, 4)}...`);
    lines.push('');

    // 管理员错误统计
    lines.push(`## 管理员操作错误统计`);
    lines.push(`  总错误数: ${adminErrors.length}`);
    const errorByOperation = adminErrors.reduce((acc, err) => {
      acc[err.operation] = (acc[err.operation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    Object.entries(errorByOperation).forEach(([op, count]) => {
      lines.push(`  ${op}: ${count} 次`);
    });
    lines.push('');

    // 详细错误日志
    if (adminErrors.length > 0) {
      lines.push('## 详细错误日志');
      adminErrors.forEach((err, index) => {
        lines.push('');
        lines.push(`### 错误 #${index + 1}`);
        lines.push(`  时间: ${new Date(err.timestamp).toLocaleString('zh-CN')}`);
        lines.push(`  操作: ${err.operation}`);
        lines.push(`  错误: ${err.error}`);
        if (err.details) {
          lines.push(`  详情:`);
          try {
            const detailsStr = typeof err.details === 'string' ? err.details : JSON.stringify(err.details, null, 2);
            detailsStr.split('\n').forEach(line => {
              lines.push(`    ${line}`);
            });
          } catch {
            lines.push(`    ${String(err.details)}`);
          }
        }
      });
      lines.push('');
    }

    // 全局日志（最近的管理员相关错误）
    const allLogs = consoleService.getLogs();
    const adminLogs = allLogs.filter(log => 
      log.message.includes('[管理员面板]') || 
      log.message.includes('管理员') ||
      log.message.includes('Token') ||
      log.message.includes('GitHub')
    );
    
    if (adminLogs.length > 0) {
      lines.push('## 全局日志中的管理员相关错误 (最近50条)');
      adminLogs.slice(-50).forEach(log => {
        const time = new Date(log.timestamp).toLocaleTimeString('zh-CN');
        const type = log.type.toUpperCase().padEnd(5);
        lines.push(`  [${time}] [${type}] ${log.message}`);
        if (log.args && log.args.length > 0) {
          log.args.forEach(arg => {
            if (typeof arg === 'string') {
              lines.push(`    ${arg}`);
            } else if (typeof arg === 'object') {
              try {
                lines.push(`    ${JSON.stringify(arg, null, 2).split('\n').join('\n    ')}`);
              } catch {
                lines.push(`    [无法序列化对象]`);
              }
            }
          });
        }
      });
      lines.push('');
    }

    // 完整诊断报告（复用主界面的日志收集服务）
    lines.push(`${hr}`);
    lines.push('## 完整系统诊断报告');
    lines.push(logCollectorService.generateReport());

    lines.push('');
    lines.push(`${hr}`);
    lines.push('报告结束');
    return lines.join('\n');
  }, [adminErrors, githubToken]);

  // 复制错误报告
  const handleCopyErrorReport = useCallback(async () => {
    try {
      const report = generateAdminErrorReport();
      await navigator.clipboard.writeText(report);
      setCopied(true);
      showToast('success', '错误报告已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 降级方案
      const report = generateAdminErrorReport();
      const ta = document.createElement('textarea');
      ta.value = report;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      showToast('success', '错误报告已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    }
  }, [generateAdminErrorReport, showToast]);

  const openTokenCreationPage = () => {
    window.open('https://github.com/settings/tokens/new', '_blank');
  };

  if (!isAdmin()) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#151515] border border-[#2a2a2a] rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <h2 className="text-lg font-semibold text-white">管理员面板 - 账号管理</h2>
          <div className="flex items-center gap-2">
            {adminErrors.length > 0 && (
              <button
                onClick={handleCopyErrorReport}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-1.5 ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30'
                }`}
                title="复制错误报告"
              >
                {copied ? (
                  <>
                    <CheckCircle size={12} />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    复制错误 ({adminErrors.length})
                  </>
                )}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#666] hover:text-white hover:bg-[#252525] transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* GitHub Token 配置 */}
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key size={16} className="text-blue-400" />
                <h3 className="text-sm font-medium text-white">GitHub Token 配置</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={openTokenCreationPage}
                  className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-1.5"
                  title="打开GitHub创建Token页面"
                >
                  <ExternalLink size={12} />
                  申请Token
                </button>
                <button
                  onClick={() => setShowTutorial(true)}
                  className="p-1.5 rounded text-[#666] hover:text-blue-400 hover:bg-[#252525] transition-colors"
                  title="查看设置教程"
                >
                  <HelpCircle size={16} />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={githubToken}
                onChange={(e) => {
                  setGithubToken(e.target.value);
                  setTokenValid(null);
                  setTokenMessage('');
                }}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="flex-1 px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleVerifyToken}
                disabled={verifyingToken || !githubToken.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-[#2a2a2a] disabled:text-[#666] text-white rounded-lg transition-colors flex items-center gap-2"
                title="验证Token连接和权限"
              >
                {verifyingToken ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    验证中...
                  </>
                ) : (
                  <>
                    <CheckCircle size={14} />
                    验证
                  </>
                )}
              </button>
              <button
                onClick={handleSaveToken}
                disabled={!githubToken.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-[#2a2a2a] disabled:text-[#666] text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <Save size={14} />
                保存
              </button>
            </div>
            {tokenMessage && (
              <div className={`text-xs px-3 py-2 rounded-lg flex items-start gap-2 ${
                tokenValid === true 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                  : tokenValid === false
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              }`}>
                {tokenValid === false && (
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                )}
                <span className="flex-1">{tokenMessage}</span>
              </div>
            )}
          </div>

          {/* 教程弹窗 */}
          {showTutorial && (
            <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
              <div className="w-full max-w-lg bg-[#151515] border border-[#2a2a2a] rounded-xl shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
                  <h3 className="text-lg font-semibold text-white">GitHub Token 设置教程</h3>
                  <button
                    onClick={() => setShowTutorial(false)}
                    className="p-1.5 rounded-lg text-[#666] hover:text-white hover:bg-[#252525] transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                  <div className="space-y-3 text-sm text-[#ccc]">
                    <div>
                      <h4 className="text-white font-medium mb-2">步骤 1：打开GitHub设置</h4>
                      <p className="text-[#888]">点击上方的"申请Token"按钮，或访问：</p>
                      <a 
                        href="https://github.com/settings/tokens/new" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
                      >
                        https://github.com/settings/tokens/new
                        <ExternalLink size={12} />
                      </a>
                    </div>
                    <div>
                      <h4 className="text-white font-medium mb-2">步骤 2：填写Token信息</h4>
                      <ul className="list-disc list-inside space-y-1 text-[#888] ml-2">
                        <li><strong className="text-white">Note（备注）</strong>：填写一个描述，如"ArtHub账号管理"</li>
                        <li><strong className="text-white">Expiration（过期时间）</strong>：选择过期时间，建议选择较长时间或"Never"</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-white font-medium mb-2">步骤 3：选择权限</h4>
                      <p className="text-[#888] mb-2">在权限列表中，找到 <strong className="text-white">"repo"</strong> 部分，勾选：</p>
                      <ul className="list-disc list-inside space-y-1 text-[#888] ml-2">
                        <li><strong className="text-white">repo</strong> - 完整仓库访问权限（必需）</li>
                      </ul>
                      <p className="text-[#888] mt-2 text-xs">⚠️ 注意：必须勾选 repo 权限，否则无法同步账号到GitHub</p>
                    </div>
                    <div>
                      <h4 className="text-white font-medium mb-2">步骤 4：生成Token</h4>
                      <p className="text-[#888]">点击页面底部的 <strong className="text-white">"Generate token"</strong> 按钮</p>
                    </div>
                    <div>
                      <h4 className="text-white font-medium mb-2">步骤 5：复制Token</h4>
                      <p className="text-[#888] mb-2">生成后，GitHub会显示你的Token（以 <code className="bg-[#0f0f0f] px-1 py-0.5 rounded text-xs">ghp_</code> 开头）</p>
                      <p className="text-[#888] text-xs">⚠️ 重要：Token只会显示一次，请立即复制并保存到安全的地方</p>
                    </div>
                    <div>
                      <h4 className="text-white font-medium mb-2">步骤 6：粘贴并验证</h4>
                      <p className="text-[#888]">将Token粘贴到上方的输入框中，点击"验证"按钮确认连接和权限是否正常</p>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-[#2a2a2a] flex justify-end">
                  <button
                    onClick={() => setShowTutorial(false)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    我知道了
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 添加新账号 */}
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Plus size={16} className="text-green-400" />
              <h3 className="text-sm font-medium text-white">添加新账号</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#888] mb-1.5">用户名</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="输入用户名"
                  className="w-full px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-[#888] mb-1.5">密码（ID）</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="点击生成随机密码"
                    readOnly
                    className="flex-1 px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleGeneratePassword}
                    className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] text-white rounded-lg transition-colors text-xs"
                    title="生成随机18位密码"
                  >
                    生成
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={handleAddAccount}
              disabled={loading || !newUsername || !newPassword}
              className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-[#2a2a2a] disabled:text-[#666] text-white rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Plus size={14} />
                  创建账号并同步到GitHub
                </>
              )}
            </button>
          </div>

          {/* 编辑账号模态框 */}
          {editingAccount && (
            <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
              <div className="w-full max-w-md bg-[#151515] border border-[#2a2a2a] rounded-xl shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
                  <h3 className="text-lg font-semibold text-white">编辑账号</h3>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1.5 rounded-lg text-[#666] hover:text-white hover:bg-[#252525] transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="px-6 py-4 space-y-4">
                  <div>
                    <label className="block text-xs text-[#888] mb-1.5">用户名</label>
                    <input
                      type="text"
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                      placeholder="输入用户名"
                      className="w-full px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#888] mb-1.5">密码（ID）</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        placeholder="输入18位密码"
                        className="flex-1 px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={() => setEditPassword(generateRandomPassword())}
                        className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] text-white rounded-lg transition-colors text-xs"
                        title="生成随机18位密码"
                      >
                        生成
                      </button>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-[#2a2a2a] flex justify-end gap-3">
                  <button
                    onClick={handleCancelEdit}
                    className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#333] text-white rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={loading || !editUsername || !editPassword}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-[#2a2a2a] disabled:text-[#666] text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        保存中...
                      </>
                    ) : (
                      <>
                        <Save size={14} />
                        保存并同步到GitHub
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 账号列表 */}
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw size={16} className="text-blue-400" />
                <h3 className="text-sm font-medium text-white">账号列表</h3>
              </div>
              <button
                onClick={loadAccounts}
                disabled={loading}
                className="px-3 py-1.5 text-xs bg-[#2a2a2a] hover:bg-[#333] text-white rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {accounts.length === 0 ? (
                <div className="text-center py-8 text-[#666] text-sm">暂无账号</div>
              ) : (
                accounts.map((account, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between px-3 py-2 bg-[#0f0f0f] rounded-lg group hover:bg-[#151515] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">{account.username}</div>
                      <div className="text-xs text-[#666] font-mono truncate">{account.userId}</div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleStartEdit(account)}
                        className="p-1.5 rounded text-[#666] hover:text-blue-400 hover:bg-[#2a2a2a] transition-colors"
                        title="编辑账号"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteAccount(account.username)}
                        disabled={loading}
                        className="p-1.5 rounded text-[#666] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        title="删除账号"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
