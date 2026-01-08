import { PathItem } from './types';

// 路径管理的默认示例数据

export const MOCK_PATHS: PathItem[] = [
  {
    id: '1',
    name: '美术文档 Wiki',
    path: 'https://www.notion.so/art-docs',
    type: 'web',
    group: '文档资料',
    description: '项目 Wiki'
  },
  {
    id: '2',
    name: 'SVN 仓库资产',
    path: 'D:\\Projects\\GameProject\\Assets',
    type: 'local',
    group: '工作目录',
    description: '本地资产文件夹'
  },
  {
    id: '3',
    name: '渲染服务器',
    path: '\\\\192.168.1.50\\RenderOutput',
    type: 'network',
    group: '服务器',
    description: '每日渲染输出'
  }
];