// jsdom doesn't implement ResizeObserver
// Provide polyfill for testing environment

export class ResizeObserverPolyfill implements ResizeObserver {
  private callback: ResizeObserverCallback
  private observedElements: Set<Element> = new Set()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element): void {
    if (!target || typeof target !== 'object') {
      return
    }

    this.observedElements.add(target)

    // Immediately trigger callback with initial size
    const htmlElement = target instanceof HTMLElement ? target : null
    const width = htmlElement?.offsetWidth || 0
    const height = htmlElement?.offsetHeight || 0

    const contentRect = new DOMRectReadOnly(0, 0, width, height)

    const entry: ResizeObserverEntry = {
      target,
      contentRect,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }

    this.callback([entry], this)
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target)
  }

  disconnect(): void {
    this.observedElements.clear()
  }
}
