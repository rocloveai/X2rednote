import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Exa from 'exa-js'
import { buildAgent1Messages, buildAgent2Messages } from './prompt.js'

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

// Step 0: Extract search query
async function extractSearchQuery(text) {
  try {
    const content = await callQwen([
      {
        role: 'system',
        content: '从用户内容中提取核心事件/产品/技术名称，生成一个简短的英文搜索查询词。只输出搜索词，不要其他内容。'
      },
      { role: 'user', content: text.slice(0, 500) }
    ], { temperature: 0.3, jsonMode: false, maxTokens: 50 })
    return content.trim()
  } catch {
    return null
  }
}

// Step 1: Search Exa
async function searchBackground(query) {
  if (!exa || !query) return null
  try {
    const result = await exa.search(query, {
      type: 'auto',
      category: 'news',
      numResults: 3,
      startPublishedDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      contents: { highlights: { maxCharacters: 3000 } }
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

app.post('/api/rewrite', async (req, res) => {
  const { text, style = 'news' } = req.body

  if (!text?.trim()) {
    return res.status(400).json({ error: '请提供要改写的内容' })
  }
  if (!DASHSCOPE_API_KEY) {
    return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' })
  }

  try {
    // Step 0: Extract search query
    const searchQuery = await extractSearchQuery(text)
    console.log('Search query:', searchQuery)

    // Step 1: Search background
    let background = null
    if (searchQuery && exa) {
      background = await searchBackground(searchQuery)
      console.log('Background:', background ? `${background.length} chars` : 'none')
    }

    // Step 2: Agent 1 — 素材整理
    console.log('Agent 1: 素材整理...')
    const agent1Messages = buildAgent1Messages(text, background)
    const agent1Raw = await callQwen(agent1Messages, { temperature: 0.3 })
    const briefing = JSON.parse(agent1Raw)
    console.log('Briefing:', briefing.oneLiner)

    // Step 3: Agent 2 — 文案创作
    console.log('Agent 2: 文案创作...')
    const agent2Messages = buildAgent2Messages(briefing, style)
    const agent2Raw = await callQwen(agent2Messages, { temperature: 0.7 })
    const result = JSON.parse(agent2Raw)

    if (!result.summary || !result.tags || !result.coverPrompt || !result.content) {
      throw new Error('AI返回格式不正确')
    }

    result.content = cleanText(result.content)
    result.coverPrompt = cleanText(result.coverPrompt)
    result.searchQuery = searchQuery
    result.hasBackground = !!background
    result.briefing = briefing  // 返回素材简报供参考

    res.json(result)
  } catch (err) {
    console.error('Error:', err)
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
