import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
  return (
    <div className={`group flex mb-6 ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {/* Content */}
      <div className={`max-w-[75%] space-y-2 ${
        role === 'user'
          ? 'bg-[#f7f7f8] rounded-lg px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
          : ''
      }`}>
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

        <div className="prose prose-sm max-w-none text-[#353740]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: ({ node, inline, className, children, ...props }: any) => {
                if (inline) {
                  return (
                    <code className="bg-[#ececf1] px-1.5 py-0.5 rounded text-sm" {...props}>
                      {children}
                    </code>
                  )
                }
                return (
                  <pre className="bg-[#1e1e1e] text-gray-100 p-3 rounded-lg my-2 text-sm overflow-x-auto">
                    <code {...props}>{children}</code>
                  </pre>
                )
              },
              p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
              ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
              ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2" {...props} />,
              li: ({ node, ...props }: any) => <li className="mb-1" {...props} />,
              a: ({ node, ...props }: any) => <a className="text-[#10a37f] hover:underline" {...props} />,
              h1: ({ node, ...props }: any) => <h1 className="text-2xl font-bold mb-2 mt-4" {...props} />,
              h2: ({ node, ...props }: any) => <h2 className="text-xl font-bold mb-2 mt-3" {...props} />,
              h3: ({ node, ...props }: any) => <h3 className="text-lg font-bold mb-2 mt-2" {...props} />,
              blockquote: ({ node, ...props }: any) => (
                <blockquote className="border-l-4 border-[#d9d9e3] pl-4 italic my-2" {...props} />
              ),
              table: ({ node, ...props }: any) => (
                <div className="overflow-x-auto my-2">
                  <table className="border-collapse border border-[#d9d9e3]" {...props} />
                </div>
              ),
              th: ({ node, ...props }: any) => (
                <th className="border border-[#d9d9e3] px-3 py-2 bg-[#f7f7f8] font-semibold" {...props} />
              ),
              td: ({ node, ...props }: any) => (
                <td className="border border-[#d9d9e3] px-3 py-2" {...props} />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
