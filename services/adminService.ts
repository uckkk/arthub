// 管理员服务
// 用于管理用户账号和同步到GitHub

const ADMIN_USERNAME = '石头';
const CSV_URL = 'https://raw.githubusercontent.com/uckkk/ArtAssetNamingConfig/main/useID.csv';
const CSV_REPO_OWNER = 'uckkk';
const CSV_REPO_NAME = 'ArtAssetNamingConfig';
const CSV_FILE_PATH = 'useID.csv';

export interface AccountInfo {
  username: string;
  userId: string;
}

// 检查当前用户是否是管理员
export function isAdmin(): boolean {
  try {
    const userInfo = JSON.parse(localStorage.getItem('arthub_user_info') || '{}');
    return userInfo.username === ADMIN_USERNAME;
  } catch {
    return false;
  }
}

// 生成随机密码（18位数字）
export function generateRandomPassword(): string {
  // 生成18位数字：100000000000000000 到 999999999999999999
  // 使用字符串拼接避免JavaScript Number精度问题
  let password = '';
  // 第一位必须是1-9（确保是18位，不是17位）
  password += Math.floor(1 + Math.random() * 9).toString();
  // 剩余17位可以是0-9
  for (let i = 0; i < 17; i++) {
    password += Math.floor(Math.random() * 10).toString();
  }
  return password;
}

// 从GitHub获取账号列表
export async function fetchAccountList(): Promise<AccountInfo[]> {
  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__;
  
  if (isTauri) {
    // Tauri环境：通过Rust后端调用
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const accounts: [string, string][] = await invoke('fetch_account_list');
      return accounts.map(([username, userId]) => ({ username, userId }));
    } catch (error: any) {
      console.error('获取账号列表失败:', error);
      throw new Error(error.message || '获取账号列表失败');
    }
  } else {
    // 浏览器环境：直接调用GitHub
    try {
      const response = await fetch(CSV_URL);
      if (!response.ok) {
        throw new Error(`获取账号列表失败: HTTP ${response.status}`);
      }
      const csvText = await response.text();
      const lines = csvText.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      
      const accounts: AccountInfo[] = [];
      let isHeader = true;
      for (const line of lines) {
        if (isHeader) {
          isHeader = false;
          continue;
        }
        const parts = line.split(',').map(s => s.trim());
        if (parts.length >= 2 && parts[0] && parts[1]) {
          accounts.push({
            username: parts[0],
            userId: parts[1],
          });
        }
      }
      return accounts;
    } catch (error: any) {
      console.error('获取账号列表失败:', error);
      throw error;
    }
  }
}

// 将账号列表转换为CSV格式
function accountsToCSV(accounts: AccountInfo[]): string {
  const lines = ['用户名,ID,'];
  accounts.forEach(acc => {
    lines.push(`${acc.username},${acc.userId},`);
  });
  return lines.join('\n');
}

// 通过GitHub API更新CSV文件
export async function syncAccountToGitHub(
  accounts: AccountInfo[],
  githubToken: string
): Promise<void> {
  if (!githubToken) {
    throw new Error('请先配置GitHub Token');
  }

  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__;
  
  if (isTauri) {
    // Tauri环境：通过Rust后端调用
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const accountsArray: [string, string][] = accounts.map(acc => [acc.username, acc.userId]);
      await invoke('sync_account_to_github', {
        accounts: accountsArray,
        githubToken,
      });
    } catch (error: any) {
      console.error('同步到GitHub失败:', error);
      throw new Error(error.message || '同步到GitHub失败');
    }
  } else {
    // 浏览器环境：直接调用GitHub API（可能有CORS限制）
    try {
      // 1. 获取文件当前内容（用于获取SHA）
      const getFileUrl = `https://api.github.com/repos/${CSV_REPO_OWNER}/${CSV_REPO_NAME}/contents/${CSV_FILE_PATH}`;
      const getFileResponse = await fetch(getFileUrl, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!getFileResponse.ok) {
        throw new Error(`获取文件信息失败: HTTP ${getFileResponse.status}`);
      }

      const fileInfo = await getFileResponse.json();
      const currentSha = fileInfo.sha;

      // 2. 准备新内容
      const newContent = accountsToCSV(accounts);
      const encodedContent = btoa(unescape(encodeURIComponent(newContent)));

      // 3. 更新文件
      const updateFileUrl = `https://api.github.com/repos/${CSV_REPO_OWNER}/${CSV_REPO_NAME}/contents/${CSV_FILE_PATH}`;
      const updateResponse = await fetch(updateFileUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `更新账号列表: 添加新账号`,
          content: encodedContent,
          sha: currentSha,
        }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(`更新文件失败: ${errorData.message || `HTTP ${updateResponse.status}`}`);
      }

      return;
    } catch (error: any) {
      console.error('同步到GitHub失败:', error);
      throw error;
    }
  }
}

// 验证GitHub Token
export async function verifyGitHubToken(githubToken: string): Promise<{ valid: boolean; message: string }> {
  if (!githubToken.trim()) {
    return { valid: false, message: 'Token 不能为空' };
  }

  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__;
  
  try {
    if (isTauri) {
      // Tauri环境：通过Rust后端验证
      const { invoke } = await import('@tauri-apps/api/tauri');
      const result: { valid: boolean; message: string } = await invoke('verify_github_token', {
        githubToken: githubToken.trim(),
      });
      return result;
    } else {
      // 浏览器环境：直接调用GitHub API
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${githubToken.trim()}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (response.status === 401) {
        return { valid: false, message: 'Token 无效或已过期' };
      }
      if (response.status === 403) {
        return { valid: false, message: 'Token 权限不足，需要 repo 权限' };
      }
      if (!response.ok) {
        return { valid: false, message: `验证失败: HTTP ${response.status}` };
      }

      // 检查是否有repo权限
      const scopes = response.headers.get('X-OAuth-Scopes');
      if (!scopes || !scopes.includes('repo')) {
        return { valid: false, message: 'Token 缺少 repo 权限，请重新创建Token并勾选repo权限' };
      }

      const user = await response.json();
      return { valid: true, message: `Token 验证成功！用户: ${user.login}` };
    }
  } catch (error: any) {
    return { valid: false, message: `验证失败: ${error.message || '网络错误'}` };
  }
}

// 添加新账号
export async function addAccount(
  username: string,
  password: string,
  githubToken: string
): Promise<void> {
  if (!username.trim()) {
    throw new Error('用户名不能为空');
  }
  if (!password.trim()) {
    throw new Error('密码不能为空');
  }

  // 获取现有账号列表
  const accounts = await fetchAccountList();

  // 检查用户名是否已存在
  if (accounts.some(acc => acc.username === username)) {
    throw new Error(`用户名 "${username}" 已存在`);
  }

  // 添加新账号
  accounts.push({
    username: username.trim(),
    userId: password.trim(),
  });

  // 同步到GitHub
  await syncAccountToGitHub(accounts, githubToken);
}
