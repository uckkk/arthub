/**
 * 版本号同步脚本
 * 从 package.json 读取版本号，同步到其他配置文件
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`无法读取 ${filePath}:`, e);
    process.exit(1);
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`✓ 已更新 ${filePath}`);
  } catch (e) {
    console.error(`无法写入 ${filePath}:`, e);
    process.exit(1);
  }
}

function updateCargoToml(filePath, version) {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    // 替换 version = "x.x.x" 行
    content = content.replace(/^version = ".*"$/m, `version = "${version}"`);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ 已更新 ${filePath}`);
  } catch (e) {
    console.error(`无法更新 ${filePath}:`, e);
    process.exit(1);
  }
}

// 从 package.json 读取版本号
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = readJson(packageJsonPath);
const version = packageJson.version;

if (!version) {
  console.error('package.json 中没有找到 version 字段');
  process.exit(1);
}

console.log(`正在同步版本号: ${version}`);

// 更新 tauri.conf.json
const tauriConfigPath = path.join(__dirname, '../src-tauri/tauri.conf.json');
const tauriConfig = readJson(tauriConfigPath);
tauriConfig.package.version = version;
writeJson(tauriConfigPath, tauriConfig);

// 更新 Cargo.toml
const cargoTomlPath = path.join(__dirname, '../src-tauri/Cargo.toml');
updateCargoToml(cargoTomlPath, version);

console.log(`\n✓ 版本号同步完成: ${version}`);
