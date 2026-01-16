import React from 'react';
import { X, Save, Upload } from 'lucide-react';
import { PathType } from '../types';

const S_L = '/';
const B_L = '\\';

const OPACITY_CLASSES = {
  bgBlack70: 'bg-black' + S_L + '70',
  shadowBlack50: 'shadow-black' + S_L + '50',
};

interface ConfirmDragModalProps {
  showDragModal: boolean;
  draggedPath: { path: string; name?: string; type?: PathType } | null;
  newGroup: string;
  setNewGroup: (value: string) => void;
  dragGroupOptions: React.ReactElement[];
  onClose: () => void;
  onConfirm: () => void;
}

export const ConfirmDragModal: React.FC<ConfirmDragModalProps> = ({
  showDragModal,
  draggedPath,
  newGroup,
  setNewGroup,
  dragGroupOptions,
  onClose,
  onConfirm,
}) => {
  if (!showDragModal || !draggedPath) {
    return null;
  }

  return (
    <div 
      className={'fixed inset-0 z-50 flex items-center justify-center ' + OPACITY_CLASSES.bgBlack70 + ' backdrop-blur-sm'}
      onClick={onClose}
    >
      <div 
        className={'w-full max-w-md mx-4 bg-[#151515] border border-[#2a2a2a] rounded-xl shadow-2xl ' + OPACITY_CLASSES.shadowBlack50 + ' animate-scale-in'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <h3 className="text-lg font-semibold text-white">添加路径</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#666666] hover:text-white hover:bg-[#252525] transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <div className="p-4 bg-[#0f0f0f] rounded-lg border border-[#2a2a2a]">
            <div className="flex items-center gap-2 mb-2">
              <Upload size={16} className="text-blue-400" />
              <span className="text-sm font-medium text-[#a0a0a0]">检测到的路径</span>
            </div>
            <p className="text-sm text-white font-mono break-all">{draggedPath.path}</p>
            {draggedPath.name && (
              <p className="text-xs text-[#666666] mt-1">建议名称: {draggedPath.name}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#a0a0a0] mb-2">分组名称</label>
            <input 
              list="drag-groups-list"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-[#0f0f0f] border border-[#2a2a2a] text-white placeholder-[#666666] focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="例如：工作目录（留空则为默认分组）"
            />
            <datalist id="drag-groups-list">
              {dragGroupOptions}
            </datalist>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2a2a2a]">
          <button 
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#a0a0a0] hover:text-white hover:border-[#3a3a3a] transition-colors font-medium"
          >
            取消
          </button>
          <button 
            onClick={onConfirm}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            <Save size={16} />
            添加
          </button>
        </div>
      </div>
    </div>
  );
};
