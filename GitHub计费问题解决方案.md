# GitHub Actions 计费问题解决方案

## 问题说明

错误信息：`The job was not started because recent account payments have failed or your spending limit needs to be increased.`

这个错误表示 GitHub Actions 的免费额度已用完或账户付款设置有问题。

## 解决方案

### 方案 1：检查并修复 GitHub 账户付款设置（推荐）

1. **登录 GitHub 账户**
   - 访问 https://github.com/settings/billing

2. **检查付款方式**
   - 确保已添加有效的付款方式（信用卡或 PayPal）
   - 检查付款方式是否过期或失效

3. **检查支出限额**
   - 在 Billing & plans 页面查看 Actions 使用情况
   - 免费账户每月有：
     - **公开仓库**：无限分钟
     - **私有仓库**：2000 分钟/月

4. **增加支出限额（如需要）**
   - 如果超出免费额度，可以设置每月支出限额
   - 建议设置合理的限额（如 $10/月）以避免意外费用

### 方案 2：优化构建配置以减少成本

#### 2.1 只构建需要的平台

修改 `.github/workflows/build.yml`，注释掉不需要的平台：

```yaml
matrix:
  include:
    # 只构建 Windows（注释掉 macOS）
    - platform: windows-latest
      target: x86_64-pc-windows-msvc
      name: Windows
    
    # 如果需要 macOS，取消注释
    # - platform: macos-latest
    #   target: x86_64-apple-darwin
    #   name: macOS-Intel
    # - platform: macos-latest
    #   target: aarch64-apple-darwin
    #   name: macOS-ARM
```

#### 2.2 使用手动触发（避免自动构建）

当前配置已经是手动触发，确保：
- 不要频繁推送标签触发构建
- 只在需要发布新版本时才构建

#### 2.3 添加构建缓存

已配置 npm 缓存，可以添加 Rust 缓存进一步加速：

```yaml
- name: Cache Rust dependencies
  uses: actions/cache@v3
  with:
    path: |
      ~/.cargo/bin/
      ~/.cargo/registry/index/
      ~/.cargo/registry/cache/
      ~/.cargo/git/db/
      src-tauri/target/
    key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
```

### 方案 3：使用本地构建（完全免费）

如果 GitHub Actions 额度不足，可以在本地构建：

#### Windows 本地构建

```bash
# 安装依赖
npm install

# 构建前端
npm run build

# 构建 Tauri 应用（需要安装 Rust）
cd src-tauri
cargo build --release
```

#### macOS 本地构建

使用项目中的 `build-mac.sh` 脚本：

```bash
chmod +x build-mac.sh
./build-mac.sh
```

### 方案 4：使用其他 CI/CD 服务

如果 GitHub Actions 成本过高，可以考虑：

1. **GitLab CI** - 免费账户每月 400 分钟
2. **CircleCI** - 免费账户每月 6000 分钟
3. **Travis CI** - 免费账户每月 10000 分钟（公开仓库）

## 成本估算

GitHub Actions 计费（超出免费额度后）：
- **Windows runner**: $0.008/分钟
- **macOS runner**: $0.08/分钟（更贵！）

一次完整构建（3个平台）大约需要：
- Windows: ~15 分钟 × $0.008 = $0.12
- macOS Intel: ~20 分钟 × $0.08 = $1.60
- macOS ARM: ~20 分钟 × $0.08 = $1.60
- **总计**: ~$3.32/次构建

## 建议

1. **优先使用公开仓库** - 公开仓库 Actions 完全免费
2. **减少构建频率** - 只在发布版本时构建
3. **只构建需要的平台** - 如果只需要 Windows，就只构建 Windows
4. **使用本地构建** - 开发测试时在本地构建，CI 只用于发布

## 立即操作步骤

1. 访问 https://github.com/settings/billing
2. 检查付款方式是否有效
3. 查看 Actions 使用情况
4. 如果需要，设置合理的支出限额
5. 如果只需要 Windows 版本，修改构建配置只构建 Windows
