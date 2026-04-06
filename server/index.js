import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Exa from 'exa-js'
import { buildAgent1Messages, buildAgent2Messages, STYLE_META } from './prompt.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY
const EXA_API_KEY = process.env.EXA_API_KEY
const DASHSCOPE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'

const exa = EXA_API_KEY ? new Exa(EXA_API_KEY) : null

// Helper: call Qwen
async function callQwen(messages, { temperature = 0.7, jsonMode = true, maxTokens } = {}) {
  const body = {
    model: 'qwen-max',
    messages,
    temperature
  }
  if (jsonMode) body.response_format = { type: 'json_object' }
  if (maxTokens) body.max_tokens = maxTokens

  const response = await fetch(DASHSCOPE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const err = await response.text()
    console.error('DashScope error:', err)
    throw new Error(`AI接口调用失败: ${response.status}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('AI返回内容为空')

  return content
}

// Step 0: Extract search queries — 事件本身 + 触发背景
async function extractSearchQueries(text) {
  try {
    const content = await callQwen([
      {
        role: 'system',
        content: `分析用户内容，提取两个英文搜索查询词：
1. event_query: 这件事本身是什么（产品/事件/技术名称）
2. context_query: 这件事背后的触发原因或行业背景（为什么现在发生？是因为什么行业趋势、竞争对手动作、政策变化？）

输出JSON: {"event_query": "...", "context_query": "..."}`
      },
      { role: 'user', content: text.slice(0, 800) }
    ], { temperature: 0.3, jsonMode: true, maxTokens: 150 })
    return JSON.parse(content)
  } catch {
    return null
  }
}

// Step 1: Search Exa — 支持多查询并行
async function searchExa(query, options = {}) {
  if (!exa || !query) return null
  try {
    const result = await exa.search(query, {
      type: 'auto',
      category: 'news',
      numResults: options.numResults || 3,
      startPublishedDate: new Date(Date.now() - (options.days || 7) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      contents: { highlights: { maxCharacters: options.maxChars || 3000 } }
    })
    if (!result.results?.length) return null
    return result.results.map(r => {
      const highlights = r.highlights?.join(' ') || ''
      return `[${r.title}] ${highlights}`
    }).join('\n\n') || null
  } catch (err) {
    console.error('Exa search error:', err.message)
    return null
  }
}

// 两轮搜索：事件 + 触发背景
async function searchAllBackground(queries) {
  if (!exa || !queries) return { event: null, context: null }

  // 两轮并行搜索
  const [eventBg, contextBg] = await Promise.all([
    searchExa(queries.event_query, { numResults: 3, days: 7 }),
    searchExa(queries.context_query, { numResults: 3, days: 30 })
  ])

  return { event: eventBg, context: contextBg }
}

// Clean text helper
function cleanText(s) {
  return s
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '')
    .replace(/\\?\[n\]/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ============ 风格列表 ============
app.get('/api/styles', (req, res) => {
  res.json(STYLE_META)
})

// ============ Step 1 API: 素材整理 ============
app.post('/api/briefing', async (req, res) => {
  const { news, kol, personal } = req.body

  const hasInput = news?.trim() || kol?.trim() || personal?.trim()
  if (!hasInput) {
    return res.status(400).json({ error: '请至少填写一个输入框' })
  }
  if (!DASHSCOPE_API_KEY) {
    return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' })
  }

  // SSE 流式推送进度
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const sendStep = (msg) => {
    res.write(`data: ${JSON.stringify({ type: 'step', detail: msg })}\n\n`)
  }

  try {
    // 合并所有输入用于提取搜索词
    const allText = [news, kol, personal].filter(Boolean).join('\n')

    // Step 1: 提取搜索关键词（事件 + 触发背景）
    sendStep('正在分析内容，提取搜索关键词...')
    const queries = await extractSearchQueries(allText)
    console.log('Search queries:', queries)

    // Step 2: 两轮 Exa 搜索并行
    let background = { event: null, context: null }
    if (queries && exa) {
      const q1 = queries.event_query || ''
      const q2 = queries.context_query || ''
      sendStep(`正在搜索: ① ${q1} ② ${q2}`)
      background = await searchAllBackground(queries)
      console.log('Event bg:', background.event ? `${background.event.length} chars` : 'none')
      console.log('Context bg:', background.context ? `${background.context.length} chars` : 'none')
    }

    // Step 3: Agent 1 — 素材整理 + 关联分析
    sendStep('AI正在深度分析素材、建立关联...')
    console.log('Agent 1: 素材整理 + 关联分析...')
    const agent1Messages = buildAgent1Messages({ news, kol, personal }, background)
    const agent1Raw = await callQwen(agent1Messages, { temperature: 0.3 })
    const briefing = JSON.parse(agent1Raw)
    console.log('Briefing:', briefing.oneLiner)

    // 推送结果
    const searchInfo = queries ? `${queries.event_query} | ${queries.context_query}` : ''
    res.write(`data: ${JSON.stringify({
      type: 'result',
      briefing,
      searchQuery: searchInfo,
      hasBackground: !!(background.event || background.context)
    })}\n\n`)
    res.end()
  } catch (err) {
    console.error('Briefing error:', err)
    const errorMsg = err instanceof SyntaxError ? 'AI返回内容无法解析' : err.message
    res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`)
    res.end()
  }
})

// ============ Step 2 API: 文案生成 ============
app.post('/api/generate', async (req, res) => {
  const { briefing, style = 'news' } = req.body

  if (!briefing) {
    return res.status(400).json({ error: '请先完成素材整理' })
  }
  if (!DASHSCOPE_API_KEY) {
    return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' })
  }

  try {
    console.log('Agent 2: 文案创作...')
    const agent2Messages = buildAgent2Messages(briefing, style)
    const agent2Raw = await callQwen(agent2Messages, { temperature: 0.7 })
    const result = JSON.parse(agent2Raw)

    if (!result.summary || !result.tags || !result.coverPrompt || !result.content) {
      throw new Error('AI返回格式不正确')
    }

    result.content = cleanText(result.content)
    result.coverPrompt = cleanText(result.coverPrompt)

    res.json(result)
  } catch (err) {
    console.error('Generate error:', err)
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI返回内容无法解析' })
    }
    res.status(500).json({ error: err.message })
  }
})

// Serve frontend in production
const clientDist = join(__dirname, '../client/dist')
import('fs').then(fs => {
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist))
    app.get('*', (req, res) => res.sendFile(join(clientDist, 'index.html')))
    console.log('Serving frontend from client/dist')
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`X2RedNote running on http://localhost:${PORT}`)
  console.log(`Exa: ${exa ? 'enabled' : 'disabled'}`)
})
