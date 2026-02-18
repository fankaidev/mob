/**
 * ESLint rule: no-toplevel-date
 *
 * Detects `new Date()` and `Date.now()` at module top-level.
 * In Cloudflare Workers, these return epoch 0 during module initialization.
 *
 * Example bug this rule catches:
 *   z.number().max(new Date().getFullYear())  // max = 1970 in Workers!
 *
 * Use `.refine()` instead for dynamic date validation:
 *   z.number().refine(y => y <= new Date().getFullYear())  // OK
 *
 * Implementation: Uses depth counters (O(1)) instead of parent chain traversal.
 *
 * Limitation: Only detects `new Date()` without arguments. `new Date(variable)`
 * is not checked because static analysis cannot determine if variable is undefined.
 * If `new Date(x)` is needed at top-level, ensure x is never undefined.
 *
 * Validated with 114 test cases (79 valid, 35 invalid). See PR #1410.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow new Date() and Date.now() at module top-level (returns epoch 0 in Cloudflare Workers)',
      category: 'Possible Errors',
    },
    messages: {
      noToplevelNewDate: 'Avoid `new Date()` at module top-level. In Cloudflare Workers, this returns epoch 0 (1970-01-01). Use `.refine()` for dynamic date validation.',
      noToplevelDateNow: 'Avoid `Date.now()` at module top-level. In Cloudflare Workers, this returns 0. Move to request handler or use `.refine()`.',
    },
    schema: [],
  },

  create(context) {
    // Depth counters for deferred execution contexts
    let functionDepth = 0         // Inside any function (body or params)
    let instancePropertyDepth = 0 // Inside non-static class property

    return {
      // ========== Track function scope ==========
      FunctionDeclaration() { functionDepth++ },
      'FunctionDeclaration:exit'() { functionDepth-- },
      FunctionExpression() { functionDepth++ },
      'FunctionExpression:exit'() { functionDepth-- },
      ArrowFunctionExpression() { functionDepth++ },
      'ArrowFunctionExpression:exit'() { functionDepth-- },

      // ========== Track class instance properties ==========
      PropertyDefinition(node) {
        if (!node.static) instancePropertyDepth++
      },
      'PropertyDefinition:exit'(node) {
        if (!node.static) instancePropertyDepth--
      },

      // ========== Detect new Date() ==========
      NewExpression(node) {
        // Fast path: check depth first (O(1) vs O(n) parent traversal)
        if (functionDepth > 0 || instancePropertyDepth > 0) return

        // Check if it's Date constructor with no arguments
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Date' &&
          node.arguments.length === 0
        ) {
          context.report({ node, messageId: 'noToplevelNewDate' })
        }
      },

      // ========== Detect Date.now() ==========
      CallExpression(node) {
        // Fast path: check depth first
        if (functionDepth > 0 || instancePropertyDepth > 0) return

        // Check if it's Date.now()
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Date' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'now'
        ) {
          context.report({ node, messageId: 'noToplevelDateNow' })
        }
      },
    }
  },
}
