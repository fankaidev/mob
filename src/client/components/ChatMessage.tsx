import React from 'react'

interface ToolCall {
  name: string
  args: any
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
}

export function ChatMessage({ role, content, toolCalls }: ChatMessageProps) {
  const formatContent = (text: string) => {
    // Ensure text is a string
    const textStr = typeof text === 'string' ? text : String(text || '')
    return textStr
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>')
  }

  return (
    <div className={`message ${role}`}>
      {toolCalls && toolCalls.length > 0 && (
        <div className="tool-calls">
          {toolCalls.map((toolCall, idx) => (
            <div key={idx} className="tool-call">
              <strong>🔧 {toolCall.name}</strong>
              <pre style={{
                background: 'rgba(0,0,0,0.2)',
                padding: '8px',
                borderRadius: '4px',
                fontSize: '0.85em',
                overflow: 'auto'
              }}>
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
      <div dangerouslySetInnerHTML={{ __html: formatContent(content) }} />
    </div>
  )
}
