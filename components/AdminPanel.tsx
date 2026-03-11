import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, RefreshCw, Save, Key } from 'lucide-react';
import { useToast } from './Toast';
import {
  isAdmin,
  fetchAccountList,
  addAccount,
  generateRandomPassword,
  AccountInfo,
} from '../services/adminService';

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
  const [showTokenInput, setShowTokenInput] = useState(!githubToken);

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
      showToast('error', `加载账号列表失败: ${error.message}`);
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
      setShowTokenInput(true);
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
      showToast('error', `创建账号失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToken = () => {
    if (githubToken.trim()) {
      localStorage.setItem('arthub_github_token', githubToken.trim());
      showToast('success', 'GitHub Token 已保存');
      setShowTokenInput(false);
    } else {
      showToast('error', '请输入GitHub Token');
    }
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
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#666] hover:text-white hover:bg-[#252525] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* GitHub Token 配置 */}
          {showTokenInput && (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Key size={16} className="text-blue-400" />
                <h3 className="text-sm font-medium text-white">GitHub Token 配置</h3>
              </div>
              <p className="text-xs text-[#888]">
                需要 GitHub Personal Access Token 才能同步账号到 GitHub。
                <br />
                创建Token: Settings → Developer settings → Personal access tokens → Tokens (classic)
                <br />
                权限需要: repo (完整仓库访问权限)
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="flex-1 px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleSaveToken}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <Save size={14} />
                  保存
                </button>
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
                    title="生成随机8位密码"
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
                    className="flex items-center justify-between px-3 py-2 bg-[#0f0f0f] rounded-lg"
                  >
                    <div>
                      <div className="text-sm text-white font-medium">{account.username}</div>
                      <div className="text-xs text-[#666] font-mono">{account.userId}</div>
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
