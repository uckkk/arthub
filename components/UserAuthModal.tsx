import React, { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { verifyUser, saveUserInfo, getUserInfo } from '../services/userAuthService';

interface UserAuthModalProps {
  onVerified: () => void;
}

const UserAuthModal: React.FC<UserAuthModalProps> = ({ onVerified }) => {
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [isFirstTime, setIsFirstTime] = useState(true);

  useEffect(() => {
    // 检查是否已有保存的用户信息
    const savedUser = getUserInfo();
    if (savedUser) {
      setIsFirstTime(false);
      setUsername(savedUser.username);
      setUserId(savedUser.userId);
      // 自动验证已保存的用户
      handleVerify(savedUser.username, savedUser.userId);
    }
  }, []);

  const handleVerify = async (user: string, id: string) => {
    if (!user.trim() || !id.trim()) {
      setError('请输入用户名和ID');
      return;
    }

    setIsVerifying(true);
    setError('');

    try {
      const isValid = await verifyUser(user, id);
      if (isValid) {
        saveUserInfo({ username: user, userId: id });
        onVerified();
      } else {
        setError('用户名和ID不匹配，请联系"石头"');
      }
    } catch (err) {
      setError('验证失败，请检查网络连接后重试');
      console.error('Verification error:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleVerify(username, userId);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl border border-slate-700 w-full max-w-md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">
              掼蛋工作室ArtHub
            </h2>
            {!isFirstTime && (
              <button
                onClick={() => window.location.reload()}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="请输入用户名"
                disabled={isVerifying}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                用户ID
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="请输入用户ID"
                disabled={isVerifying}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifying || !username.trim() || !userId.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  <span>验证中...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  <span>验证</span>
                </>
              )}
            </button>
          </form>

          {isFirstTime && (
            <p className="mt-4 text-xs text-slate-500 text-center">
              首次使用需要输入用户名和ID进行验证
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserAuthModal;

