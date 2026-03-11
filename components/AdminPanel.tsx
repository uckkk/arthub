import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, RefreshCw, Save, Key, ExternalLink, HelpCircle, CheckCircle } from 'lucide-react';
import { useToast } from './Toast';
import {
  isAdmin,
  fetchAccountList,
  addAccount,
  generateRandomPassword,
  verifyGitHubToken,
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
  const [showTutorial, setShowTutorial] = useState(false);
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenMessage, setTokenMessage] = useState('');

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
      setTokenValid(false);
      setTokenMessage(error.message || '验证失败');
      showToast('error', error.message || '验证失败');
    } finally {
      setVerifyingToken(false);
    }
  };

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
              <div className={`text-xs px-3 py-2 rounded-lg ${
                tokenValid === true 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                  : tokenValid === false
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              }`}>
                {tokenMessage}
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
