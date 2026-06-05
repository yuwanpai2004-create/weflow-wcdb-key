# 微信周报脚本

这个脚本用于生成《用户运营数据周报》中微信相关的三行可复制数据：

- `加好友周报`
- `社群周报`
- `群友互动周报`

## 使用前准备

1. 启动 WeFlow，并连接微信数据库。
2. 在 WeFlow 设置中开启 `HTTP API 服务`。
3. 打开通讯录页并刷新一次，让 WeFlow 建立“好友首次出现”追踪基线。
4. 生成脚本配置：

```bash
npm run weekly:wechat:init
```

然后编辑：

```text
scripts/wechat-weekly-report.config.json
```

需要填写：

- `accounts[].apiBaseUrl`：每个账号对应的 WeFlow API 地址。
- `accounts[].accessToken`：如果 API 服务开启了 Token，就填这里。
- `accounts[].firstSeenCacheScope`：多个账号时建议填写，用于区分各账号的好友首次出现缓存。
- `groups[].chatroomId`：各个群对应的 `xxx@chatroom`。

群 ID 可以在 WeFlow 通讯录里搜索群名，或用本地 API 查询联系人列表后找到对应 `username`。

## 生成周报

默认统计上周一到上周日，适合周一填写上周周报：

```bash
npm run weekly:wechat
```

指定某个周日作为周报日期：

```bash
npm run weekly:wechat -- --week-end 2026-06-07
```

输出文件在：

```text
outputs/wechat-weekly-report-YYYY-MM-DD.tsv
```

可以直接复制对应 sheet 下面的那一行，粘贴到总表。

## 统计口径

### 加好友周报

- 统计周期：周一 00:00:00 到周日 23:59:59。
- 默认运行时统计上周。
- 新好友通过人数：本周首次出现在通讯录中的好友。
- 完善用户：好友备注、昵称、显示名或微信号中包含 `已完善`。
- 非完善用户：本周新增好友中不包含 `已完善` 的人。
- 技术群进群人数：本周新增好友里，有多少人进入配置中 `countForFriendJoin=true` 的群，按人去重。

### 社群周报

- 统计每个群本周有多少人进群。
- 这里按群统计人次：同一个人进了多个群，会在多个群各计一次。
- 一条邀请消息里有多个人，会按多个人计数。

### 群友互动周报

- 统计每个群本周有多少个用户发言。
- 同一个用户一周内多次发言，只计 1 人。
- 系统消息不计入发言。

## 注意

首次使用时，如果还没有建立好友首次出现基线，脚本不会把当前所有好友误算成“本周新增好友”。请先在通讯录页刷新一次，之后新增好友才会被准确统计。
