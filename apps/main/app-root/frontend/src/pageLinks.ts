
// Page navigation registry - centralized link management to prevent broken links
//
// Usage in components:
//   import { pageLinks } from '../pageLinks'
//   <Link to={pageLinks.Login()}>Login</Link>
//   navigate(pageLinks.PollVotingForm(id))
//
// Key naming convention: Keys MUST match the page TSX file name (without .tsx extension)
// e.g., Login.tsx -> pageLinks.Login(), PollList.tsx -> pageLinks.PollList()

// global_shortcut_xxx are not Pages
// one of the pageLink must be /, otherwise global_shortcut_home will be a broken link
export const pageLinks = {
  Chat: () => '/',
  FileExplorer: () => '/files',

  global_shortcut_home: () => '/', // MUST BE '/', do not change
  global_shortcut_login: () => '/login',
}


export function getPageLinkFullUrl<K extends keyof typeof pageLinks>(
  pageName: K,
  ...args: Parameters<(typeof pageLinks)[K]>
): string {
  const linkFn = pageLinks[pageName] as (...args: unknown[]) => string
  const path = linkFn(...args)
  return `${window.location.origin}${path}`
}
