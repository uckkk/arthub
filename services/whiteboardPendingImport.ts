// 画布待导入队列：截图/录屏结果先入队，不跳转；画布在挂载或收到事件时统一处理并整齐排列

const PENDING_KEY = 'arthub_pending_whiteboard_imports';

export function addPendingImport(filePath: string): void {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY) || '[]';
    const arr: string[] = JSON.parse(raw);
    arr.push(filePath);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(arr));
    window.dispatchEvent(new CustomEvent('arthub-process-pending-imports'));
  } catch {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify([filePath]));
    window.dispatchEvent(new CustomEvent('arthub-process-pending-imports'));
  }
}

export function getPendingImports(): string[] {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY) || '[]';
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function clearPendingImports(): void {
  sessionStorage.removeItem(PENDING_KEY);
}
