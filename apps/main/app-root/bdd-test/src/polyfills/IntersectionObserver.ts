// jsdom doesn't implement IntersectionObserver
// Provide polyfill for testing environment

export class IntersectionObserverPolyfill implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin: string = '0px'
  readonly thresholds: ReadonlyArray<number> = [0]

  private callback: IntersectionObserverCallback
  private observedElements: Set<Element> = new Set()

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    if (options) {
      this.root = options.root || null
      this.rootMargin = options.rootMargin || '0px'
      this.thresholds = options.threshold
        ? Array.isArray(options.threshold)
          ? options.threshold
          : [options.threshold]
        : [0]
    }
  }

  observe(target: Element): void {
    if (!target || typeof target !== 'object') {
      return
    }

    this.observedElements.add(target)

    // Immediately trigger callback with entry indicating element is visible
    const entry: IntersectionObserverEntry = {
      target,
      boundingClientRect: new DOMRectReadOnly(0, 0, 0, 0),
      intersectionRect: new DOMRectReadOnly(0, 0, 0, 0),
      rootBounds: null,
      intersectionRatio: 1,
      isIntersecting: true,
      time: Date.now(),
    }

    this.callback([entry], this)
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target)
  }

  disconnect(): void {
    this.observedElements.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}
