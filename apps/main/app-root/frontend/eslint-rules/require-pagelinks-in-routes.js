/**
 * ESLint rule: require-pagelinks-in-routes
 *
 * Enforces that every pageLink defined in pageLinks.ts (except global_shortcut_*)
 * must be used in routes.ts or related route files.
 *
 * This prevents defining a pageLink without registering its route.
 *
 * ✅ Good:
 *   // pageLinks.ts
 *   PollList: () => '/polls',
 *
 *   // routes.ts or demoRoutes.ts
 *   { path: pageLinks.PollList(), ... }
 *
 * ❌ Bad:
 *   // pageLinks.ts
 *   PollList: () => '/polls',  // <- Error: not used in any routes file
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Get all route file paths to check
 */
function getRouteFiles() {
  const srcDir = path.resolve(__dirname, '../src')
  return [
    path.join(srcDir, 'routes.ts'),
    path.join(srcDir, 'demoRoutes.ts'),
    path.join(srcDir, 'auth/routes.ts'),
  ]
}

/**
 * Parse pageLinks.ts and extract all non-shortcut pageLink names
 */
function parsePageLinkNames(content) {
  const names = []

  // Match patterns like: PollList: () => '/polls',
  // Captures the key name before the colon
  const keyRegex = /^\s*(\w+):\s*\(/gm

  let match
  while ((match = keyRegex.exec(content)) !== null) {
    const name = match[1]
    // Skip global_shortcut_* and spread operators
    if (!name.startsWith('global_shortcut_')) {
      names.push(name)
    }
  }

  return names
}

/**
 * Check if a pageLink name is used in any route file
 */
function isPageLinkUsedInRoutes(name, routeFiles) {
  // Patterns to match:
  // - pageLinks.PollList()
  // - pageLinks.PollList(':id')
  // - authPageLinks.Login()
  const patterns = [
    new RegExp(`pageLinks\\.${name}\\s*\\(`),
    new RegExp(`authPageLinks\\.${name}\\s*\\(`),
  ]

  for (const filePath of routeFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return true
        }
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return false
}

/**
 * Check if a name is from spread import (like ...authPageLinks)
 * These are managed in their own module and checked separately
 */
function isSpreadImport(name, content) {
  // Check if this name appears after a spread operator in the same object
  // e.g., ...authPageLinks would import Login, Register, etc.
  // We skip these because they're defined in auth/pageLinks.ts

  // Simple heuristic: if the name doesn't have its own arrow function definition
  // in this file, it's from a spread
  const directDefRegex = new RegExp(`^\\s*${name}:\\s*\\([^)]*\\)\\s*=>`, 'm')
  return !directDefRegex.test(content)
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require all pageLinks to be registered in routes',
      recommended: true,
    },
    messages: {
      missingRoute:
        'pageLink "{{name}}" is defined but not used in any routes file. ' +
        'Add a route in routes.ts or demoRoutes.ts with path: pageLinks.{{name}}()',
    },
    schema: [],
  },

  create(context) {
    // Only run this rule on pageLinks.ts
    const filename = context.filename || context.getFilename()
    if (!filename.endsWith('pageLinks.ts')) {
      return {}
    }

    // Skip auth/pageLinks.ts - it has its own routes file
    if (filename.includes('auth/pageLinks.ts') || filename.includes('auth\\pageLinks.ts')) {
      return {}
    }

    return {
      'Program:exit'(node) {
        const pageLinksPath = path.resolve(__dirname, '../src/pageLinks.ts')

        let content
        try {
          content = fs.readFileSync(pageLinksPath, 'utf-8')
        } catch {
          return
        }

        const routeFiles = getRouteFiles()
        const pageLinkNames = parsePageLinkNames(content)

        for (const name of pageLinkNames) {
          // Skip if it's from a spread import (like authPageLinks)
          if (isSpreadImport(name, content)) {
            continue
          }

          if (!isPageLinkUsedInRoutes(name, routeFiles)) {
            context.report({
              node,
              messageId: 'missingRoute',
              data: { name },
            })
          }
        }
      },
    }
  },
}
