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

const STYLES = {
  flash:   { name: '快讯速递', desc: '30秒说清楚发生了什么',       color: 'bg-blue-600',   ring: 'ring-blue-500' },
  deep:    { name: '深度解读', desc: '分析为什么重要、接下来怎样', color: 'bg-purple-600', ring: 'ring-purple-500' },
  story:   { name: '故事叙事', desc: '有画面感，像朋友在聊天',     color: 'bg-green-600',  ring: 'ring-green-500' },
  hot:     { name: '辣评短评', desc: '观点鲜明，敢说真话',         color: 'bg-orange-600', ring: 'ring-orange-500' },
  explain: { name: '科普教学', desc: '零门槛，生活化类比',         color: 'bg-cyan-600',   ring: 'ring-cyan-500' },
}

export default function App() {
  // Step 1: 输入
  const [news, setNews] = useState('')
  const [kol, setKol] = useState('')
  const [personal, setPersonal] = useState('')

  // Step 2: 素材简报
  const [briefing, setBriefing] = useState(null)
  const [editableBriefing, setEditableBriefing] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [hasBackground, setHasBackground] = useState(false)

  // Step 3: 最终输出
  const [style, setStyle] = useState('flash')
  const [result, setResult] = useState(null)

  // 状态
  const [loadingBriefing, setLoadingBriefing] = useState(false)
  const [loadingGenerate, setLoadingGenerate] = useState(false)
  const [stepDetail, setStepDetail] = useState('')
  const [error, setError] = useState('')

  // Step 1: 整理素材
  const handleBriefing = async () => {
    if (!news.trim() && !kol.trim() && !personal.trim()) return
    setLoadingBriefing(true)
    setError('')
    setBriefing(null)
    setEditableBriefing(null)
    setResult(null)
    setStepDetail('')

    try {
      const res = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ news, kol, personal })
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'step') {
              setStepDetail(data.detail)
            } else if (data.type === 'result') {
              setBriefing(data.briefing)
              setEditableBriefing(data.briefing)
              setSearchQuery(data.searchQuery || '')
              setHasBackground(data.hasBackground || false)
            } else if (data.type === 'error') {
              throw new Error(data.error)
            }
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) throw e
          }
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingBriefing(false)
      setStepDetail('')
    }
  }

  // Step 2: 生成文案
  const handleGenerate = async (overrideStyle) => {
    if (!editableBriefing) return
    const useStyle = overrideStyle || style
    setLoadingGenerate(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefing: editableBriefing, style: useStyle })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `请求失败 (${res.status})`)
      }
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingGenerate(false)
    }
  }

  // 重置
  const handleReset = () => {
    setNews('')
    setKol('')
    setPersonal('')
    setBriefing(null)
    setEditableBriefing(null)
    setResult(null)
    setError('')
    setSearchQuery('')
    setHasBackground(false)
  }

  // 编辑简报字段
  const updateBriefingField = (field, value) => {
    setEditableBriefing(prev => ({ ...prev, [field]: value }))
  }

  const updateKeyPoint = (index, value) => {
    setEditableBriefing(prev => {
      const keyPoints = [...prev.keyPoints]
      keyPoints[index] = value
      return { ...prev, keyPoints }
    })
  }

  const removeKeyPoint = (index) => {
    setEditableBriefing(prev => ({
      ...prev,
      keyPoints: prev.keyPoints.filter((_, i) => i !== index)
    }))
  }

  const addKeyPoint = () => {
    setEditableBriefing(prev => ({
      ...prev,
      keyPoints: [...(prev.keyPoints || []), '']
    }))
  }

  const hasInput = news.trim() || kol.trim() || personal.trim()
  const currentStyle = STYLES[style]

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">X2RedNote</h1>
        {(briefing || result) && (
          <button onClick={handleReset} className="text-xs px-3 py-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition">
            重新开始
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm mb-6">{error}</div>
      )}

      {/* ============ Step 1: 输入素材 ============ */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
          <h2 className="text-lg font-semibold">输入素材</h2>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">新闻 / 文章内容</label>
            <textarea
              value={news}
              onChange={(e) => setNews(e.target.value)}
              placeholder="粘贴新闻报道、技术文档、官方公告等事实性内容..."
              className="w-full h-32 p-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 resize-y focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">KOL 观点 / 推文</label>
            <textarea
              value={kol}
              onChange={(e) => setKol(e.target.value)}
              placeholder="粘贴行业人士的评论、推文、观点..."
              className="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 resize-y focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">我的想法（可选）</label>
            <textarea
              value={personal}
              onChange={(e) => setPersonal(e.target.value)}
              placeholder="你想强调的角度、补充信息、或想让文案突出的重点..."
              className="w-full h-20 p-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 resize-y focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>
        </div>

        <button
          onClick={handleBriefing}
          disabled={loadingBriefing || !hasInput}
          className="mt-4 w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition"
        >
          {loadingBriefing ? '整理中...' : '整理素材'}
        </button>

        {loadingBriefing && stepDetail && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin shrink-0" />
            <span>{stepDetail}</span>
          </div>
        )}
      </div>

      {/* ============ Step 2: 素材简报 + 选风格 ============ */}
      {editableBriefing && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
            <h2 className="text-lg font-semibold">素材简报</h2>
            <span className="text-xs text-gray-500 ml-2">可直接编辑，确认后选风格生成</span>
          </div>

          {searchQuery && (
            <div className="mb-3 p-2 bg-gray-900/50 rounded text-xs text-gray-500">
              Exa搜索: {searchQuery} {hasBackground ? ' ✓ 已补充背景' : ' · 未找到相关新闻'}
            </div>
          )}

          <div className="space-y-3 p-4 bg-gray-900 rounded-lg border border-gray-800">
            <div>
              <label className="block text-xs text-gray-500 mb-1">一句话总结</label>
              <input
                type="text"
                value={editableBriefing.oneLiner || ''}
                onChange={(e) => updateBriefingField('oneLiner', e.target.value)}
                className="w-full p-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm focus:outline-none focus:border-green-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">为什么现在发生（触发原因）</label>
              <textarea
                value={editableBriefing.whyNow || ''}
                onChange={(e) => updateBriefingField('whyNow', e.target.value)}
                className="w-full h-16 p-2 bg-gray-800 border border-amber-700/50 rounded text-gray-100 text-sm resize-y focus:outline-none focus:border-amber-500"
                placeholder="AI会分析触发事件和行业关联..."
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">为什么值得关注</label>
              <textarea
                value={editableBriefing.whyItMatters || ''}
                onChange={(e) => updateBriefingField('whyItMatters', e.target.value)}
                className="w-full h-16 p-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm resize-y focus:outline-none focus:border-green-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">核心信息点</label>
              <div className="space-y-2">
                {editableBriefing.keyPoints?.map((point, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={point}
                      onChange={(e) => updateKeyPoint(i, e.target.value)}
                      className="flex-1 p-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm focus:outline-none focus:border-green-500"
                    />
                    <button
                      onClick={() => removeKeyPoint(i)}
                      className="px-2 text-gray-600 hover:text-red-400 transition text-sm"
                    >x</button>
                  </div>
                ))}
                <button onClick={addKeyPoint} className="text-xs text-gray-500 hover:text-gray-300 transition">
                  + 添加信息点
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">补充背景</label>
              <textarea
                value={editableBriefing.context || ''}
                onChange={(e) => updateBriefingField('context', e.target.value)}
                className="w-full h-16 p-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm resize-y focus:outline-none focus:border-green-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">叙述角度</label>
              <input
                type="text"
                value={editableBriefing.suggestedAngle || ''}
                onChange={(e) => updateBriefingField('suggestedAngle', e.target.value)}
                className="w-full p-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm focus:outline-none focus:border-green-500"
              />
            </div>
          </div>

          {/* 风格选择 */}
          <div className="mt-5">
            <label className="block text-xs text-gray-500 mb-2">选择文案风格</label>
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(STYLES).map(([key, s]) => (
                <button
                  key={key}
                  onClick={() => setStyle(key)}
                  className={`p-2.5 rounded-lg border transition text-left ${
                    style === key
                      ? `${s.color} border-transparent ring-2 ${s.ring} ring-offset-2 ring-offset-gray-950`
                      : 'bg-gray-900 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className={`text-sm font-medium ${style === key ? 'text-white' : 'text-gray-200'}`}>
                    {s.name}
                  </div>
                  <div className={`text-xs mt-0.5 ${style === key ? 'text-white/70' : 'text-gray-500'}`}>
                    {s.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={() => handleBriefing()}
              disabled={loadingBriefing}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition"
            >
              重新整理
            </button>
            <button
              onClick={() => handleGenerate()}
              disabled={loadingGenerate}
              className={`flex-1 py-2.5 ${currentStyle.color} hover:opacity-90 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition`}
            >
              {loadingGenerate ? '生成中...' : `用「${currentStyle.name}」风格生成文案`}
            </button>
          </div>

          {loadingGenerate && (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-600 border-t-red-500 rounded-full animate-spin shrink-0" />
              <span>正在用「{currentStyle.name}」风格创作文案...</span>
            </div>
          )}
        </div>
      )}

      {/* ============ Step 3: 最终输出 ============ */}
      {result && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
            <h2 className="text-lg font-semibold">生成结果</h2>
            <span className={`text-xs px-2 py-0.5 rounded ${currentStyle.color} text-white ml-2`}>
              {currentStyle.name}
            </span>
          </div>

          <div className="space-y-4">
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

            {/* 换风格重新生成 */}
            <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800">
              <p className="text-xs text-gray-500 mb-2">不满意？换个风格试试，素材不用重新整理：</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(STYLES).filter(([k]) => k !== style).map(([key, s]) => (
                  <button
                    key={key}
                    onClick={() => { setStyle(key); handleGenerate(key) }}
                    disabled={loadingGenerate}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition"
                  >
                    换「{s.name}」
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
