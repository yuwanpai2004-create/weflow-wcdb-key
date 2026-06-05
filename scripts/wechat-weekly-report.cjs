#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'wechat-weekly-report.config.json')
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'wechat-weekly-report.config.example.json')
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'outputs')
const MESSAGE_PAGE_LIMIT = 10000

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG_PATH,
    outDir: DEFAULT_OUTPUT_DIR,
    initConfig: false,
    weekEnd: '',
    help: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--help' || item === '-h') args.help = true
    else if (item === '--init-config') args.initConfig = true
    else if (item === '--config') args.config = argv[++i] || args.config
    else if (item.startsWith('--config=')) args.config = item.slice('--config='.length)
    else if (item === '--out-dir') args.outDir = argv[++i] || args.outDir
    else if (item.startsWith('--out-dir=')) args.outDir = item.slice('--out-dir='.length)
    else if (item === '--week-end') args.weekEnd = argv[++i] || ''
    else if (item.startsWith('--week-end=')) args.weekEnd = item.slice('--week-end='.length)
    else throw new Error(`未知参数: ${item}`)
  }
  return args
}

function printHelp() {
  console.log(`微信周报生成脚本

用法:
  node scripts/wechat-weekly-report.cjs --init-config
  node scripts/wechat-weekly-report.cjs
  node scripts/wechat-weekly-report.cjs --week-end 2026-06-07

说明:
  - 默认统计“上周一 00:00:00 到上周日 23:59:59”，适合周一填写上周周报。
  - --week-end 可指定周报日期，也就是表格 A 列的周日日期。
  - 需要先启动 WeFlow、连接对应账号，并在设置中启用 HTTP API 服务。
  - 两个账号可配置为两个不同 API 端口；脚本会自动合并统计。
`)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function expandHome(value) {
  const text = String(value || '').trim()
  if (text === '~') return process.env.HOME || text
  if (text.startsWith('~/')) return path.join(process.env.HOME || '', text.slice(2))
  return text
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!match) throw new Error(`日期格式应为 YYYY-MM-DD，当前为: ${value}`)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0)
}

function getDefaultWeekRange(now = new Date()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const day = today.getDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  const thisMonday = new Date(today)
  thisMonday.setDate(today.getDate() - daysSinceMonday)
  const start = new Date(thisMonday)
  start.setDate(thisMonday.getDate() - 7)
  const end = new Date(thisMonday)
  end.setDate(thisMonday.getDate() - 1)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

function getWeekRangeFromEnd(weekEndText) {
  const end = parseDateOnly(weekEndText)
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(end.getDate() - 6)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function toUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000)
}

function toYmdCompact(date) {
  return formatDate(date).replace(/-/g, '')
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

async function apiGet(account, pathname, params = {}) {
  const baseUrl = normalizeBaseUrl(account.apiBaseUrl)
  if (!baseUrl) throw new Error(`账号 ${account.name || ''} 缺少 apiBaseUrl`)
  const url = new URL(`${baseUrl}${pathname}`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  const headers = {}
  if (account.accessToken) headers.Authorization = `Bearer ${account.accessToken}`
  const response = await fetch(url, { headers })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`接口返回不是 JSON: ${url.toString()} ${text.slice(0, 200)}`)
  }
  if (!response.ok || json?.success === false) {
    throw new Error(`${account.name || baseUrl} 请求失败: ${json?.error || response.status}`)
  }
  return json
}

function contactDisplayName(contact) {
  return String(contact.displayName || contact.remark || contact.nickname || contact.alias || contact.username || '').trim()
}

function isCompletedFriend(contact, keyword) {
  const mark = String(keyword || '已完善').trim()
  if (!mark) return false
  const fields = [contact.remark, contact.displayName, contact.nickname, contact.alias]
  return fields.some((field) => String(field || '').includes(mark))
}

async function fetchContacts(account) {
  const json = await apiGet(account, '/api/v1/contacts', { limit: 10000 })
  return Array.isArray(json.contacts) ? json.contacts : []
}

async function fetchMessages(account, chatroomId, start, end) {
  const messages = []
  let offset = 0
  while (true) {
    const json = await apiGet(account, '/api/v1/messages', {
      talker: chatroomId,
      start: toYmdCompact(start),
      end: toYmdCompact(end),
      limit: MESSAGE_PAGE_LIMIT,
      offset
    })
    const batch = Array.isArray(json.messages) ? json.messages : []
    messages.push(...batch)
    if (!json.hasMore || batch.length === 0) break
    offset += batch.length
  }
  return messages
}

function extractTagValues(xml, tagName) {
  const safeTag = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`<${safeTag}\\b[^>]*>([\\s\\S]*?)<\\/${safeTag}>`, 'gi')
  const values = []
  let match
  while ((match = regex.exec(String(xml || ''))) !== null) {
    const raw = String(match[1] || '')
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (raw) values.push(raw)
  }
  return values
}

function extractJoinMembersFromRaw(rawContent) {
  const raw = String(rawContent || '')
  const members = []
  const memberRegex = /<member\b[^>]*>([\s\S]*?)<\/member>/gi
  let match
  while ((match = memberRegex.exec(raw)) !== null) {
    const body = match[1] || ''
    const username = extractTagValues(body, 'username')[0] || ''
    const nickname = extractTagValues(body, 'nickname')[0] || extractTagValues(body, 'displayname')[0] || ''
    if (username || nickname) {
      members.push({ username, displayName: nickname || username })
    }
  }
  return members
}

function extractJoinMembersFromText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!/加入了群聊|进群|入群/.test(value)) return []
  const invited = /邀请(.+?)加入了群聊/.exec(value)
  const direct = /["“]?([^"“”]+?)["”]?加入了群聊/.exec(value)
  const namesText = invited?.[1] || direct?.[1] || ''
  return namesText
    .split(/[、,，]/)
    .map((name) => name.replace(/^["“]|["”]$/g, '').trim())
    .filter(Boolean)
    .map((displayName) => ({ username: '', displayName }))
}

function extractJoinMembers(message) {
  const fromRaw = extractJoinMembersFromRaw(message.rawContent)
  if (fromRaw.length > 0) return fromRaw
  return extractJoinMembersFromText(message.parsedContent || message.content || message.rawContent)
}

function isSpeechMessage(message, chatroomId) {
  const localType = Number(message.localType || 0)
  if (localType === 10000 || localType === 266287972401) return false
  const sender = String(message.senderUsername || '').trim()
  if (!sender || sender === chatroomId) return false
  return true
}

function buildContactIndexes(contacts) {
  const byUsername = new Map()
  const byName = new Map()
  for (const contact of contacts) {
    const username = String(contact.username || '').trim()
    if (username) byUsername.set(username, contact)
    for (const name of [contactDisplayName(contact), contact.remark, contact.nickname, contact.alias]) {
      const key = String(name || '').trim()
      if (key && !byName.has(key)) byName.set(key, contact)
    }
  }
  return { byUsername, byName }
}

function loadFirstSeenCache(config) {
  const configPath = expandHome(config.weflowConfigPath || '~/Library/Application Support/weflow/WeFlow-config.json')
  if (!fs.existsSync(configPath)) return { map: {}, configPath, error: 'WeFlow 配置文件不存在' }
  try {
    const weflowConfig = readJson(configPath)
    return {
      map: weflowConfig.contactsFirstSeenCacheMap || {},
      configPath,
      dbPath: weflowConfig.dbPath || '',
      myWxid: weflowConfig.myWxid || ''
    }
  } catch (error) {
    return { map: {}, configPath, error: String(error) }
  }
}

function resolveFirstSeenScope(account, firstSeenCache) {
  const explicit = String(account.firstSeenCacheScope || '').trim()
  if (explicit) return explicit
  const scopes = Object.keys(firstSeenCache.map || {})
  if (scopes.length === 1) return scopes[0]
  if (firstSeenCache.dbPath || firstSeenCache.myWxid) {
    const inferred = `${firstSeenCache.dbPath || ''}::${firstSeenCache.myWxid || ''}`
    if (firstSeenCache.map?.[inferred]) return inferred
  }
  return ''
}

function getWeeklyNewFriendContacts(account, contacts, config, range, firstSeenCache) {
  const scope = resolveFirstSeenScope(account, firstSeenCache)
  if (!scope) {
    return {
      contacts: [],
      warning: `${account.name || account.apiBaseUrl} 未配置 firstSeenCacheScope，无法判断本周新增好友`
    }
  }
  const cacheItem = firstSeenCache.map?.[scope]
  const friends = cacheItem?.friends || {}
  if (!cacheItem || !friends || Object.keys(friends).length === 0) {
    return {
      contacts: [],
      warning: `${account.name || account.apiBaseUrl} 没有好友首次出现缓存，请先在 WeFlow 通讯录页刷新建立基线`
    }
  }

  const byUsername = new Map(contacts.map((contact) => [String(contact.username || '').trim(), contact]))
  const startMs = range.start.getTime()
  const endMs = range.end.getTime()
  const weeklyContacts = []
  for (const entry of Object.values(friends)) {
    const firstSeenAt = Number(entry?.firstSeenAt || 0)
    const username = String(entry?.username || '').trim()
    if (!username || entry?.baseline) continue
    if (firstSeenAt < startMs || firstSeenAt > endMs) continue
    const contact = byUsername.get(username)
    if (contact?.type === 'friend') weeklyContacts.push(contact)
  }
  return { contacts: weeklyContacts, scope }
}

async function collectAccount(account, config, range) {
  const contacts = await fetchContacts(account)
  const firstSeenCache = config.__firstSeenCache || { map: {} }
  const weeklyNew = getWeeklyNewFriendContacts(account, contacts, config, range, firstSeenCache)
  if (weeklyNew.warning) console.warn(`警告: ${weeklyNew.warning}`)
  const weeklyNewFriends = weeklyNew.contacts
  const indexes = buildContactIndexes(weeklyNewFriends)
  const completed = new Set()
  const incomplete = new Set()
  for (const friend of weeklyNewFriends) {
    const username = String(friend.username || '').trim()
    if (!username) continue
    if (isCompletedFriend(friend, config.completedRemarkKeyword)) completed.add(username)
    else incomplete.add(username)
  }

  const groupStats = new Map()
  const joinedFriendUsernames = new Set()

  for (const group of config.groups || []) {
    const chatroomId = String(group.chatroomId || '').trim()
    if (!chatroomId) {
      groupStats.set(group.label, {
        joinPersonTimes: 0,
        activeSpeakerCount: 0,
        skipped: true
      })
      continue
    }

    const messages = await fetchMessages(account, chatroomId, range.start, range.end)
    const activeSpeakers = new Set()
    let joinPersonTimes = 0

    for (const message of messages) {
      if (isSpeechMessage(message, chatroomId)) {
        activeSpeakers.add(String(message.senderUsername).trim())
      }

      const joinMembers = extractJoinMembers(message)
      if (joinMembers.length > 0) {
        joinPersonTimes += joinMembers.length
        if (group.countForFriendJoin !== false) {
          for (const member of joinMembers) {
            const contact = member.username
              ? indexes.byUsername.get(member.username)
              : indexes.byName.get(member.displayName)
            if (contact?.username) joinedFriendUsernames.add(contact.username)
          }
        }
      }
    }

    groupStats.set(group.label, {
      joinPersonTimes,
      activeSpeakerCount: activeSpeakers.size,
      skipped: false
    })
  }

  return {
    account: account.name || account.apiBaseUrl,
    contacts,
    weeklyNewFriendUsernames: new Set(weeklyNewFriends.map((item) => item.username).filter(Boolean)),
    completed,
    incomplete,
    joinedFriendUsernames,
    groupStats
  }
}

function sumGroups(groups, accountResults, field) {
  return groups.map((group) => {
    let total = 0
    for (const result of accountResults) {
      total += Number(result.groupStats.get(group.label)?.[field] || 0)
    }
    return total
  })
}

function buildRows(config, range, accountResults) {
  const weekEnd = formatDate(range.end)
  const groups = config.groups || []
  const groupLabels = groups.map((group) => group.label)
  const allCompleted = new Set()
  const allIncomplete = new Set()
  const allJoinedFriends = new Set()

  for (const result of accountResults) {
    for (const username of result.completed) allCompleted.add(username)
    for (const username of result.incomplete) allIncomplete.add(username)
    for (const username of result.joinedFriendUsernames) allJoinedFriends.add(username)
  }

  const completedApply = ''
  const incompleteApply = ''
  const completedPassed = allCompleted.size
  const incompletePassed = allIncomplete.size
  const passedTotal = completedPassed + incompletePassed
  const friendJoinCount = allJoinedFriends.size
  const groupJoinCounts = sumGroups(groups, accountResults, 'joinPersonTimes')
  const groupActiveCounts = sumGroups(groups, accountResults, 'activeSpeakerCount')

  return {
    weekEnd,
    sheets: [
      {
        name: '加好友周报',
        header: [
          '周报日期',
          '官网版本',
          '微信发申请完善用户人数',
          '微信发申请非完善用户数',
          '微信通过完善用户人数',
          '微信通过非完善用户人数',
          '微信通过率',
          '企微被完善用户添加人数',
          '企微被非完善用户添加人数',
          '⭐️完善用户总通过人数',
          '完善用户好友总通过率',
          '⭐️加新用户通过总人数',
          '⭐️技术群进群人数',
          '技术群进群率'
        ],
        row: [
          weekEnd,
          '',
          completedApply,
          incompleteApply,
          completedPassed,
          incompletePassed,
          '',
          '',
          '',
          completedPassed,
          '',
          passedTotal,
          friendJoinCount,
          passedTotal > 0 ? friendJoinCount / passedTotal : ''
        ]
      },
      {
        name: '社群周报',
        header: ['周报日期', ...groupLabels, '合计'],
        row: [weekEnd, ...groupJoinCounts, groupJoinCounts.reduce((sum, value) => sum + value, 0)]
      },
      {
        name: '群友互动周报',
        header: ['周报日期', ...groupLabels, '总计'],
        row: [weekEnd, ...groupActiveCounts, groupActiveCounts.reduce((sum, value) => sum + value, 0)]
      }
    ]
  }
}

function toTsvValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    if (value > 0 && value < 1) return `${(value * 100).toFixed(2)}%`
    return String(value)
  }
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

function renderTsv(report) {
  const lines = []
  lines.push(`统计周期\t${report.weekEnd}`)
  lines.push('')
  for (const sheet of report.sheets) {
    lines.push(`[${sheet.name}]`)
    lines.push(sheet.header.map(toTsvValue).join('\t'))
    lines.push(sheet.row.map(toTsvValue).join('\t'))
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  if (args.initConfig) {
    if (fs.existsSync(args.config)) {
      console.log(`配置文件已存在: ${args.config}`)
      return
    }
    fs.copyFileSync(EXAMPLE_CONFIG_PATH, args.config)
    console.log(`已生成配置模板: ${args.config}`)
    console.log('请填写 accounts[].apiBaseUrl/accessToken 和 groups[].chatroomId 后再运行。')
    return
  }
  if (!fs.existsSync(args.config)) {
    throw new Error(`缺少配置文件: ${args.config}\n先运行: node scripts/wechat-weekly-report.cjs --init-config`)
  }

  const config = readJson(args.config)
  config.__firstSeenCache = loadFirstSeenCache(config)
  if (config.__firstSeenCache.error) {
    console.warn(`警告: ${config.__firstSeenCache.error}: ${config.__firstSeenCache.configPath}`)
  }
  const range = args.weekEnd ? getWeekRangeFromEnd(args.weekEnd) : getDefaultWeekRange()
  const accounts = (config.accounts || []).filter((account) => normalizeBaseUrl(account.apiBaseUrl))
  if (accounts.length === 0) throw new Error('配置中至少需要一个 accounts[].apiBaseUrl')

  const accountResults = []
  for (const account of accounts) {
    console.log(`统计账号: ${account.name || account.apiBaseUrl}`)
    accountResults.push(await collectAccount(account, config, range))
  }

  const report = buildRows(config, range, accountResults)
  fs.mkdirSync(args.outDir, { recursive: true })
  const outPath = path.join(args.outDir, `wechat-weekly-report-${report.weekEnd}.tsv`)
  fs.writeFileSync(outPath, renderTsv(report), 'utf8')

  console.log(`统计周期: ${formatDate(range.start)} 至 ${formatDate(range.end)}`)
  console.log(`已生成: ${outPath}`)
  console.log('')
  console.log(renderTsv(report))
}

main().catch((error) => {
  console.error(error?.stack || String(error))
  process.exitCode = 1
})
