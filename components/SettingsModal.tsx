import React, { useState, useEffect } from 'react';
import { Key, Save, X, ExternalLink } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const savedKey = localStorage.getItem('arthub_api_key') || '';
      setApiKey(savedKey);
      setIsSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('arthub_api_key', apiKey.trim());
    setIsSaved(true);
    setTimeout(() => {
        setIsSaved(false);
        onClose();
    }, 1000);
  };

  const handleClear = () => {
      localStorage.removeItem('arthub_api_key');
      setApiKey('');
  }

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-md p-6 relative">
        <button 
            onClick={onClose}
            className="absolute right-4 top-4 text-slate-500 hover:text-white"
        >
            <X size={20} />
        </button>

        <div className="flex items-center gap-2 mb-6 text-white">
            <Key className="text-blue-400" size={24} />
            <h3 className="text-xl font-bold">系统设置</h3>
        </div>

        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                    Gemini API Key
                </label>
                <div className="relative">
                    <input 
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                        placeholder="输入 AI Studio API Key..."
                    />
                </div>
                <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                    用于启用自动翻译功能。
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline flex items-center">
                        获取 Key <ExternalLink size={10} className="ml-0.5" />
                    </a>
                </p>
            </div>

            {/* 状态反馈 */}
            <div className="bg-slate-900/50 p-3 rounded text-xs text-slate-400 border border-slate-800">
                <p>提示：Key 将存储在浏览器本地（LocalStorage），不会上传到任何第三方服务器，请放心分发给同事使用。</p>
            </div>
        </div>

        <div className="flex justify-between items-center mt-8">
            <button 
                onClick={handleClear}
                className="text-xs text-red-400 hover:text-red-300"
            >
                清除保存的 Key
            </button>
            <div className="flex gap-3">
                <button 
                    onClick={onClose}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                >
                    取消
                </button>
                <button 
                    onClick={handleSave}
                    className={`px-4 py-2 text-sm text-white rounded-lg shadow-lg flex items-center gap-2 transition-all ${isSaved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500'}`}
                >
                    {isSaved ? '已保存' : '保存设置'}
                    {!isSaved && <Save size={16} />}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;