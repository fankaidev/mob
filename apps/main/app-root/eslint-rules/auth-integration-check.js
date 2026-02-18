/**
 * ESLint rule: auth-integration-check
 *
 * Checks auth integration completeness.
 *
 * Backend (app.ts): when src/auth/ exists AND exports setupAuth
 *   - Must import setupAuth from './auth' and call setupAuth(app)
 *
 * Frontend (routes.ts): when src/auth/ exists AND exports createAuthRoutes
 *   - Must import and use createAuthRoutes from './auth'
 *
 * Frontend (pageLinks.ts): when src/auth/ exists AND exports authPageLinks
 *   - Must import and spread authPageLinks from './auth'
 *
 * If validation fails, the error message directs to load the "auth-integration" skill.
 */

import fs from 'fs'
import path from 'path'

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if auth directory exists relative to a project root
 */
function authDirectoryExists(projectRoot) {
  const authDir = path.join(projectRoot, 'src', 'auth')
  return fs.existsSync(authDir) && fs.statSync(authDir).isDirectory()
}

/**
 * Check if auth/index.ts exports setupAuth (backend auth implementation)
 */
function authExportsSetupAuth(projectRoot) {
  const authIndexPath = path.join(projectRoot, 'src', 'auth', 'index.ts')
  if (!fs.existsSync(authIndexPath)) return false
  try {
    const content = fs.readFileSync(authIndexPath, 'utf-8')
    return /export\s*\{[^}]*\bsetupAuth\b[^}]*\}/.test(content) ||
           /export\s+(?:async\s+)?function\s+setupAuth/.test(content) ||
           /export\s+const\s+setupAuth/.test(content)
  } catch {
    return false
  }
}

/**
 * Check if auth/index.ts exports createAuthRoutes (frontend routes integration)
 */
function authExportsCreateAuthRoutes(projectRoot) {
  const authIndexPath = path.join(projectRoot, 'src', 'auth', 'index.ts')
  if (!fs.existsSync(authIndexPath)) return false
  try {
    const content = fs.readFileSync(authIndexPath, 'utf-8')
    return /\bcreateAuthRoutes\b/.test(content)
  } catch {
    return false
  }
}

/**
 * Check if auth/index.ts exports authPageLinks (frontend pageLinks integration)
 */
function authExportsAuthPageLinks(projectRoot) {
  const authIndexPath = path.join(projectRoot, 'src', 'auth', 'index.ts')
  if (!fs.existsSync(authIndexPath)) return false
  try {
    const content = fs.readFileSync(authIndexPath, 'utf-8')
    return /\bauthPageLinks\b/.test(content)
  } catch {
    return false
  }
}

/**
 * Find project root by looking for package.json
 */
function findProjectRoot(filename) {
  let dir = path.dirname(filename)
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return null
}

/**
 * Check if filename matches a target file (cross-platform)
 */
function isTargetFile(filename, targetDir, targetFile) {
  const normalized = path.normalize(filename)
  const expected = path.join(targetDir, targetFile)
  return normalized.endsWith(expected)
}

/**
 * Check if an import is from './auth' module
 */
function isAuthImport(node) {
  return (
    node.source &&
    node.source.type === 'Literal' &&
    node.source.value === './auth'
  )
}

/**
 * Check if a specifier imports a specific name
 */
function hasImportedName(node, name) {
  if (!node.specifiers) return false
  return node.specifiers.some(
    (spec) =>
      (spec.type === 'ImportSpecifier' && spec.imported && spec.imported.name === name) ||
      (spec.type === 'ImportDefaultSpecifier' && name === 'default')
  )
}

// ============================================================================
// Rule definition
// ============================================================================

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Checks auth integration completeness',
      recommended: true,
    },
    messages: {
      incompleteAuthIntegration:
        'Auth directory exists but auth integration is incomplete. ' +
        'Load the "auth-integration" skill and follow the instructions to complete the integration.',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename || context.getFilename()

    // Determine file type using cross-platform path matching
    const isAppTs = isTargetFile(filename, 'src', 'app.ts')
    const isRoutesTs = isTargetFile(filename, 'src', 'routes.ts')
    const isPageLinksTs = isTargetFile(filename, 'src', 'pageLinks.ts')

    // Skip if not a target file
    if (!isAppTs && !isRoutesTs && !isPageLinksTs) {
      return {}
    }

    // Find project root and check if auth directory exists
    const projectRoot = findProjectRoot(filename)
    if (!projectRoot || !authDirectoryExists(projectRoot)) {
      return {}
    }

    // Require auth integration per file type (backend uses setupAuth; frontend uses createAuthRoutes/authPageLinks)
    if (isAppTs && !authExportsSetupAuth(projectRoot)) {
      return {}
    }
    if (isRoutesTs && !authExportsCreateAuthRoutes(projectRoot)) {
      return {}
    }
    if (isPageLinksTs && !authExportsAuthPageLinks(projectRoot)) {
      return {}
    }

    // Track what we find during AST traversal
    const state = {
      // Backend (app.ts)
      hasSetupAuthImport: false,
      hasSetupAuthCall: false,
      // Frontend (routes.ts)
      hasCreateAuthRoutesImport: false,
      hasCreateAuthRoutesCall: false,
      // Frontend (pageLinks.ts)
      hasAuthPageLinksImport: false,
      hasAuthPageLinksSpread: false,
    }

    return {
      // Check imports from './auth'
      ImportDeclaration(node) {
        if (!isAuthImport(node)) return

        if (isAppTs) {
          if (hasImportedName(node, 'setupAuth')) {
            state.hasSetupAuthImport = true
          }
        }

        if (isRoutesTs) {
          if (hasImportedName(node, 'createAuthRoutes')) {
            state.hasCreateAuthRoutesImport = true
          }
        }

        if (isPageLinksTs) {
          if (hasImportedName(node, 'authPageLinks')) {
            state.hasAuthPageLinksImport = true
          }
        }
      },

      // Check function calls
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') return

        const calleeName = node.callee.name

        // Backend: setupAuth(app)
        if (isAppTs && calleeName === 'setupAuth') {
          state.hasSetupAuthCall = true
        }

        // Frontend: createAuthRoutes(store)
        if (isRoutesTs && calleeName === 'createAuthRoutes') {
          state.hasCreateAuthRoutesCall = true
        }
      },

      // Check spread elements for ...authPageLinks
      SpreadElement(node) {
        if (isPageLinksTs && node.argument.type === 'Identifier' && node.argument.name === 'authPageLinks') {
          state.hasAuthPageLinksSpread = true
        }
      },

      // Validate at the end of the file
      'Program:exit'(node) {
        let isComplete = true

        // Backend: app.ts checks
        if (isAppTs) {
          if (!state.hasSetupAuthImport || !state.hasSetupAuthCall) {
            isComplete = false
          }
        }

        // Frontend: routes.ts checks
        if (isRoutesTs) {
          if (!state.hasCreateAuthRoutesImport || !state.hasCreateAuthRoutesCall) {
            isComplete = false
          }
        }

        // Frontend: pageLinks.ts checks
        if (isPageLinksTs) {
          if (!state.hasAuthPageLinksImport || !state.hasAuthPageLinksSpread) {
            isComplete = false
          }
        }

        if (!isComplete) {
          context.report({
            node,
            messageId: 'incompleteAuthIntegration',
          })
        }
      },
    }
  },
}
