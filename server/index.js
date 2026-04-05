import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Exa from 'exa-js'
import { buildMessages } from './prompt.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY
const EXA_API_KEY = process.env.EXA_API_KEY
const DASHSCOPE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'

const exa = EXA_API_KEY ? new Exa(EXA_API_KEY) : null

// Step 1: Use Qwen to extract search query from user input
async function extractSearchQuery(text) {
  const response = await fetch(DASHSCOPE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
    },
    body: JSON.stringify({
      model: 'qwen-max',
      messages: [
        {
          role: 'system',
          content: '你是一个关键词提取器。从用户提供的内容中提取核心事件/产品/技术名称，生成一个简短的英文搜索查询词（用于搜索最新新闻）。只输出搜索词，不要其他内容。例如输入关于Gemma 4的内容，输出："Google Gemma 4 release"'
        },
        {
          role: 'user',
          content: text.slice(0, 500)
        }
      ],
      temperature: 0.3,
      max_tokens: 50
    })
  })

  if (!response.ok) return null
  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

// Step 2: Search Exa for background info
async function searchBackground(query) {
  if (!exa || !query) return null

  try {
    const result = await exa.search(query, {
      type: 'auto',
      category: 'news',
      numResults: 3,
      startPublishedDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      contents: {
        highlights: {
          maxCharacters: 3000
        }
      }
    })

    if (!result.results?.length) return null

    // Compile highlights into background text
    const background = result.results.map(r => {
      const highlights = r.highlights?.join(' ') || ''
      return `[${r.title}] ${highlights}`
    }).join('\n\n')

    return background || null
  } catch (err) {
    console.error('Exa search error:', err.message)
    return null
  }
}

// Step 3: Rewrite with Qwen using original + background
async function rewrite(text, style, background) {
  const messages = buildMessages(text, style, background)

  const response = await fetch(DASHSCOPE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
    },
    body: JSON.stringify({
      model: 'qwen-max',
      messages,
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })
  })

  if (!response.ok) {
    const err = await response.text()
    console.error('DashScope error:', err)
    throw new Error(`AI 接口调用失败: ${response.status}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('AI 返回内容为空')

  const result = JSON.parse(content)
  if (!result.summary || !result.tags || !result.coverPrompt || !result.content) {
    throw new Error('AI 返回格式不正确')
  }

  // 清理AI返回的各种转义问题
  const cleanText = (s) => s
    .replace(/\\\\n/g, '\n')     // \\n → newline
    .replace(/\\n/g, '\n')       // \n → newline
    .replace(/\\\\/g, '')         // 去掉多余反斜杠
    .replace(/\\?\[n\]/g, '\n')  // [n] → newline
    .replace(/\n{3,}/g, '\n\n') // 超过2个连续换行压缩为2个
    .trim()
  result.content = cleanText(result.content)
  result.coverPrompt = cleanText(result.coverPrompt)

  return result
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
    // Step 1 & 2: Extract query and search in parallel
    const searchQuery = await extractSearchQuery(text)
    console.log('Search query:', searchQuery)

    let background = null
    if (searchQuery && exa) {
      background = await searchBackground(searchQuery)
      console.log('Background found:', background ? `${background.length} chars` : 'none')
    }

    // Step 3: Rewrite
    const result = await rewrite(text, style, background)
    result.searchQuery = searchQuery
    result.hasBackground = !!background

    res.json(result)
  } catch (err) {
    console.error('Rewrite error:', err)
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI 返回的内容无法解析为 JSON' })
    }
    res.status(500).json({ error: err.message })
  }
})

// Production: serve built frontend
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
  console.log(`X2RedNote server running on http://localhost:${PORT}`)
  console.log(`Exa search: ${exa ? 'enabled' : 'disabled (no EXA_API_KEY)'}`)
})
