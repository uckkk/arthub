/**
 * 预设加载 Hook
 * 处理传统模板的预设数据加载
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchNamingData, parseCsvToPresets, getPresetLabel } from '../../../services/namingDataService';
import { NamingPreset, NamingSubType } from '../../../types';

export function usePresetLoader(presetId: string) {
  const [preset, setPreset] = useState<NamingPreset | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedControlCategory, setSelectedControlCategory] = useState<NamingSubType | undefined>(undefined);
  const [selectedAssetType, setSelectedAssetType] = useState<NamingSubType | undefined>(undefined);

  const loadPreset = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && preset) {
      // 如果已有预设且未强制刷新，只初始化选择
      const controlGroup = preset.categories.find(c => c.id === 'control_categories');
      const assetGroup = preset.categories.find(c => c.id === 'asset_types');
      
      if (controlGroup && controlGroup.subTypes && controlGroup.subTypes.length > 0 && !selectedControlCategory) {
        const savedControlCategoryId = localStorage.getItem(`arthub_${presetId}_control_category_id`);
        const savedControlCategory = savedControlCategoryId 
          ? controlGroup.subTypes.find(s => s.id === savedControlCategoryId)
          : null;
        setSelectedControlCategory(savedControlCategory || controlGroup.subTypes[0]);
      }
      if (assetGroup && assetGroup.subTypes && assetGroup.subTypes.length > 0 && !selectedAssetType) {
        const savedAssetTypeId = localStorage.getItem(`arthub_${presetId}_asset_type_id`);
        const savedAssetType = savedAssetTypeId 
          ? assetGroup.subTypes.find(s => s.id === savedAssetTypeId)
          : null;
        setSelectedAssetType(savedAssetType || assetGroup.subTypes[0]);
      }
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const csvData = await fetchNamingData(presetId);
      const presetLabel = getPresetLabel(presetId);
      const loadedPreset = parseCsvToPresets(csvData, presetId, presetLabel);
      
      setPreset(loadedPreset);

      // 初始化选择
      const controlGroup = loadedPreset.categories.find(c => c.id === 'control_categories');
      const assetGroup = loadedPreset.categories.find(c => c.id === 'asset_types');
      
      if (controlGroup && controlGroup.subTypes && controlGroup.subTypes.length > 0) {
        const savedControlCategoryId = localStorage.getItem(`arthub_${presetId}_control_category_id`);
        const savedControlCategory = savedControlCategoryId 
          ? controlGroup.subTypes.find(s => s.id === savedControlCategoryId)
          : null;
        setSelectedControlCategory(savedControlCategory || controlGroup.subTypes[0]);
      }
      if (assetGroup && assetGroup.subTypes && assetGroup.subTypes.length > 0) {
        const savedAssetTypeId = localStorage.getItem(`arthub_${presetId}_asset_type_id`);
        const savedAssetType = savedAssetTypeId 
          ? assetGroup.subTypes.find(s => s.id === savedAssetTypeId)
          : null;
        setSelectedAssetType(savedAssetType || assetGroup.subTypes[0]);
      }
    } catch (err) {
      console.error('Error loading preset:', err);
      setError('加载数据失败，请检查网络连接');
    } finally {
      setIsLoading(false);
    }
  }, [presetId, preset, selectedControlCategory, selectedAssetType]);

  useEffect(() => {
    loadPreset();
  }, [presetId]);

  return {
    preset,
    isLoading,
    error,
    selectedControlCategory,
    selectedAssetType,
    setSelectedControlCategory,
    setSelectedAssetType,
    reload: () => loadPreset(true),
  };
}
