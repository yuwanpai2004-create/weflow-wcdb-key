# 微信数据库密钥工具操作手册

适用对象：需要在自己电脑上提取、解密自己微信数据的操作人员。

## 一、使用前准备

1. 使用普通微信，不要使用企业微信。
2. 先打开微信，并确认已经能正常登录。
3. 打开“终端”。
4. 进入工具所在目录。

```bash
cd /工具所在目录
```

macOS 首次使用前，建议先执行：

```bash
xcode-select --install
brew install openssl@3
```

如果已经安装过，系统会提示无需重复安装。

## 二、最常用操作

提取密钥并同时解密数据库：

```bash
python3 wcdb_key_tool.py extract --decrypt --timeout 180
```

如果工具没有自动找到微信数据库目录，请改用：

```bash
python3 wcdb_key_tool.py extract --db-dir "微信db_storage目录" --decrypt --timeout 180
```

## 三、运行后怎么配合

运行命令后，工具会提示需要捕获新的 passphrase。

此时请在微信里操作：

1. 打开微信设置。
2. 退出当前账号登录。
3. 重新扫码或输入密码登录。
4. 如果 macOS 弹出调试授权提示，请选择允许。

等待终端继续输出结果即可。

## 四、成功后会得到什么

成功后通常会生成：

- `all_keys.json`：完整密钥文件，里面同时包含：
  - `passphrase`：给 WeFlow 导入使用。
  - 每个 `.db` 对应的 `enc_key` / `raw_key`：用于解密数据库。
- `decrypted/`：解密后的数据库目录。
- `~/.wcdb-key-tool/wechat-passphrase.json`：本机保存的 passphrase，下次通常不用重新登录捕获。

如果看到类似下面的提示，说明成功：

```text
passphrase 捕获成功
passphrase 派生成功
解密完成
```

## 五、下次再运行

如果没有更换微信账号、没有重装微信、没有清理缓存，通常直接运行：

```bash
python3 wcdb_key_tool.py extract --decrypt
```

工具会优先使用已保存的信息，不一定需要再次退出并重新登录微信。

## 六、失败时先看这里

如果提示“捕获失败”或没有生成 `all_keys.json`，请检查：

1. 是否打开的是普通微信主程序。
2. 是否在工具等待期间完成了“退出登录并重新登录”。
3. macOS 调试授权弹窗是否点了允许。
4. 是否安装了 Xcode Command Line Tools。
5. 是否安装了 OpenSSL。

工具现在会自动选择普通微信主进程，避免误选 `WeChatAppEx` 子进程。

失败后请把最新的日志文件发给技术人员：

```text
outputs/capture-*.log
```

日志里会记录 LLDB 停在哪一步。密钥内容会被自动打码，不会明文写进日志。

## 七、常见问题

### 1. 需要一直盯着终端吗？

需要。运行后要按提示退出并重新登录微信，否则工具等不到捕获时机。

### 2. 为什么要重新登录微信？

密钥只会在登录过程中短暂出现，工具需要在这个时机读取。

### 3. 可以解密别人的微信吗？

不可以。本工具只用于自己电脑、自己账号的数据处理。

### 4. 已经有 passphrase 怎么办？

可以直接导入并解密：

```bash
python3 wcdb_key_tool.py import-passphrase "64位十六进制passphrase" --db-dir "微信db_storage目录" --decrypt
```

导入后生成的 `all_keys.json` 也会同时写入 `passphrase` 和每个数据库的 `raw_key`。

### 5. 想指定输出文件名怎么办？

```bash
python3 wcdb_key_tool.py extract --output all_keys-new-account.json --decrypt --decrypt-output decrypted-new-account
```

这样适合切换新账号时单独保存结果。

切换微信账号后，旧账号的 passphrase 不能继续使用。请重新运行 `extract`，并按提示退出登录后重新登录当前账号；工具会默认选择最近活跃的微信账号目录。
