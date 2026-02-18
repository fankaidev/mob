/**
 * ESLint rule: require-home-page-link
 *
 * Enforces that pageLinks.ts contains at least two entries that return '/':
 * 1. One pageLink that serves as the home page (NOT global_shortcut_*)
 * 2. global_shortcut_home which must return '/'
 *
 * This ensures global_shortcut_home always has a valid target.
 *
 * Example:
 *   export const pageLinks = {
 *     Home: () => '/',              // <- Regular page returning '/'
 *     global_shortcut_home: () => '/', // <- Required shortcut
 *   }
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require at least one non-shortcut pageLink to return "/" so global_shortcut_home is not broken',
      recommended: true,
    },
    messages: {
      missingHomePageLink:
        'pageLinks must have at least one non-shortcut entry returning "/". ' +
        'global_shortcut_home points to "/" but no page serves that route. ' +
        'Add a pageLink like: Home: () => \'/\',',
    },
    schema: [],
  },

  create(context) {
    // Only run this rule on pageLinks.ts
    const filename = context.filename || context.getFilename()
    if (!filename.endsWith('pageLinks.ts')) {
      return {}
    }

    return {
      'Program:exit'(node) {
        // Read the actual file content to count home route entries
        const pageLinksPath = path.resolve(__dirname, '../src/pageLinks.ts')

        let content
        try {
          content = fs.readFileSync(pageLinksPath, 'utf-8')
        } catch {
          // File doesn't exist or can't be read, skip
          return
        }

        // Find all entries that return '/'
        // Match patterns like: SomeName: () => '/',  or  SomeName: () => "/",
        const homeRouteRegex = /(\w+):\s*\([^)]*\)\s*=>\s*['"]\/['"]/g

        let homePageCount = 0
        let hasGlobalShortcutHome = false
        let match

        while ((match = homeRouteRegex.exec(content)) !== null) {
          const name = match[1]
          if (name === 'global_shortcut_home') {
            hasGlobalShortcutHome = true
          } else if (!name.startsWith('global_shortcut_')) {
            homePageCount++
          }
        }

        // We need at least one non-shortcut home page if global_shortcut_home exists
        if (hasGlobalShortcutHome && homePageCount === 0) {
          context.report({
            node,
            messageId: 'missingHomePageLink',
          })
        }
      },
    }
  },
}
