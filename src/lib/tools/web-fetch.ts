import { Type, type Static } from '@sinclair/typebox'
import type { AgentTool } from '../pi-agent/types'

// ============================================================================
// WebFetch Tool
// ============================================================================
const webFetchSchema = Type.Object({
  url: Type.String({
    description: 'The URL to fetch content from (must be a valid HTTP/HTTPS URL)'
  }),
  prompt: Type.Optional(Type.String({
    description: 'Optional prompt to describe what information to extract from the page. If not provided, returns the full content.'
  })),
})

/**
 * Convert HTML to plain text/markdown
 * Strips tags but preserves structure
 */
function htmlToText(html: string): string {
  let text = html

  // Remove script and style tags with their content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')

  // Convert common block elements to newlines
  text = text.replace(/<\/?(div|p|br|hr|h[1-6]|ul|ol|li|table|tr|th|td|blockquote|pre|article|section|header|footer|nav|aside)[^>]*>/gi, '\n')

  // Convert links to markdown style
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)')

  // Convert bold/strong
  text = text.replace(/<(b|strong)[^>]*>([^<]*)<\/(b|strong)>/gi, '**$2**')

  // Convert italic/em
  text = text.replace(/<(i|em)[^>]*>([^<]*)<\/(i|em)>/gi, '*$2*')

  // Convert code
  text = text.replace(/<code[^>]*>([^<]*)<\/code>/gi, '`$1`')

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&apos;/g, "'")

  // Clean up whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n')  // Max 2 newlines
  text = text.replace(/[ \t]+/g, ' ')  // Collapse horizontal whitespace
  text = text.trim()

  return text
}

/**
 * Truncate content if too long
 */
function truncateContent(content: string, maxLength: number = 50000): string {
  if (content.length <= maxLength) {
    return content
  }
  return content.slice(0, maxLength) + '\n\n... [Content truncated due to length]'
}

export function createWebFetchTool(): AgentTool<typeof webFetchSchema> {
  return {
    label: 'WebFetch',
    name: 'web_fetch',
    description: `Fetch content from a URL and return it as text.
- Takes a URL and an optional prompt as input
- Fetches the URL content, converts HTML to markdown/text
- Returns the processed content
- Use this tool when you need to retrieve and analyze web content
- HTTP URLs will be automatically upgraded to HTTPS
- The prompt parameter can describe what information you want to extract`,
    parameters: webFetchSchema,
    execute: async (_toolCallId: string, args: Static<typeof webFetchSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      let url = args.url.trim()

      // Validate URL
      if (!url) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: URL is required'
          }],
          details: { error: 'URL is required' }
        }
      }

      // Upgrade HTTP to HTTPS
      if (url.startsWith('http://')) {
        url = url.replace('http://', 'https://')
      }

      // Ensure URL has protocol
      if (!url.startsWith('https://')) {
        url = 'https://' + url
      }

      try {
        // Validate URL format
        new URL(url)
      } catch {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Invalid URL format: ${url}`
          }],
          details: { error: 'Invalid URL format', url }
        }
      }

      try {
        // Fetch the URL with a timeout
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WebFetchBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: signal || controller.signal,
          redirect: 'follow',
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: HTTP ${response.status} ${response.statusText} when fetching ${url}`
            }],
            details: {
              error: `HTTP ${response.status}`,
              url,
              status: response.status,
              statusText: response.statusText
            }
          }
        }

        const contentType = response.headers.get('content-type') || ''
        const rawContent = await response.text()

        let processedContent: string

        // Process based on content type
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          processedContent = htmlToText(rawContent)
        } else if (contentType.includes('application/json')) {
          try {
            const json = JSON.parse(rawContent)
            processedContent = JSON.stringify(json, null, 2)
          } catch {
            processedContent = rawContent
          }
        } else {
          // Plain text or other
          processedContent = rawContent
        }

        // Truncate if too long
        processedContent = truncateContent(processedContent)

        // Build response
        let resultText = `# Content from ${url}\n\n`

        if (args.prompt) {
          resultText += `**Extraction prompt:** ${args.prompt}\n\n`
        }

        resultText += processedContent

        return {
          content: [{
            type: 'text' as const,
            text: resultText
          }],
          details: {
            url,
            contentType,
            originalSize: rawContent.length,
            processedSize: processedContent.length,
            prompt: args.prompt
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Check for specific error types
        if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: Request timed out when fetching ${url}`
            }],
            details: { error: 'Request timeout', url }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Error fetching URL: ${errorMessage}`
          }],
          details: { error: errorMessage, url }
        }
      }
    }
  }
}
