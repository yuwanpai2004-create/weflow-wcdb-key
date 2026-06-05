# WeFlow WCDB Key Edition

这是一个基于 WeFlow 的本地微信聊天记录查看、分析、导出工具，并额外整理了 macOS 微信数据库密钥获取方案。

> 说明：原项目来自 GitHub 用户 [hicccc77](https://github.com/hicccc77) 的 WeFlow。后来原仓库不知为何删除或不可访问；同时原项目内置的 macOS 获取密钥方法在当前微信版本上已经失效。因此我在原项目基础上继续整理，并借助 Codex 完成了 macOS 密钥获取、导入流程和文档层面的优化。

![WeFlow preview](app.jpg)

## 项目做了什么

这个仓库包含两部分：

- WeFlow 桌面端源码：用于本地读取、查看、分析和导出微信聊天记录。
- macOS 密钥获取工具：位于 `tools/wcdb-key-tool-macos/`，用于捕获微信数据库 passphrase，并派生每个数据库的 64 位解密 key。

相比原版，这个整理版重点补充了：

- macOS 下基于 LLDB 捕获 passphrase 的流程。
- 将 passphrase 派生为各个数据库的 `enc_key` / `raw_key`。
- `all_keys.json` 同时写入 `passphrase` 和每个数据库的 64 位 key。
- WeFlow 导入密钥时优先读取 `passphrase`，避免误把单库 `enc_key` 当作 WeFlow 解密口令导致错误码 `-3`。
- 自动选择最近活跃的微信账号目录，减少切换账号后仍导入旧账号密钥的问题。
- 发布前排除了真实密钥、抓取日志、解密后的数据库和本机配置。

## 开发历程

最开始我只是想继续使用 WeFlow，但原作者 [hicccc77](https://github.com/hicccc77) 的仓库已经不可访问。手头保留了一份本地源码后，我发现原项目里 macOS 自动获取密钥的方式已经无法适配当前微信版本。

排查过程中遇到两个主要问题：

1. WeFlow 在导入密钥时，如果误用了 `all_keys.json` 里的单个数据库 `enc_key`，数据库会打开失败并报错 `-3`。
2. 新微信账号首次抓取时，如果继续复用旧账号的 passphrase 或旧的 `all_keys.json`，派生出的 key 无法通过任何数据库 salt 校验。

后来参考 Linux 上获取 WCDB 密钥的思路，也就是在微信登录时捕获 32 字节 passphrase，再通过数据库 salt 进行 PBKDF2-SHA512 派生。我让 Codex 在这个方向上做了 macOS 适配：

- Linux 方案通常通过 ELF 静态分析 + GDB 断点定位密钥相关函数。
- macOS 不能直接复用 Linux 的 `/proc`、ELF 和 GDB 流程，所以改成 LLDB 附加微信进程。
- 在 macOS 上断到 `CCKeyDerivationPBKDF`，过滤 `passwordLen=32`、`saltLen=16`、`rounds=256000` 的 PBKDF2 调用。
- 使用当前数据库的 salt 做过滤，确认捕获到的是正在用于 WCDB 的 passphrase。
- 再用 SQLCipher4/WCDB 参数派生每个数据库实际使用的 64 位 `enc_key` / `raw_key`。

经过验证，WeFlow 实际需要导入的是 passphrase，而不是某个数据库派生后的 `enc_key`。这也是本仓库修复导入逻辑的核心原因。

## 技术实现

### WeFlow 侧

WeFlow 是 Electron + React + Vite 应用。主进程负责读取本地微信数据库，前端负责展示聊天、联系人、分析报告和导出功能。

数据库连接流程大致是：

1. 选择微信数据根目录，例如 macOS 的 `xwechat_files`。
2. 选择具体账号目录，例如 `wxid_xxx_xxxx`。
3. 提供 64 位 passphrase。
4. WeFlow 调用 native WCDB 库打开账号数据库。

本仓库对密钥导入做了调整：

- 支持导入包含 `passphrase` 的 `all_keys.json`。
- 支持导入 `wechat-passphrase.json`。
- 支持导入纯 64 位十六进制文本。
- 如果选择的是只有单库 `enc_key` 的旧格式文件，会提示原因，避免继续触发 `-3`。

### macOS 密钥工具侧

工具位置：

```text
tools/wcdb-key-tool-macos/wcdb_key_tool.py
```

核心流程：

1. 自动扫描微信数据库目录，优先选择最近活跃的账号目录。
2. 收集每个 `.db` 文件第一页的 16 字节 salt。
3. 通过 LLDB 附加普通微信主进程。
4. 在 `CCKeyDerivationPBKDF` 上设置断点。
5. 登录微信时读取 32 字节 passphrase。
6. 对每个数据库执行：

```text
enc_key = PBKDF2-HMAC-SHA512(passphrase, db_salt, iterations=256000, dklen=32)
```

7. 使用数据库第一页 HMAC-SHA512 校验派生 key 是否正确。
8. 输出 `all_keys.json`。

输出文件格式示例：

```json
{
  "passphrase": "64 hex chars",
  "_passphrase": "64 hex chars",
  "session/session.db": {
    "enc_key": "64 hex chars",
    "raw_key": "64 hex chars",
    "salt": "32 hex chars",
    "size_mb": 0.5
  },
  "_db_dir": "/path/to/wxid_xxx/db_storage"
}
```

字段含义：

- `passphrase`：给 WeFlow 导入使用。
- `enc_key`：某个数据库实际使用的派生解密 key。
- `raw_key`：`enc_key` 的兼容别名。
- `_db_dir`：当前账号的 `db_storage` 路径。

## 支持平台

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows | 可用 | 原项目已有 Windows 支持，密钥获取依赖 `resources/key/win32/x64/wx_key.dll` |
| macOS Apple Silicon | 可用，但密钥获取为实验性 | 本仓库加入 LLDB + passphrase 派生流程 |
| Linux x64 | 可构建 | Linux 密钥工具思路主要来自 `tools/wcdb-key-tool-macos` 中保留的原 Linux 实现 |

## 使用教程

### 1. 获取源码

```bash
git clone https://github.com/yuwanpai2004-create/weflow-wcdb-key.git
cd weflow-wcdb-key
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动 WeFlow

开发方式启动：

```bash
npx electron .
```

或先构建：

```bash
npm run typecheck
npm run build
```

构建产物会输出到：

```text
release/
```

### 4. macOS 获取当前微信账号密钥

进入工具目录：

```bash
cd tools/wcdb-key-tool-macos
```

安装 OpenSSL：

```bash
brew install openssl@3
```

运行提取：

```bash
python3 wcdb_key_tool.py extract --output all_keys.json --timeout 180
```

运行后按提示操作：

1. 打开微信设置。
2. 退出登录当前账号。
3. 重新扫码或输入密码登录。
4. 如果 macOS 弹出调试授权，允许 LLDB 附加微信。
5. 等待工具输出 `passphrase 捕获成功` 和 `密钥保存到: all_keys.json`。

如果要同时解密数据库：

```bash
python3 wcdb_key_tool.py extract --output all_keys.json --decrypt --decrypt-output decrypted --timeout 180
```

### 5. macOS 导入 WeFlow

打开 WeFlow 后：

1. 进入设置。
2. 打开“数据库连接”。
3. 数据库目录选择微信的 `xwechat_files` 根目录。
4. 点击“导入密钥文件”。
5. 选择刚生成的 `all_keys.json`。

WeFlow 会读取其中的 `passphrase`。不要手动复制某个数据库条目里的 `enc_key` 给 WeFlow，否则可能出现错误码 `-3`。

### 6. 切换微信账号

切换微信账号后必须重新抓取密钥。

原因是不同账号的 passphrase 不通用。旧账号的 `all_keys.json` 即使格式正确，也无法打开新账号数据库。

建议每个账号单独保存：

```bash
python3 wcdb_key_tool.py extract --output all_keys-account-a.json --timeout 180
python3 wcdb_key_tool.py extract --output all_keys-account-b.json --timeout 180
```

### 7. Windows 获取密钥

Windows 不走 macOS 的 LLDB 工具。原项目已有 Windows 获取逻辑：

- 确保微信已安装并登录。
- 右键 WeFlow，选择“以管理员身份运行”。
- 数据库目录通常是：

```text
C:\Users\你的用户名\Documents\xwechat_files
```

- 在 WeFlow 设置中点击“自动获取密钥”。

Windows 侧依赖：

```text
resources/key/win32/x64/wx_key.dll
```

macOS 上抓到的 passphrase 或 `all_keys.json` 不能直接给 Windows 账号使用。

## 安全说明

这个项目只应该用于你自己的设备和你自己的微信账号数据。

请不要公开提交以下文件：

- `all_keys*.json`
- `wechat-passphrase.json`
- `capture-*.log`
- 解密后的 `.db`
- WeFlow 本机配置文件
- 任何聊天记录导出文件

仓库里的 `.gitignore` 已经默认排除了这些文件。

## 常见问题

### 为什么会出现错误码 -3？

常见原因是把单个数据库的 `enc_key` 当成 WeFlow 解密口令导入了。WeFlow 需要的是 passphrase。

请导入包含 `passphrase` 字段的 `all_keys.json`，或者导入 `wechat-passphrase.json`。

### 为什么换账号后默认还是旧账号密钥？

旧的 `all_keys.json` 里 `_db_dir` 可能仍然指向旧账号目录。切换账号后需要重新运行 `extract`，生成当前账号自己的密钥文件。

### macOS 自动捕获失败怎么办？

可以按顺序排查：

1. 确认微信是普通主程序，不是子进程。
2. 确认安装了 Xcode Command Line Tools。
3. 确认系统允许 LLDB 调试微信。
4. 彻底退出微信后重新打开。
5. 按提示退出登录并重新登录账号。
6. 查看 `outputs/capture-*.log` 或工具输出定位 LLDB 停在哪一步。

### `all_keys.json` 可以公开吗？

不可以。它包含能打开本地微信数据库的密钥。

## 项目结构

```text
.
├── electron/                  # Electron 主进程与本地服务
├── src/                       # React 前端
├── resources/                 # native 库和运行时资源
├── tools/wcdb-key-tool-macos/ # macOS/Linux WCDB 密钥工具
├── docs/                      # HTTP API 和排障文档
└── PUBLISHING_NOTES.md        # 发布前安全说明
```

## 致谢

- 原 WeFlow 项目作者：[hicccc77](https://github.com/hicccc77)
- Linux WCDB 密钥提取思路来源于 `tools/wcdb-key-tool-macos` 中保留和改造的 `wcdb-key-tool`
- 相关思路参考：
  - GDB/LLDB 断点捕获 passphrase
  - SQLCipher4/WCDB PBKDF2-SHA512 派生
  - 数据库第一页 HMAC 校验

## License

本仓库保留原项目许可证文件。请在使用、修改、再发布前自行确认原项目及其依赖的许可证要求。
