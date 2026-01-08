/**
 * 翻译 Hook
 * 处理名称的自动翻译逻辑
 */

import { useState, useEffect } from 'react';
import { translateAssetName } from '../../../services/translationService';

export function useTranslation(rawInput: string) {
  const [translatedPart, setTranslatedPart] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    if (rawInput.trim()) {
      if (/[\u4e00-\u9fa5]/.test(rawInput)) {
        setIsTranslating(true);
      }
    } else {
      setTranslatedPart('');
      setIsTranslating(false);
    }

    const timer = setTimeout(async () => {
      if (rawInput.trim()) {
        if (/[\u4e00-\u9fa5]/.test(rawInput)) {
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

  return { translatedPart, isTranslating };
}
