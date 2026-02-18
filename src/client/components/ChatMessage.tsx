import React from 'react'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
}

export function ChatMessage({ role, content }: ChatMessageProps) {
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
      <div dangerouslySetInnerHTML={{ __html: formatContent(content) }} />
    </div>
  )
}
