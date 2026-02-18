/**
 * ESLint rule: require-page-links
 *
 * Enforces that Link's `to` prop and navigate() calls should use pageLinks.xxx()
 * Only reports errors for string literals and template literals that can be auto-fixed.
 *
 * ✅ Good:
 *   <Link to={pageLinks.home()}>
 *   navigate(pageLinks.pollDetail(id))
 *
 * ❌ Bad (auto-fixable):
 *   <Link to="/polls">           -> <Link to={pageLinks.PollList()}>
 *   <Link to={`/polls/${id}`}>   -> <Link to={pageLinks.PollVotingForm(id)}>
 *   navigate('/polls')           -> navigate(pageLinks.PollList())
 *
 * ✅ Ignored (not easily fixable):
 *   <Link to={someVariable}>
 *   <Link to={getPath()}>
 *   navigate(dynamicPath)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cache for parsed pageLinks
let cachedMappings = null

/**
 * Parse pageLinks.ts and extract path mappings
 */
function parsePageLinksFile() {
  if (cachedMappings) return cachedMappings

  const pageLinksPath = path.resolve(__dirname, '../src/pageLinks.ts')
  const content = fs.readFileSync(pageLinksPath, 'utf-8')

  const staticMap = {}
  const dynamicPatterns = []

  // Match patterns like: Login: () => '/login',
  // or: PollVotingForm: (id: string) => `/polls/${id}`,
  // Note: separate handling for static strings (single/double quotes) vs template literals (backticks)
  const functionRegex = /(\w+):\s*\([^)]*\)\s*=>\s*(?:pageLinks\.(\w+)\(\)|(['"])([^'"]+)\3|`([^`]+)`)/g

  let match
  while ((match = functionRegex.exec(content)) !== null) {
    const [, name, delegateTo, , staticPath, templatePath] = match

    // Skip shortcuts that delegate to other pageLinks
    if (delegateTo) continue

    if (staticPath) {
      // Static path: Login: () => '/login'
      staticMap[staticPath] = name
    } else if (templatePath) {
      // Template path: PollVotingForm: (id: string) => `/polls/${id}`
      // Check if it contains template expressions
      if (templatePath.includes('${')) {
        // Parse the template to extract quasis
        const parts = templatePath.split(/\$\{[^}]+\}/)
        dynamicPatterns.push({
          quasis: parts,
          name: name,
        })
      } else {
        // Static template string without expressions
        staticMap[templatePath] = name
      }
    }
  }

  // Sort dynamic patterns by specificity (longer patterns first)
  // e.g., /polls/:id/edit should match before /polls/:id
  dynamicPatterns.sort((a, b) => {
    const aLen = a.quasis.join('').length
    const bLen = b.quasis.join('').length
    return bLen - aLen
  })

  cachedMappings = { staticMap, dynamicPatterns }
  return cachedMappings
}

/**
 * Try to find a matching pageLink for a static path
 */
function getStaticPageLink(pathValue) {
  const { staticMap } = parsePageLinksFile()
  return staticMap[pathValue] || null
}

/**
 * Try to match a template literal to a dynamic pageLink pattern
 * Returns { name, expressions } if matched, null otherwise
 */
function matchTemplateLiteral(node) {
  if (node.type !== 'TemplateLiteral') return null

  const { dynamicPatterns } = parsePageLinksFile()

  // Get quasis from template literal
  // e.g., `/polls/${id}` -> quasis: ['/polls/', ''], expressions: [id]
  const quasis = node.quasis.map(q => q.value.raw)

  // Try each dynamic pattern
  for (const pattern of dynamicPatterns) {
    // Check if quasis match
    if (quasis.length !== pattern.quasis.length) continue

    let matches = true
    for (let i = 0; i < quasis.length; i++) {
      if (quasis[i] !== pattern.quasis[i]) {
        matches = false
        break
      }
    }

    if (matches) {
      return { name: pattern.name, expressions: node.expressions }
    }
  }

  return null
}

/**
 * Check if a node is a string literal or template literal (fixable cases)
 */
function isStringOrTemplateLiteral(node) {
  if (!node) return false

  // JSX string: to="/path"
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return true
  }

  // JSX expression with string: to={"/path"}
  if (node.type === 'JSXExpressionContainer') {
    return isStringOrTemplateLiteral(node.expression)
  }

  // Template literal: to={`/polls/${id}`}
  if (node.type === 'TemplateLiteral') {
    return true
  }

  return false
}

/**
 * Check if a node is or contains a pageLinks.xxx() call expression
 */
function isPageLinksCall(node) {
  if (!node) return false

  // Direct call: pageLinks.xxx()
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'pageLinks'
  ) {
    return true
  }

  // Wrapped in JSX expression: {pageLinks.xxx()}
  if (node.type === 'JSXExpressionContainer') {
    return isPageLinksCall(node.expression)
  }

  // Template literal: `${pageLinks.xxx()}?query=value`
  if (node.type === 'TemplateLiteral') {
    // Check if any expression in the template is a pageLinks call
    return node.expressions.some((expr) => isPageLinksCall(expr))
  }

  return false
}

/**
 * Generate the fix for a string literal path
 */
function generateStaticFix(path, isJsxAttribute) {
  const pageLinkName = getStaticPageLink(path)
  if (!pageLinkName) return null

  const replacement = `pageLinks.${pageLinkName}()`
  return isJsxAttribute ? `{${replacement}}` : replacement
}

/**
 * Generate the fix for a template literal path
 */
function generateTemplateFix(node, sourceCode) {
  const match = matchTemplateLiteral(node)
  if (!match) return null

  const args = match.expressions.map(expr => sourceCode.getText(expr)).join(', ')
  return `pageLinks.${match.name}(${args})`
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require pageLinks.xxx() for Link to prop and navigate() calls',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      linkRequirePageLinks: 'Link "to" prop should use pageLinks.xxx(). Use pageLinks from "@/pageLinks".',
      navigateRequirePageLinks: 'navigate() should use pageLinks.xxx(). Use pageLinks from "@/pageLinks".',
    },
    schema: [],
  },

  create(context) {
    // Track if navigate comes from react-router-dom
    const navigateIdentifiers = new Set()
    const sourceCode = context.sourceCode || context.getSourceCode()

    return {
      // Track: const navigate = useNavigate()
      VariableDeclarator(node) {
        if (
          node.init &&
          node.init.type === 'CallExpression' &&
          node.init.callee.type === 'Identifier' &&
          node.init.callee.name === 'useNavigate' &&
          node.id.type === 'Identifier'
        ) {
          navigateIdentifiers.add(node.id.name)
        }
      },

      // Check Link component's to prop
      JSXOpeningElement(node) {
        // Only check Link components
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'Link') {
          return
        }

        // Find the "to" attribute
        const toAttr = node.attributes.find(
          (attr) =>
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier' &&
            attr.name.name === 'to'
        )

        if (!toAttr || !toAttr.value) return

        // Skip if already using pageLinks
        if (isPageLinksCall(toAttr.value)) return

        // Only check string literals and template literals (fixable cases)
        if (!isStringOrTemplateLiteral(toAttr.value)) return

        // Try to generate a fix
        let fix = null
        const valueNode = toAttr.value

        // Case 1: to="/path"
        if (valueNode.type === 'Literal' && typeof valueNode.value === 'string') {
          const replacement = generateStaticFix(valueNode.value, true)
          if (replacement) {
            fix = (fixer) => fixer.replaceText(valueNode, replacement)
          }
        }
        // Case 2: to={"/path"} or to={`/polls/${id}`}
        else if (valueNode.type === 'JSXExpressionContainer') {
          const expr = valueNode.expression

          if (expr.type === 'Literal' && typeof expr.value === 'string') {
            const replacement = generateStaticFix(expr.value, false)
            if (replacement) {
              fix = (fixer) => fixer.replaceText(expr, replacement)
            }
          } else if (expr.type === 'TemplateLiteral') {
            const replacement = generateTemplateFix(expr, sourceCode)
            if (replacement) {
              fix = (fixer) => fixer.replaceText(expr, replacement)
            }
          }
        }

        // Only report if we can fix it, or it's a simple string that should have a mapping
        if (fix) {
          context.report({
            node: toAttr,
            messageId: 'linkRequirePageLinks',
            fix,
          })
        } else {
          // Report without fix for unmapped paths
          context.report({
            node: toAttr,
            messageId: 'linkRequirePageLinks',
          })
        }
      },

      // Check navigate() calls
      CallExpression(node) {
        // Check if it's a navigate call
        if (
          node.callee.type !== 'Identifier' ||
          !navigateIdentifiers.has(node.callee.name)
        ) {
          return
        }

        // navigate() with no args or navigate(-1) is ok
        if (node.arguments.length === 0) return

        const firstArg = node.arguments[0]

        // navigate(-1), navigate(1) etc. for history navigation is ok
        if (firstArg.type === 'UnaryExpression' || (firstArg.type === 'Literal' && typeof firstArg.value === 'number')) {
          return
        }

        // Skip if already using pageLinks
        if (isPageLinksCall(firstArg)) return

        // Only check string literals and template literals (fixable cases)
        if (!isStringOrTemplateLiteral(firstArg)) return

        // Try to generate a fix
        let fix = null

        if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
          const replacement = generateStaticFix(firstArg.value, false)
          if (replacement) {
            fix = (fixer) => fixer.replaceText(firstArg, replacement)
          }
        } else if (firstArg.type === 'TemplateLiteral') {
          const replacement = generateTemplateFix(firstArg, sourceCode)
          if (replacement) {
            fix = (fixer) => fixer.replaceText(firstArg, replacement)
          }
        }

        // Only report if we can fix it, or it's a simple string that should have a mapping
        if (fix) {
          context.report({
            node: node,
            messageId: 'navigateRequirePageLinks',
            fix,
          })
        } else {
          // Report without fix for unmapped paths
          context.report({
            node: node,
            messageId: 'navigateRequirePageLinks',
          })
        }
      },
    }
  },
}
