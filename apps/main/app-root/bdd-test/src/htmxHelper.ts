import { JSDOM } from 'jsdom'

export interface HtmxForm {
  /**
   * Fill one or more form fields
   */
  fill(data: Record<string, string>): void
  /**
   * Submit the form using its HTMX attributes
   */
  submit(): Promise<Response>
  /**
   * Get the underlying form element's attribute
   */
  getAttribute(name: string): string | null
}

/**
 * Parses HTML and extracts a form by selector, providing helpers to simulate HTMX behavior
 */
export function parseHtmxForm(html: string, selector: string): HtmxForm {
  const dom = new JSDOM(html)
  const { document } = dom.window
  const formElement = document.querySelector(selector) as HTMLFormElement | null

  if (!formElement) {
    throw new Error(`Could not find form with selector: ${selector}`)
  }

  // Local state for filled data
  const fieldData: Record<string, string> = {}

  // Initialize with values from the form (if any)
  const inputs = formElement.querySelectorAll('input, select, textarea')
  inputs.forEach((el) => {
    const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    if (input.name && input.value) {
      fieldData[input.name] = input.value
    }
  })

  return {
    fill(data: Record<string, string>) {
      Object.assign(fieldData, data)
    },

    getAttribute(name: string) {
      return formElement.getAttribute(name)
    },

    async submit() {
      const hxPost = formElement.getAttribute('hx-post')
      const hxGet = formElement.getAttribute('hx-get')
      const hxPut = formElement.getAttribute('hx-put')
      const hxPatch = formElement.getAttribute('hx-patch')
      const hxDelete = formElement.getAttribute('hx-delete')
      const hxExt = formElement.getAttribute('hx-ext')

      const method = hxPost ? 'POST' : hxGet ? 'GET' : hxPut ? 'PUT' : hxPatch ? 'PATCH' : hxDelete ? 'DELETE' : 'POST'
      const url = hxPost || hxGet || hxPut || hxPatch || hxDelete || formElement.getAttribute('action') || ''
      let finalUrl = url

      if (!url) {
        throw new Error('Could not determine submission URL from form')
      }

      const headers: Record<string, string> = {
        'HX-Request': 'true',
      }

      let body: string | undefined = undefined

      if (method !== 'GET') {
        if (hxExt === 'json-enc') {
          headers['Content-Type'] = 'application/json'
          body = JSON.stringify(fieldData)
        } else {
          headers['Content-Type'] = 'application/x-www-form-urlencoded'
          const params = new URLSearchParams()
          for (const [key, value] of Object.entries(fieldData)) {
            params.append(key, value)
          }
          body = params.toString()
        }
      } else {
        // For GET, we append fields to URL
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(fieldData)) {
          params.append(key, value)
        }
        const queryString = params.toString()
        if (queryString) {
          finalUrl = finalUrl.includes('?') ? `${finalUrl}&${queryString}` : `${finalUrl}?${queryString}`
        }
      }

      return fetch(finalUrl, {
        method,
        headers,
        body,
      })
    },
  }
}
