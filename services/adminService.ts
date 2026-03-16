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
    // 浏览器环境：通过 GitHub Contents API 获取（无缓存延迟）
    try {
      const token = localStorage.getItem('arthub_github_token') || '';
      const apiUrl = `https://api.github.com/repos/${CSV_REPO_OWNER}/${CSV_REPO_NAME}/contents/${CSV_FILE_PATH}`;
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3.raw',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }

      let csvText: string;
      const apiResponse = await fetch(apiUrl, { headers });

      if (apiResponse.ok) {
        csvText = await apiResponse.text();
      } else {
        // API 失败时降级到 raw URL（加时间戳绕过缓存）
        const rawUrl = `${CSV_URL}?t=${Date.now()}`;
        const rawResponse = await fetch(rawUrl);
        if (!rawResponse.ok) {
          throw new Error(`获取账号列表失败: HTTP ${rawResponse.status}`);
        }
        csvText = await rawResponse.text();
      }

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
          'Authorization': `Bearer ${githubToken.trim()}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!getFileResponse.ok) {
        let errorMessage = `获取文件信息失败: HTTP ${getFileResponse.status}`;
        if (getFileResponse.status === 403) {
          errorMessage += ' Forbidden。可能的原因：\n1. Token缺少repo权限\n2. Token已过期或无效\n3. 仓库访问权限不足\n\n请检查Token权限并重新验证。';
        } else if (getFileResponse.status === 401) {
          errorMessage += ' Unauthorized。Token无效或已过期，请重新生成Token。';
        } else if (getFileResponse.status === 404) {
          errorMessage += ' Not Found。仓库或文件不存在，请检查仓库名称和文件路径。';
        }
        try {
          const errorData = await getFileResponse.json();
          if (errorData.message) {
            errorMessage += `\nGitHub错误信息: ${errorData.message}`;
          }
        } catch {
          // 忽略JSON解析错误
        }
        throw new Error(errorMessage);
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
          'Authorization': `Bearer ${githubToken.trim()}`,
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
        let errorMessage = `更新文件失败: HTTP ${updateResponse.status}`;
        if (updateResponse.status === 403) {
          errorMessage += ' Forbidden。可能的原因：\n1. Token缺少repo权限\n2. Token已过期或无效\n3. 仓库访问权限不足\n\n请检查Token权限并重新验证。';
        } else if (updateResponse.status === 401) {
          errorMessage += ' Unauthorized。Token无效或已过期，请重新生成Token。';
        } else if (updateResponse.status === 404) {
          errorMessage += ' Not Found。仓库或文件不存在，请检查仓库名称和文件路径。';
        }
        try {
          const errorData = await updateResponse.json();
          if (errorData.message) {
            errorMessage += `\nGitHub错误信息: ${errorData.message}`;
          }
        } catch {
          // 忽略JSON解析错误
        }
        throw new Error(errorMessage);
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
      // Rust 返回 Result<(bool, String), String>，Tauri 序列化为 [bool, string]
      const result = await invoke('verify_github_token', {
        githubToken: githubToken.trim(),
      });
      if (Array.isArray(result)) {
        return { valid: result[0] as boolean, message: result[1] as string };
      }
      return result as { valid: boolean; message: string };
    } else {
      // 浏览器环境：直接调用GitHub API
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${githubToken.trim()}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (response.status === 401) {
        return { valid: false, message: 'Token 无效或已过期，请检查Token是否正确' };
      }
      if (response.status === 403) {
        return { valid: false, message: 'Token 权限不足，需要 repo 权限' };
      }
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return { valid: false, message: `验证失败: HTTP ${response.status}${errorText ? ' - ' + errorText : ''}` };
      }

      const user = await response.json();
      
      // 检查是否有repo权限
      const scopes = response.headers.get('X-OAuth-Scopes');
      let hasRepoScope = false;
      
      if (scopes) {
        hasRepoScope = scopes.includes('repo');
      }
      
      // 如果没有X-OAuth-Scopes头，尝试测试repo权限（测试访问仓库内容API）
      if (!hasRepoScope) {
        try {
          // 先测试能否访问仓库
          const repoResponse = await fetch('https://api.github.com/repos/uckkk/ArtAssetNamingConfig', {
            headers: {
              'Authorization': `Bearer ${githubToken.trim()}`,
              'Accept': 'application/vnd.github.v3+json',
            },
          });
          
          if (repoResponse.status === 403) {
            return { valid: false, message: 'Token 缺少 repo 权限。请重新创建Token，在权限列表中勾选 "repo" 权限（完整仓库访问权限）' };
          }
          if (repoResponse.status === 404) {
            return { valid: false, message: '无法访问目标仓库，请确认Token有repo权限且仓库存在' };
          }
          
          // 再测试能否访问仓库内容（这是实际需要的权限）
          const contentResponse = await fetch('https://api.github.com/repos/uckkk/ArtAssetNamingConfig/contents/useID.csv', {
            headers: {
              'Authorization': `Bearer ${githubToken.trim()}`,
              'Accept': 'application/vnd.github.v3+json',
            },
          });
          
          if (contentResponse.status === 403) {
            return { valid: false, message: 'Token 缺少 repo 权限，无法访问仓库内容。请重新创建Token，在权限列表中勾选 "repo" 权限（完整仓库访问权限）' };
          }
          if (contentResponse.ok) {
            hasRepoScope = true;
          }
        } catch (e: any) {
          // 测试失败，给出警告但允许继续
          return { valid: true, message: `Token 验证成功！用户: ${user.login}。注意：无法验证repo权限，请确保Token有repo权限` };
        }
      }
      
      if (!hasRepoScope) {
        return { valid: false, message: 'Token 缺少 repo 权限。请重新创建Token，在权限列表中勾选 "repo" 权限（完整仓库访问权限）' };
      }

      return { valid: true, message: `Token 验证成功！用户: ${user.login}` };
    }
  } catch (error: any) {
    return { valid: false, message: `验证失败: ${error.message || '网络错误'}` };
  }
}

// 添加新账号（接受当前列表避免重复fetch）
export async function addAccount(
  username: string,
  password: string,
  githubToken: string,
  currentAccounts?: AccountInfo[]
): Promise<AccountInfo[]> {
  if (!username.trim()) {
    throw new Error('用户名不能为空');
  }
  if (!password.trim()) {
    throw new Error('密码不能为空');
  }

  const accounts = currentAccounts ? [...currentAccounts] : await fetchAccountList();

  if (accounts.some(acc => acc.username === username)) {
    throw new Error(`用户名 "${username}" 已存在`);
  }

  accounts.push({
    username: username.trim(),
    userId: password.trim(),
  });

  await syncAccountToGitHub(accounts, githubToken);
  return accounts;
}

// 删除账号（接受当前列表避免重复fetch）
export async function deleteAccount(
  username: string,
  githubToken: string,
  currentAccounts?: AccountInfo[]
): Promise<AccountInfo[]> {
  if (!username.trim()) {
    throw new Error('用户名不能为空');
  }

  const accounts = currentAccounts ? [...currentAccounts] : await fetchAccountList();

  const index = accounts.findIndex(acc => acc.username === username);
  if (index === -1) {
    throw new Error(`账号 "${username}" 不存在`);
  }

  accounts.splice(index, 1);

  await syncAccountToGitHub(accounts, githubToken);
  return accounts;
}

// 更新账号（接受当前列表避免重复fetch）
export async function updateAccount(
  oldUsername: string,
  newUsername: string,
  newPassword: string,
  githubToken: string,
  currentAccounts?: AccountInfo[]
): Promise<AccountInfo[]> {
  if (!oldUsername.trim()) {
    throw new Error('原用户名不能为空');
  }
  if (!newUsername.trim()) {
    throw new Error('新用户名不能为空');
  }
  if (!newPassword.trim()) {
    throw new Error('密码不能为空');
  }

  const accounts = currentAccounts ? [...currentAccounts] : await fetchAccountList();

  const index = accounts.findIndex(acc => acc.username === oldUsername);
  if (index === -1) {
    throw new Error(`账号 "${oldUsername}" 不存在`);
  }

  if (oldUsername !== newUsername && accounts.some(acc => acc.username === newUsername)) {
    throw new Error(`用户名 "${newUsername}" 已存在`);
  }

  accounts[index] = {
    username: newUsername.trim(),
    userId: newPassword.trim(),
  };

  await syncAccountToGitHub(accounts, githubToken);
  return accounts;
}
