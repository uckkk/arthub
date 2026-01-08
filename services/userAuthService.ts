// 用户验证服务
const USER_ID_CSV_URL = 'https://raw.githubusercontent.com/uckkk/ArtAssetNamingConfig/main/useID.csv';

export interface UserInfo {
  username: string;
  userId: string;
}

// 从GitHub获取用户ID列表
export async function fetchUserIds(): Promise<Map<string, string>> {
  try {
    const response = await fetch(USER_ID_CSV_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch user IDs: ${response.statusText}`);
    }
    const csvText = await response.text();
    
    // 解析CSV：格式应该是 用户名,用户ID
    const userMap = new Map<string, string>();
    const lines = csvText.split('\n').filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
    
    lines.forEach(line => {
      const [username, userId] = line.split(',').map(s => s.trim());
      if (username && userId) {
        userMap.set(username, userId);
      }
    });
    
    return userMap;
  } catch (error) {
    console.error('Error fetching user IDs:', error);
    throw error;
  }
}

// 验证用户
export async function verifyUser(username: string, userId: string): Promise<boolean> {
  try {
    const userMap = await fetchUserIds();
    const expectedUserId = userMap.get(username);
    return expectedUserId === userId;
  } catch (error) {
    console.error('Error verifying user:', error);
    return false;
  }
}

// 保存用户信息到localStorage
export function saveUserInfo(userInfo: UserInfo): void {
  localStorage.setItem('arthub_user_info', JSON.stringify(userInfo));
}

// 从localStorage获取用户信息
export function getUserInfo(): UserInfo | null {
  const stored = localStorage.getItem('arthub_user_info');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// 清除用户信息
export function clearUserInfo(): void {
  localStorage.removeItem('arthub_user_info');
}

