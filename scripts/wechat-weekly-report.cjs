#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'wechat-weekly-report.config.json')
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'wechat-weekly-report.config.example.json')
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'outputs')
const DEFAULT_CACHE_PATH = path.join(DEFAULT_OUTPUT_DIR, 'wechat-weekly-report-cache.json')
const MESSAGE_PAGE_LIMIT = 10000
const DEFAULT_COMPLETED_MESSAGE_KEYWORD = '感谢您关注天天开源软件，现在拉您进专属技术交流群，有问题欢迎随时咨询~'
const DEFAULT_STAFF_NAME_PREFIXES = ['天天开源顾问', '天天开源助理', '天天开源产品']
const DEFAULT_STAFF_EXACT_NAMES = ['夏灵东', '罗文']

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG_PATH,
    outDir: DEFAULT_OUTPUT_DIR,
    cache: DEFAULT_CACHE_PATH,
    account: '',
    initConfig: false,
    selfTest: false,
    weekEnd: '',
    help: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--help' || item === '-h') args.help = true
    else if (item === '--init-config') args.initConfig = true
    else if (item === '--self-test') args.selfTest = true
    else if (item === '--config') args.config = argv[++i] || args.config
    else if (item.startsWith('--config=')) args.config = item.slice('--config='.length)
    else if (item === '--out-dir') args.outDir = argv[++i] || args.outDir
    else if (item.startsWith('--out-dir=')) args.outDir = item.slice('--out-dir='.length)
    else if (item === '--cache') args.cache = argv[++i] || args.cache
    else if (item.startsWith('--cache=')) args.cache = item.slice('--cache='.length)
    else if (item === '--account') args.account = argv[++i] || ''
    else if (item.startsWith('--account=')) args.account = item.slice('--account='.length)
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
  node scripts/wechat-weekly-report.cjs --account 账号1
  node scripts/wechat-weekly-report.cjs --account 账号2
  node scripts/wechat-weekly-report.cjs --week-end 2026-06-07
  node scripts/wechat-weekly-report.cjs --self-test

说明:
  - 默认统计“上周一 00:00:00 到上周日 23:59:59”，适合周一填写上周周报。
  - --week-end 可指定周报日期，也就是表格 A 列的周日日期。
  - 需要先启动 WeFlow、连接对应账号，并在设置中启用 HTTP API 服务。
  - 完善用户默认通过本周发出的固定话术识别，不依赖好友快照。
  - 一台电脑一次只能登录一个微信时，切换账号后分别用 --account 采集；脚本会缓存并自动合并成一份表。
  - 配置 groupStatsAccountName 后，社群周报和群友互动只统计该账号。
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

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function getAccountKey(account) {
  return String(account.id || account.name || account.apiBaseUrl || '').trim()
}

function findAccount(accounts, selector) {
  const key = String(selector || '').trim()
  if (!key) return null
  return accounts.find((account) => (
    getAccountKey(account) === key ||
    String(account.name || '').trim() === key ||
    String(account.id || '').trim() === key
  )) || null
}

function shouldCollectGroupsForAccount(config, account) {
  const target = String(config.groupStatsAccountName || config.groupStatsAccount || '').trim()
  if (!target) return true
  return getAccountKey(account) === target || String(account.name || '').trim() === target
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
      start: toUnixSeconds(start),
      end: toUnixSeconds(end),
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

async function fetchMessagesByKeyword(account, talker, keyword, start, end) {
  const messages = []
  let offset = 0
  while (true) {
    const params = {
      keyword,
      start: toUnixSeconds(start),
      end: toUnixSeconds(end),
      limit: MESSAGE_PAGE_LIMIT,
      offset
    }
    if (talker) params.talker = talker
    const json = await apiGet(account, '/api/v1/messages', params)
    const batch = Array.isArray(json.messages) ? json.messages : []
    messages.push(...batch)
    if (!json.hasMore || batch.length === 0) break
    offset += batch.length
  }
  return messages
}

function getCompletedMessageKeywords(config) {
  const configured = Array.isArray(config.completedMessageKeywords)
    ? config.completedMessageKeywords
    : [config.completedMessageKeyword]
  const keywords = configured
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  return keywords.length > 0 ? keywords : [DEFAULT_COMPLETED_MESSAGE_KEYWORD]
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, runWorker)
  await Promise.all(workers)
  return results
}

async function findCompletedFriendsBySentMessage(account, contacts, config, range) {
  const keywords = getCompletedMessageKeywords(config)
  if (keywords.length === 0) return { contacts: [], keywords }
  const friends = contacts.filter((contact) => contact?.type === 'friend' && String(contact.username || '').trim())
  const byUsername = new Map(friends.map((contact) => [String(contact.username || '').trim(), contact]))
  const concurrency = Math.max(1, Number(config.messageScanConcurrency || 5))
  const matchedByUsername = new Map()

  let globalSearchSupported = true
  for (const keyword of keywords) {
    try {
      const messages = await fetchMessagesByKeyword(account, '', keyword, range.start, range.end)
      for (const message of messages) {
        const sessionId = String(message.sessionId || message.talker || message.talkerId || '').trim()
        const contact = byUsername.get(sessionId)
        if (contact) matchedByUsername.set(sessionId, contact)
      }
    } catch (error) {
      globalSearchSupported = false
      console.warn(`提示: ${account.name || account.apiBaseUrl} 当前 HTTP API 不支持全局关键词搜索，将逐个好友会话扫描。`)
      break
    }
  }

  if (globalSearchSupported) {
    return { contacts: Array.from(matchedByUsername.values()), keywords }
  }

  await mapLimit(friends, concurrency, async (contact) => {
    const username = String(contact.username || '').trim()
    for (const keyword of keywords) {
      const messages = await fetchMessagesByKeyword(account, username, keyword, range.start, range.end)
      if (messages.length > 0) {
        matchedByUsername.set(username, contact)
        return
      }
    }
  })

  return { contacts: Array.from(matchedByUsername.values()), keywords }
}

async function fetchGroupMembers(account, chatroomId) {
  const json = await apiGet(account, '/api/v1/group-members', {
    chatroomId,
    forceRefresh: 0
  })
  return Array.isArray(json.members) ? json.members : []
}

function groupChatroomIds(group) {
  const configured = Array.isArray(group.chatroomIds) ? group.chatroomIds : [group.chatroomId]
  return Array.from(new Set(configured.map((item) => String(item || '').trim()).filter(Boolean)))
}

function memberUsername(member) {
  return String(member.wxid || member.username || '').trim()
}

function memberDisplayName(member) {
  return String(
    member.displayName ||
    member.groupNickname ||
    member.remark ||
    member.nickname ||
    member.alias ||
    memberUsername(member)
  ).trim()
}

function isExcludedStaffName(name, config) {
  const value = String(name || '').trim()
  if (!value) return false
  const prefixes = Array.isArray(config.staffNamePrefixes)
    ? config.staffNamePrefixes
    : DEFAULT_STAFF_NAME_PREFIXES
  const exactNames = Array.isArray(config.staffExactNames)
    ? config.staffExactNames
    : DEFAULT_STAFF_EXACT_NAMES
  return prefixes.some((prefix) => value.startsWith(String(prefix || '').trim())) ||
    exactNames.some((exact) => value.includes(String(exact || '').trim()))
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
  for (const role of ['names', 'adder']) {
    const roleRegex = new RegExp(`<link\\s+name=["']${role}["'][^>]*>([\\s\\S]*?)<\\/link>`, 'gi')
    let roleMatch
    while ((roleMatch = roleRegex.exec(raw)) !== null) {
      const memberRegex = /<member\b[^>]*>([\s\S]*?)<\/member>/gi
      let memberMatch
      while ((memberMatch = memberRegex.exec(roleMatch[1] || '')) !== null) {
        const body = memberMatch[1] || ''
        const username = extractTagValues(body, 'username')[0] || ''
        const nickname = extractTagValues(body, 'nickname')[0] || extractTagValues(body, 'displayname')[0] || ''
        if (username || nickname) {
          members.push({ username, displayName: nickname || username })
        }
      }
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

function compactFriend(contact) {
  return {
    username: String(contact.username || '').trim(),
    displayName: contactDisplayName(contact),
    remark: contact.remark || '',
    nickname: contact.nickname || '',
    alias: contact.alias || ''
  }
}

async function collectAccount(account, config, range, options = {}) {
  const contacts = await fetchContacts(account)
  const completedByMessage = await findCompletedFriendsBySentMessage(account, contacts, config, range)
  const firstSeenCache = config.__firstSeenCache || { map: {} }
  const weeklyNew = getWeeklyNewFriendContacts(account, contacts, config, range, firstSeenCache)
  if (weeklyNew.warning) console.warn(`提示: ${weeklyNew.warning}；非完善用户会缺少快照兜底，完善用户仍按固定话术统计。`)
  const weeklyNewFriends = weeklyNew.contacts
  const completed = new Set()
  const incomplete = new Set()
  const completedMessageUsernames = new Set()
  for (const friend of completedByMessage.contacts) {
    const username = String(friend.username || '').trim()
    if (!username) continue
    completed.add(username)
    completedMessageUsernames.add(username)
  }
  for (const friend of weeklyNewFriends) {
    const username = String(friend.username || '').trim()
    if (!username) continue
    if (completedMessageUsernames.has(username)) continue
    if (isCompletedFriend(friend, config.completedRemarkKeyword)) completed.add(username)
    else incomplete.add(username)
  }

  const groupStats = new Map()
  const includeGroups = options.includeGroups !== false

  for (const group of config.groups || []) {
    const chatroomIds = groupChatroomIds(group)
    if (!includeGroups || chatroomIds.length === 0) {
      groupStats.set(group.label, {
        joinPersonTimes: 0,
        activeSpeakerCount: 0,
        joinMembers: [],
        chatroomStats: [],
        skipped: true
      })
      continue
    }

    const activeSpeakers = new Set()
    const joinMembersAll = []
    const chatroomStats = []
    let joinPersonTimes = 0

    for (const chatroomId of chatroomIds) {
      const [messages, members] = await Promise.all([
        fetchMessages(account, chatroomId, range.start, range.end),
        fetchGroupMembers(account, chatroomId)
      ])
      const memberNames = new Map(members.map((member) => [memberUsername(member), memberDisplayName(member)]))
      const chatroomActiveSpeakers = new Set()
      const excludedStaffNames = new Set()
      let chatroomJoinPersonTimes = 0

      for (const message of messages) {
        if (isSpeechMessage(message, chatroomId)) {
          const sender = String(message.senderUsername).trim()
          const senderName = memberNames.get(sender) || sender
          if (isExcludedStaffName(senderName, config)) excludedStaffNames.add(senderName)
          else {
            activeSpeakers.add(sender)
            chatroomActiveSpeakers.add(sender)
          }
        }

        const joinMembers = extractJoinMembers(message)
        if (joinMembers.length > 0) {
          joinPersonTimes += joinMembers.length
          chatroomJoinPersonTimes += joinMembers.length
          joinMembersAll.push(...joinMembers)
        }
      }
      chatroomStats.push({
        chatroomId,
        joinPersonTimes: chatroomJoinPersonTimes,
        activeSpeakerCount: chatroomActiveSpeakers.size,
        excludedStaffNames: Array.from(excludedStaffNames).sort()
      })
    }

    groupStats.set(group.label, {
      joinPersonTimes,
      activeSpeakerCount: activeSpeakers.size,
      joinMembers: joinMembersAll,
      chatroomStats,
      skipped: false
    })
    console.log(`  ${group.label}: ${chatroomIds.length} 个群，进群 ${joinPersonTimes} 人次，群友发言 ${activeSpeakers.size} 人`)
  }

  return {
    account: getAccountKey(account),
    accountName: account.name || account.apiBaseUrl,
    contacts,
    weeklyNewFriends: [...completedByMessage.contacts, ...weeklyNewFriends].map(compactFriend).filter((item, index, array) => (
      item.username && array.findIndex((other) => other.username === item.username) === index
    )),
    completed,
    incomplete,
    groupStats
  }
}

function serializeAccountResult(result) {
  const groupStats = {}
  for (const [label, stat] of result.groupStats || new Map()) {
    groupStats[label] = {
      joinPersonTimes: Number(stat.joinPersonTimes || 0),
      activeSpeakerCount: Number(stat.activeSpeakerCount || 0),
      joinMembers: Array.isArray(stat.joinMembers) ? stat.joinMembers : [],
      chatroomStats: Array.isArray(stat.chatroomStats) ? stat.chatroomStats : [],
      skipped: Boolean(stat.skipped)
    }
  }
  return {
    account: result.account,
    accountName: result.accountName || result.account,
    collectedAt: Date.now(),
    weeklyNewFriends: result.weeklyNewFriends || [],
    completed: Array.from(result.completed || []),
    incomplete: Array.from(result.incomplete || []),
    groupStats
  }
}

function deserializeAccountResult(raw) {
  const groupStats = new Map()
  for (const [label, stat] of Object.entries(raw?.groupStats || {})) {
    groupStats.set(label, {
      joinPersonTimes: Number(stat?.joinPersonTimes || 0),
      activeSpeakerCount: Number(stat?.activeSpeakerCount || 0),
      joinMembers: Array.isArray(stat?.joinMembers) ? stat.joinMembers : [],
      chatroomStats: Array.isArray(stat?.chatroomStats) ? stat.chatroomStats : [],
      skipped: Boolean(stat?.skipped)
    })
  }
  return {
    account: raw?.account || '',
    accountName: raw?.accountName || raw?.account || '',
    weeklyNewFriends: Array.isArray(raw?.weeklyNewFriends) ? raw.weeklyNewFriends : [],
    completed: new Set(Array.isArray(raw?.completed) ? raw.completed : []),
    incomplete: new Set(Array.isArray(raw?.incomplete) ? raw.incomplete : []),
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

function getGroupStat(result, label) {
  if (!result) return null
  if (result.groupStats instanceof Map) return result.groupStats.get(label) || null
  return result.groupStats?.[label] || null
}

function buildRows(config, range, accountResults, groupAccountResult = null) {
  const weekEnd = formatDate(range.end)
  const groups = config.groups || []
  const groupLabels = groups.map((group) => group.label)
  const groupHeaderBlanks = groupLabels.slice(1).map(() => '')
  const allCompleted = new Set()
  const allIncomplete = new Set()
  const allWeeklyNewFriends = []
  const allJoinedFriends = new Set()

  for (const result of accountResults) {
    for (const username of result.completed) allCompleted.add(username)
    for (const username of result.incomplete) allIncomplete.add(username)
    allWeeklyNewFriends.push(...(result.weeklyNewFriends || []))
  }

  const weeklyNewIndexes = buildContactIndexes(allWeeklyNewFriends)
  for (const group of groups) {
    if (group.countForFriendJoin === false) continue
    const stat = getGroupStat(groupAccountResult, group.label)
    const joinMembers = Array.isArray(stat?.joinMembers) ? stat.joinMembers : []
    for (const member of joinMembers) {
      const contact = member.username
        ? weeklyNewIndexes.byUsername.get(member.username)
        : weeklyNewIndexes.byName.get(member.displayName)
      if (contact?.username) allJoinedFriends.add(contact.username)
    }
  }

  const completedApply = ''
  const incompleteApply = ''
  const completedPassed = allCompleted.size
  const incompletePassed = allIncomplete.size
  const passedTotal = completedPassed + incompletePassed
  const friendJoinCount = allJoinedFriends.size
  const friendJoinRate = completedPassed > 0 ? friendJoinCount / completedPassed : ''
  const groupJoinCounts = groups.map((group) => Number(getGroupStat(groupAccountResult, group.label)?.joinPersonTimes || 0))
  const groupActiveCounts = groups.map((group) => Number(getGroupStat(groupAccountResult, group.label)?.activeSpeakerCount || 0))

  return {
    weekEnd,
    sheets: [
      {
        name: '加好友周报',
        headerRows: [
          [
            '周报日期',
            '官网版本',
            '新用户（当周）',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '老用户（非当周）',
            '',
            '',
            '电话回访加好友人数',
            '',
            '',
            '季度回加人数',
            '',
            '',
            '',
            '',
            '总计',
            '',
            ''
          ],
          [
            '',
            '',
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
            '技术群进群率',
            '发申请人数',
            '通过总人数',
            '通过率',
            '发申请人数',
            '通过人数',
            '通过率',
            '发申请人数',
            '通过人数',
            '通过率',
            '入群人数',
            '入群率',
            '所有好友通过人数',
            '入群人数',
            '入群率'
          ]
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
          friendJoinRate,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          completedPassed,
          friendJoinCount,
          friendJoinRate
        ]
      },
      {
        name: '社群周报',
        headerRows: [
          [
            '周报日期',
            '累计人数',
            ...groupHeaderBlanks,
            '合计',
            '内部重复',
            '外部人员',
            '本周新人进群（不含退群）',
            ...groupHeaderBlanks,
            '合计',
            '移除广告用户',
            '有效进群用户'
          ],
          [
            '',
            ...groupLabels,
            '',
            '',
            '',
            ...groupLabels,
            '',
            '',
            ''
          ]
        ],
        row: [
          weekEnd,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          ...groupJoinCounts,
          groupJoinCounts.reduce((sum, value) => sum + value, 0),
          '',
          ''
        ]
      },
      {
        name: '群友互动周报',
        headerRows: [['周报日期', ...groupLabels, '总计']],
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
    const headerRows = Array.isArray(sheet.headerRows) ? sheet.headerRows : [sheet.header || []]
    for (const header of headerRows) {
      lines.push(header.map(toTsvValue).join('\t'))
    }
    lines.push(sheet.row.map(toTsvValue).join('\t'))
    lines.push('')
  }
  return lines.join('\n')
}

function loadReportCache(cachePath) {
  const resolved = expandHome(cachePath)
  if (!fs.existsSync(resolved)) return { path: resolved, weeks: {} }
  try {
    const raw = readJson(resolved)
    return {
      path: resolved,
      weeks: raw.weeks && typeof raw.weeks === 'object' ? raw.weeks : {}
    }
  } catch (error) {
    console.warn(`警告: 读取周报缓存失败，将重新创建: ${String(error)}`)
    return { path: resolved, weeks: {} }
  }
}

function saveReportCache(cache) {
  fs.mkdirSync(path.dirname(cache.path), { recursive: true })
  fs.writeFileSync(cache.path, `${JSON.stringify({ weeks: cache.weeks }, null, 2)}\n`, 'utf8')
}

function getWeekCache(cache, weekEnd) {
  if (!cache.weeks[weekEnd]) {
    cache.weeks[weekEnd] = {
      updatedAt: Date.now(),
      accounts: {}
    }
  }
  if (!cache.weeks[weekEnd].accounts || typeof cache.weeks[weekEnd].accounts !== 'object') {
    cache.weeks[weekEnd].accounts = {}
  }
  return cache.weeks[weekEnd]
}

function buildAccountResultsFromCache(accounts, weekCache) {
  const results = []
  const missing = []
  for (const account of accounts) {
    const key = getAccountKey(account)
    const raw = weekCache.accounts[key]
    if (!raw) {
      missing.push(key)
      continue
    }
    results.push(deserializeAccountResult(raw))
  }
  return { results, missing }
}

function resolveGroupAccountResult(config, accounts, accountResults) {
  const target = String(config.groupStatsAccountName || config.groupStatsAccount || '').trim()
  if (!target) return accountResults.find((result) => result.groupStats && result.groupStats.size > 0) || null
  const account = findAccount(accounts, target)
  const key = account ? getAccountKey(account) : target
  return accountResults.find((result) => result.account === key || result.accountName === target) || null
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`)
  }
}

function runSelfTest() {
  const range = getWeekRangeFromEnd('2026-06-07')
  const config = {
    completedRemarkKeyword: '已完善',
    groups: [
      { label: '医疗技术群', chatroomId: 'g1@chatroom', countForFriendJoin: true },
      { label: '医疗沙龙群', chatroomId: 'g2@chatroom', countForFriendJoin: false },
      { label: '企业技术群', chatroomId: 'g3@chatroom', countForFriendJoin: true },
      { label: '企业沙龙群', chatroomId: 'g4@chatroom', countForFriendJoin: false },
      { label: '教育技术群', chatroomId: 'g5@chatroom', countForFriendJoin: true },
      { label: '教育沙龙群', chatroomId: 'g6@chatroom', countForFriendJoin: false }
    ]
  }
  const accountResults = [
    {
      account: 'a1',
      completed: new Set(['wxid_a']),
      incomplete: new Set(['wxid_b']),
      weeklyNewFriends: [
        { username: 'wxid_a', displayName: 'A' },
        { username: 'wxid_b', displayName: 'B' }
      ],
      groupStats: new Map([
        ['医疗技术群', {
          joinPersonTimes: 3,
          activeSpeakerCount: 2,
          joinMembers: [{ username: 'wxid_a' }, { username: 'wxid_b' }, { username: 'wxid_x' }]
        }],
        ['医疗沙龙群', {
          joinPersonTimes: 1,
          activeSpeakerCount: 1,
          joinMembers: [{ username: 'wxid_b' }]
        }]
      ])
    },
    {
      account: 'a2',
      completed: new Set(['wxid_a']),
      incomplete: new Set(['wxid_c']),
      weeklyNewFriends: [
        { username: 'wxid_c', displayName: 'C' }
      ],
      groupStats: new Map([
        ['医疗技术群', { joinPersonTimes: 99, activeSpeakerCount: 99, joinMembers: [] }],
        ['医疗沙龙群', { joinPersonTimes: 99, activeSpeakerCount: 99, joinMembers: [] }]
      ])
    }
  ]
  const result = buildRows(config, range, accountResults, accountResults[0])
  const friendRow = result.sheets.find((sheet) => sheet.name === '加好友周报').row
  const groupRow = result.sheets.find((sheet) => sheet.name === '社群周报').row
  const activeRow = result.sheets.find((sheet) => sheet.name === '群友互动周报').row
  assertEqual(friendRow[4], 1, '完善用户通过人数按用户去重')
  assertEqual(friendRow[5], 2, '非完善用户通过人数按用户去重')
  assertEqual(friendRow[12], 2, '加好友周报技术群进群人数按新好友去重')
  assertEqual(groupRow[10], 3, '社群周报只取指定群统计账号')
  assertEqual(groupRow[11], 1, '社群周报不同群不去重')
  assertEqual(activeRow[1], 2, '群友互动只取指定群统计账号')
  assertEqual(friendRow.length, 28, '加好友周报输出列数')
  assertEqual(groupRow.length, 19, '社群周报输出列数')
  assertEqual(activeRow.length, 8, '群友互动周报输出列数')
  assertEqual(groupChatroomIds({ chatroomIds: ['g1@chatroom', 'g2@chatroom', 'g1@chatroom'] }).length, 2, '多群配置去重')
  assertEqual(isExcludedStaffName('天天开源助理-小王', {}), true, '工作人员前缀排除')
  assertEqual(isExcludedStaffName('罗文', {}), true, '工作人员姓名排除')
  assertEqual(isExcludedStaffName('天天开源商务-罗文', {}), true, '工作人员姓名关键字排除')
  assertEqual(isExcludedStaffName('普通群友', {}), false, '普通群友保留')
  const joinXml = `
    <link name="username"><member><username><![CDATA[inviter]]></username><nickname><![CDATA[邀请人]]></nickname></member></link>
    <link name="names"><member><username><![CDATA[new_member]]></username><nickname><![CDATA[新人]]></nickname></member></link>
    <link name="from"><member><username><![CDATA[sharer]]></username><nickname><![CDATA[分享人]]></nickname></member></link>
    <link name="adder"><member><username><![CDATA[scan_member]]></username><nickname><![CDATA[扫码新人]]></nickname></member></link>
  `
  const parsedJoinMembers = extractJoinMembersFromRaw(joinXml)
  assertEqual(parsedJoinMembers.length, 2, '进群解析只统计被邀请人和扫码入群人')
  assertEqual(parsedJoinMembers[0].username, 'new_member', '邀请人不计入进群')
  assertEqual(parsedJoinMembers[1].username, 'scan_member', '分享人不计入扫码进群')
  console.log('self-test ok')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  if (args.selfTest) {
    runSelfTest()
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

  const weekEnd = formatDate(range.end)
  const cache = loadReportCache(args.cache)
  const weekCache = getWeekCache(cache, weekEnd)
  const accountsToCollect = []
  if (args.account) {
    const activeAccount = findAccount(accounts, args.account)
    if (!activeAccount) throw new Error(`配置中找不到账号: ${args.account}`)
    accountsToCollect.push(activeAccount)
  } else if (accounts.length === 1) {
    accountsToCollect.push(accounts[0])
  } else {
    console.warn('提示: 配置了多个账号但未传 --account，本次只用已有缓存生成汇总；如需采集当前登录账号，请传 --account 账号名。')
  }

  for (const account of accountsToCollect) {
    const includeGroups = shouldCollectGroupsForAccount(config, account)
    console.log(`采集账号: ${account.name || account.apiBaseUrl}${includeGroups ? '（含群聊统计）' : '（仅好友统计）'}`)
    const fresh = await collectAccount(account, config, range, { includeGroups })
    weekCache.accounts[getAccountKey(account)] = serializeAccountResult(fresh)
    weekCache.updatedAt = Date.now()
    saveReportCache(cache)
  }

  const { results: accountResults, missing } = buildAccountResultsFromCache(accounts, weekCache)
  for (const key of missing) {
    console.warn(`警告: ${weekEnd} 缺少账号 ${key} 的好友统计缓存，请登录该微信后运行 --account ${key}`)
  }
  const groupAccountResult = resolveGroupAccountResult(config, accounts, accountResults)
  if (!groupAccountResult) {
    console.warn('警告: 缺少群聊统计账号缓存，社群周报和群友互动周报会输出 0。')
  }

  const report = buildRows(config, range, accountResults, groupAccountResult)
  fs.mkdirSync(args.outDir, { recursive: true })
  const outPath = path.join(args.outDir, `wechat-weekly-report-${report.weekEnd}.tsv`)
  fs.writeFileSync(outPath, renderTsv(report), 'utf8')

  console.log(`统计周期: ${formatDate(range.start)} 至 ${formatDate(range.end)}`)
  console.log(`缓存文件: ${cache.path}`)
  console.log(`已生成: ${outPath}`)
  console.log('')
  console.log(renderTsv(report))
}

main().catch((error) => {
  console.error(error?.stack || String(error))
  process.exitCode = 1
})
