/**
 * 翻译 Hook
 * 处理名称的自动翻译逻辑
 */

import { useState, useEffect } from 'react';
import { 
  translateAssetName, 
  checkTranslationApiStatus, 
  containsChinese 
} from '../../../services/translationService';

interface UseTranslationResult {
  translatedPart: string;
  isTranslating: boolean;
  needsApiSetup: boolean;  // 是否需要配置 API（输入中文但未配置）
}

export function useTranslation(rawInput: string): UseTranslationResult {
  const [translatedPart, setTranslatedPart] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [needsApiSetup, setNeedsApiSetup] = useState(false);

  useEffect(() => {
    const hasChinese = containsChinese(rawInput);
    const apiStatus = checkTranslationApiStatus();

    // 如果输入了中文但没有配置 API
    if (hasChinese && !apiStatus.hasApi) {
      setNeedsApiSetup(true);
      setTranslatedPart(rawInput.replace(/\s+/g, ''));
      setIsTranslating(false);
      return;
    } else {
      setNeedsApiSetup(false);
    }

    if (rawInput.trim()) {
      if (hasChinese) {
        setIsTranslating(true);
      }
    } else {
      setTranslatedPart('');
      setIsTranslating(false);
    }

    const timer = setTimeout(async () => {
      if (rawInput.trim()) {
        if (hasChinese && apiStatus.hasApi) {
          const result = await translateAssetName(rawInput);
          setTranslatedPart(result);
        } else {
          setTranslatedPart(rawInput.replace(/\s+/g, ''));
        }
        setIsTranslating(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [rawInput]);

  return { translatedPart, isTranslating, needsApiSetup };
}
