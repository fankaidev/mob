const _computeInIframe = () => {
  try {
    // Check if URL contains /parabox/{projectId} pattern
    if (/\/parabox\/[^/]+/.test(window.location.pathname)) {
      return true
    }
    // Check if domain starts with dev and ends with paraflow.com or paraflow.biz (e.g., dev-1f9gehar.paraflow.com)
    if (/^dev.*\.paraflow\.(com|biz)$/.test(window.location.hostname)) {
      return true
    }
    return window.self !== window.top
  } catch {
    return true // cross-origin iframe
  }
}

export const inIframe = _computeInIframe()
