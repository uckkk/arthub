// 数据预加载服务 - 在后台静默加载所有需要的数据

// 预加载弹幕游戏命名数据（如果需要）
export const preloadNamingData = async () => {
  try {
    // 检查当前预设是否是弹幕游戏
    const currentPresetId = localStorage.getItem('arthub_naming_preset') || 'fgui_card';
    if (currentPresetId === 'fgui_danmaku') {
      // 预加载弹幕游戏数据
      const { fetchNamingData } = await import('./namingDataService');
      // 使用 requestIdleCallback 在浏览器空闲时加载
      if ('requestIdleCallback' in window) {
        requestIdleCallback(async () => {
          try {
            await fetchNamingData('fgui_danmaku');
          } catch (error) {
            console.warn('预加载弹幕游戏数据失败:', error);
          }
        }, { timeout: 3000 });
      } else {
        setTimeout(async () => {
          try {
            await fetchNamingData('fgui_danmaku');
          } catch (error) {
            console.warn('预加载弹幕游戏数据失败:', error);
          }
        }, 500);
      }
    }
  } catch (error) {
    console.warn('预加载命名数据失败:', error);
  }
};

// 预加载所有 localStorage 数据（快速操作，同步执行）
export const preloadLocalStorageData = () => {
  // 这些操作很快，不需要异步处理
  // 只是确保数据已经被读取到内存中
  try {
    // 预加载路径数据
    localStorage.getItem('arthub_paths');
    localStorage.getItem('arthub_group_order');
    localStorage.getItem('arthub_path_columns');
    
    // 预加载 AI 配置数据
    localStorage.getItem('arthub_ai_configs');
    
    // 预加载命名历史数据
    const currentPresetId = localStorage.getItem('arthub_naming_preset') || 'fgui_card';
    localStorage.getItem(`arthub_naming_history_${currentPresetId}`);
    
    // 预加载收藏数据
    localStorage.getItem('arthub_favorites');
    
    // 预加载快速路径数据
    localStorage.getItem(`arthub_quick_paths_${currentPresetId}`);
  } catch (error) {
    console.warn('预加载 localStorage 数据失败:', error);
  }
};

// 预加载设置面板相关数据
export const preloadSettingsData = () => {
  try {
    // 预加载设置相关的 localStorage 数据
    localStorage.getItem('arthub_gemini_key');
    localStorage.getItem('arthub_baidu_appid');
    localStorage.getItem('arthub_baidu_secret');
    localStorage.getItem('arthub_file_storage_config');
  } catch (error) {
    console.warn('预加载设置数据失败:', error);
  }
};

// 预加载所有数据
export const preloadAllData = async () => {
  // 先尝试从文件导入数据（如果已启用文件存储）
  try {
    const { autoImportFromFile } = await import('./fileStorageService');
    await autoImportFromFile();
  } catch (error) {
    // 静默处理导入错误
    console.warn('预加载时导入文件数据失败:', error);
  }
  
  // 然后预加载 localStorage 数据（快速）
  preloadLocalStorageData();
  preloadSettingsData();
  
  // 最后预加载需要网络请求的数据（延迟执行）
  setTimeout(() => {
    preloadNamingData();
  }, 100);
};
