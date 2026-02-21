import React from 'react'

interface ToolCall {
  name: string
  args: any
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  prefix?: string
}

export function ChatMessage({ role, content, toolCalls, prefix }: ChatMessageProps) {
  const formatContent = (text: string) => {
    const textStr = typeof text === 'string' ? text : String(text || '')
    return textStr
      .replace(/```([\s\S]*?)```/g, '<pre class="bg-[#1e1e1e] text-gray-100 p-3 rounded-lg my-2 text-sm overflow-x-auto"><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code class="bg-[#ececf1] px-1.5 py-0.5 rounded text-sm">$1</code>')
      .replace(/\n/g, '<br>')
  }

  return (
    <div className={`group flex gap-4 mb-6 ${role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
        role === 'user'
          ? 'bg-[#10a37f] text-white'
          : 'bg-[#ececf1] text-[#353740]'
      }`}>
        {role === 'user' ? 'U' : 'M'}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        {prefix && (
          <div className="text-xs text-[#6b7280] font-medium">
            {prefix}
          </div>
        )}

        {toolCalls && toolCalls.length > 0 && (
          <div className="space-y-2">
            {toolCalls.map((toolCall, idx) => (
              <div key={idx} className="bg-[#ececf1] rounded-lg p-3 border border-[#d9d9e3]">
                <div className="font-medium text-sm mb-1.5 flex items-center gap-2">
                  <span className="text-[#6b7280]">🔧</span>
                  {toolCall.name}
                </div>
                <pre className="bg-white p-2 rounded text-xs overflow-x-auto border border-[#d9d9e3]">
                  {JSON.stringify(toolCall.args, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}

        <div
          className="text-[15px] leading-7 text-[#353740]"
          dangerouslySetInnerHTML={{ __html: formatContent(content) }}
        />
      </div>
    </div>
  )
}
