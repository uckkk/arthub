// MD5 实现（动态加载，避免单文件环境下的导入问题）
let md5Function: ((str: string) => string) | null = null;

const getMd5 = async (): Promise<(str: string) => string> => {
  if (md5Function) return md5Function;
  
  // 尝试从 CDN 加载（使用多个 CDN 源以提高可靠性）
  const cdnSources = [
    "https://esm.sh/blueimp-md5@2.19.0",
    "https://unpkg.com/blueimp-md5@2.19.0/js/md5.min.js"
  ];
  
  for (const cdnUrl of cdnSources) {
    try {
      const md5Module = await import(cdnUrl);
      // blueimp-md5 的导出方式可能是 default 或者直接导出
      md5Function = md5Module.default || md5Module.md5 || md5Module;
      
      // 验证是否是函数
      if (md5Function && typeof md5Function === 'function') {
        // 测试 MD5 函数是否正常工作
        const testResult = md5Function('test');
        if (testResult && typeof testResult === 'string' && testResult.length === 32) {
          console.log('✓ MD5 库加载成功');
          return md5Function;
        } else {
          console.warn(`MD5 函数测试失败，结果: ${testResult}`);
        }
      }
    } catch (error) {
      console.warn(`无法从 ${cdnUrl} 加载 MD5:`, error);
      continue;
    }
  }
  
  // 如果所有 CDN 都失败，抛出错误
  throw new Error("无法加载 MD5 库，请检查网络连接。百度翻译功能需要 MD5 库来计算签名。");
};

// 动态导入 @google/genai 以避免构建时的解析问题
// 使用字符串拼接避免 Vite 静态分析
const loadGoogleGenAI = async () => {
  try {
    // 使用字符串拼接，避免 Vite 在构建时解析
    const genaiPath = "@google" + "/genai";
    const module = await import(genaiPath);
    return module;
  } catch (error) {
    // 如果失败，尝试直接使用 CDN
    try {
      const module = await import("https://esm.sh/@google/genai@1.34.0");
      return module;
    } catch (e) {
      console.error("无法加载 @google/genai:", error, e);
      return null;
    }
  }
};

interface BaiduConfig {
  appId: string;
  secretKey: string;
}

// ============================================================================
//   JSONP 实现 (解决百度翻译 API 跨域问题)
// ============================================================================
const jsonp = (url: string, params: Record<string, string>): Promise<any> => {
  return new Promise((resolve, reject) => {
    // 生成唯一回调函数名
    const callbackName = 'baidu_callback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    
    // 挂载回调
    (window as any)[callbackName] = (data: any) => {
      cleanup();
      resolve(data);
    };

    // 清理函数
    const cleanup = () => {
      delete (window as any)[callbackName];
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    // 构造 URL
    const queryParams = new URLSearchParams(params);
    queryParams.set('callback', callbackName);
    
    const script = document.createElement('script');
    script.src = `${url}?${queryParams.toString()}`;
    script.async = true;

    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP request failed (Network error or blocked)'));
    };

    document.body.appendChild(script);
  });
};

// ============================================================================
//   Gemini 翻译服务
// ============================================================================
const translateWithGemini = async (text: string, apiKey: string): Promise<string> => {
  try {
    const genaiModule = await loadGoogleGenAI();
    if (!genaiModule) {
      throw new Error("无法加载 Google GenAI 模块");
    }
    
    const { GoogleGenAI, Type } = genaiModule;
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
      You are a professional Game Technical Artist. 
      Translate the following Chinese game asset name to English.
      Rules:
      1. Use PascalCase (Capitalize first letter of words).
      2. Keep it concise (e.g., "Wooden Box" -> "WoodenBox").
      3. Remove spaces and special characters.
      4. If the input is already English, just format it.
      5. Input text: "${text}"
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            englishName: { type: Type.STRING },
          },
        },
      },
    });

    const result = JSON.parse(response.text || '{}');
    return result.englishName || text;
  } catch (error) {
    console.error("Gemini 翻译失败:", error);
    throw error;
  }
};

// ============================================================================
//   百度翻译服务
// ============================================================================
const translateWithBaidu = async (text: string, config: BaiduConfig): Promise<string> => {
  try {
    // 验证配置
    if (!config.appId || !config.secretKey) {
      throw new Error("百度翻译配置不完整：请检查 AppID 和 SecretKey 是否正确填写");
    }

    const salt = Date.now().toString();
    
    // 加载 MD5 函数
    let md5Func: (str: string) => string;
    try {
      md5Func = await getMd5();
    } catch (error: any) {
      throw new Error(`无法加载 MD5 库: ${error.message}。请检查网络连接。`);
    }

    // 计算签名：appid + query + salt + secretKey（注意：顺序很重要！）
    const signString = config.appId + text + salt + config.secretKey;
    console.log('百度翻译签名计算:', {
      appId: config.appId,
      text: text.substring(0, 20) + '...',
      salt: salt,
      signStringLength: signString.length,
      secretKeyLength: config.secretKey.length
    });
    
    const sign = md5Func(signString);
    
    // 验证签名是否生成成功
    if (!sign || typeof sign !== 'string' || sign.length !== 32) {
      console.error('MD5 签名生成失败:', { sign, signType: typeof sign, signLength: sign?.length });
      throw new Error(`MD5 签名生成失败（长度: ${sign?.length}），请检查 MD5 库是否正确加载`);
    }
    
    console.log('百度翻译签名生成成功:', sign.substring(0, 8) + '...');
    
    const params = {
      q: text,
      from: 'zh',
      to: 'en',
      appid: config.appId,
      salt: salt,
      sign: sign,
    };

    // 使用 HTTPS 端点 + JSONP
    const url = `https://api.fanyi.baidu.com/api/trans/vip/translate`;
    
    const data = await jsonp(url, params);

    if (data.error_code) {
      // 提供更详细的错误信息
      const errorMsg = data.error_msg || '未知错误';
      if (data.error_code === '52003') {
        throw new Error(`Baidu Error [${data.error_code}]: ${errorMsg}。请检查：1) AppID 和 SecretKey 是否正确；2) 百度翻译服务是否已开通；3) 签名计算是否正确`);
      }
      throw new Error(`Baidu Error [${data.error_code}]: ${errorMsg}`);
    }

    if (data.trans_result && data.trans_result.length > 0) {
      const dst = data.trans_result[0].dst;
      return toPascalCase(dst);
    }
    
    return text;
  } catch (error) {
    console.error("百度翻译失败:", error);
    throw error;
  }
};

// 辅助：将句子转换为大驼峰
const toPascalCase = (str: string): string => {
  return str
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
};

// ============================================================================
//   主入口与优先级逻辑
// ============================================================================

/**
 * 确定当前使用的服务配置
 * 优先级: Gemini > Baidu
 * 如果只填了一个，使用那个；如果两个都填了，优先使用 Gemini
 */
const getActiveService = () => {
  const localGemini = localStorage.getItem('arthub_gemini_key');
  const localBaiduAppId = localStorage.getItem('arthub_baidu_appid');
  const localBaiduSecret = localStorage.getItem('arthub_baidu_secret');
  const envGemini = process.env.API_KEY;

  const hasGemini = !!(localGemini || envGemini);
  const hasBaidu = !!(localBaiduAppId && localBaiduSecret);

  // 优先使用 Gemini
  if (hasGemini) {
    return { type: 'gemini', key: localGemini || envGemini || '' };
  }

  // 如果没有 Gemini，使用 Baidu
  if (hasBaidu) {
    return { type: 'baidu', config: { appId: localBaiduAppId || '', secretKey: localBaiduSecret || '' } };
  }

  return null;
};

/**
 * 统一翻译入口
 * 自动判断已填写的 API，优先使用 Gemini，失败时自动降级到百度翻译
 */
export const translateAssetName = async (text: string): Promise<string> => {
  const localGemini = localStorage.getItem('arthub_gemini_key');
  const localBaiduAppId = localStorage.getItem('arthub_baidu_appid');
  const localBaiduSecret = localStorage.getItem('arthub_baidu_secret');
  const envGemini = process.env.API_KEY;

  const hasGemini = !!(localGemini || envGemini);
  const hasBaidu = !!(localBaiduAppId && localBaiduSecret);

  // 如果两个都填了，优先使用 Gemini，失败时降级到百度翻译
  if (hasGemini && hasBaidu) {
    try {
      const geminiKey = localGemini || envGemini || '';
      return await translateWithGemini(text, geminiKey);
    } catch (error) {
      console.warn("Gemini 翻译失败，降级使用百度翻译:", error);
      try {
        return await translateWithBaidu(text, { appId: localBaiduAppId || '', secretKey: localBaiduSecret || '' });
      } catch (baiduError) {
        console.warn("百度翻译也失败:", baiduError);
        return text;
      }
    }
  }

  // 如果只填了 Gemini
  if (hasGemini) {
    try {
      const geminiKey = localGemini || envGemini || '';
      return await translateWithGemini(text, geminiKey);
    } catch (error) {
      console.warn("Gemini 翻译失败:", error);
      return text;
    }
  }

  // 如果只填了百度翻译
  if (hasBaidu) {
    try {
      return await translateWithBaidu(text, { appId: localBaiduAppId || '', secretKey: localBaiduSecret || '' });
    } catch (error) {
      console.warn("百度翻译失败:", error);
      return text;
    }
  }

  console.warn("未配置任何翻译 API");
  return text;
};

/**
 * 测试 API 连接 (用于设置界面)
 * 按优先级测试：Gemini > Baidu
 * 如果两个都填了，优先测试 Gemini，失败时测试百度翻译
 */
export const testApiConnection = async (
  geminiKey?: string,
  baiduConfig?: { appId: string; secretKey: string }
): Promise<{ success: boolean; message: string; source?: string }> => {
    const testText = "测试";
    
    // 如果两个都填了，优先测试 Gemini，失败时测试百度翻译
    if (geminiKey && baiduConfig?.appId && baiduConfig?.secretKey) {
        try {
            await translateWithGemini(testText, geminiKey);
            return { success: true, message: "Gemini API 连接成功！", source: 'Gemini' };
        } catch (e: any) {
            // Gemini 失败，尝试百度翻译
            try {
                await translateWithBaidu(testText, baiduConfig);
                return { success: true, message: "Gemini 失败，但百度翻译连接成功！", source: 'Baidu' };
            } catch (baiduErr: any) {
                return { success: false, message: `Gemini 失败 (${e.message})，百度也失败 (${baiduErr.message})`, source: 'Both' };
            }
        }
    }

    // 如果只填了 Gemini
    if (geminiKey) {
        try {
            await translateWithGemini(testText, geminiKey);
            return { success: true, message: "Gemini API 连接成功！", source: 'Gemini' };
        } catch (e: any) {
            return { success: false, message: `Gemini 连接失败: ${e.message}`, source: 'Gemini' };
        }
    }

    // 如果只填了百度翻译
    if (baiduConfig?.appId && baiduConfig?.secretKey) {
        try {
            await translateWithBaidu(testText, baiduConfig);
            return { success: true, message: "百度翻译连接成功！", source: 'Baidu' };
        } catch (e: any) {
            return { success: false, message: `百度连接失败: ${e.message}`, source: 'Baidu' };
        }
    }

    return { success: false, message: "未输入任何有效配置", source: 'None' };
};