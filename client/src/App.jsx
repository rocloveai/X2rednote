import { useState } from 'react'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={copy} className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition shrink-0">
      {copied ? '已复制' : '复制'}
    </button>
  )
}

export default function App() {
  const [input, setInput] = useState('')
  const [style, setStyle] = useState('news')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('x2rednote_history') || '[]') }
    catch { return [] }
  })
  const [showHistory, setShowHistory] = useState(false)

  const handleRewrite = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, style })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `请求失败 (${res.status})`)
      }
      const data = await res.json()
      setResult(data)

      const entry = { input: input.slice(0, 100), result: data, time: Date.now() }
      const updated = [entry, ...history].slice(0, 10)
      setHistory(updated)
      localStorage.setItem('x2rednote_history', JSON.stringify(updated))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadHistory = (item) => {
    setResult(item.result)
    setShowHistory(false)
  }

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem('x2rednote_history')
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">X2RedNote</h1>
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs px-3 py-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition"
          >
            {showHistory ? '关闭历史' : `历史 (${history.length})`}
          </button>
        )}
      </div>

      {/* 历史记录 */}
      {showHistory && (
        <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500">最近10次改写</span>
            <button onClick={clearHistory} className="text-xs text-gray-600 hover:text-gray-400">清空</button>
          </div>
          <div className="space-y-2">
            {history.map((item, i) => (
              <button
                key={i}
                onClick={() => loadHistory(item)}
                className="w-full text-left p-2 rounded bg-gray-800/50 hover:bg-gray-800 transition"
              >
                <p className="text-sm text-gray-300 truncate">{item.result?.summary || item.input}</p>
                <p className="text-xs text-gray-600 mt-0.5">{new Date(item.time).toLocaleString('zh-CN')}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 左侧：输入 */}
        <div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴X平台内容（KOL评论、文章片段、推文等混合内容均可）..."
            className="w-full h-56 p-4 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 resize-y focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center gap-3 mt-3">
            {[['news', '资讯分析'], ['opinion', '深度观点']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setStyle(k)}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                  style === k ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={handleRewrite}
              disabled={loading || !input.trim()}
              className="px-5 py-1.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition ml-auto"
            >
              {loading ? '改写中...' : '开始改写'}
            </button>
          </div>
          {error && (
            <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">{error}</div>
          )}
        </div>

        {/* 右侧：输出 */}
        <div>
          {loading && (
            <div className="text-center text-gray-400 py-20">
              <div className="inline-block w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin mb-3" />
              <p>正在提取关键词 → 搜索背景 → 改写...</p>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-4">
              {result.searchQuery && (
                <div className="p-2 bg-gray-900/50 rounded-lg text-xs text-gray-500">
                  搜索词：{result.searchQuery} {result.hasBackground ? '✓ 已补充背景' : '· 未找到相关新闻'}
                </div>
              )}

              <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">帖子简介</span>
                  <CopyButton text={result.summary} />
                </div>
                <p className="text-gray-100">{result.summary}</p>
              </div>

              <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">话题标签</span>
                  <CopyButton text={result.tags.join(' ')} />
                </div>
                <p className="text-blue-400">{result.tags.join(' ')}</p>
              </div>

              <div className="p-3 bg-gray-900 rounded-lg border border-amber-800/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-amber-500">封面 Gemini Prompt</span>
                  <CopyButton text={result.coverPrompt} />
                </div>
                <p className="text-gray-300 text-sm whitespace-pre-wrap">{result.coverPrompt}</p>
              </div>

              <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">正文文案</span>
                  <CopyButton text={result.content} />
                </div>
                <p className="text-gray-100 text-sm whitespace-pre-wrap leading-relaxed">{result.content}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
