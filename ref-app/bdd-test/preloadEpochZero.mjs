/**
 * Preload module to simulate Cloudflare Workers module initialization behavior.
 *
 * In Cloudflare Workers, Date.now() returns 0 during module initialization phase
 * (top-level code execution). This preload module replicates that behavior in tests
 * to catch bugs where code incorrectly uses Date at module top-level.
 *
 * This file is loaded via Node.js --import flag BEFORE any other modules,
 * so it affects all module initialization code.
 *
 * The mock is explicitly disabled in setupTeardown.ts by calling restoreOriginalDate(),
 * which happens before test execution begins.
 */

const OriginalDate = globalThis.Date

// Track whether we're still in module initialization phase
let isModuleInitPhase = true

/**
 * Mock Date that returns epoch 0 during module initialization,
 * mimicking Cloudflare Workers behavior.
 */
class MockDate extends OriginalDate {
  constructor(...args) {
    if (args.length === 0 && isModuleInitPhase) {
      // No arguments = current time, return epoch 0 during module init
      super(0)
    } else {
      super(...args)
    }
  }

  static now() {
    if (isModuleInitPhase) {
      return 0
    }
    return OriginalDate.now()
  }
}

// Copy static methods and properties
Object.setPrototypeOf(MockDate, OriginalDate)

// Replace global Date
globalThis.Date = MockDate

/**
 * Call this to exit module initialization phase.
 * After this, Date behaves normally (or uses vitest fake timers).
 */
export function exitModuleInitPhase() {
  isModuleInitPhase = false
}

/**
 * Restore the original Date (for cleanup).
 */
export function restoreOriginalDate() {
  globalThis.Date = OriginalDate
}

// Export for use in setupTeardown.ts
globalThis.__epochZeroPreload = {
  exitModuleInitPhase,
  restoreOriginalDate,
  isModuleInitPhase: () => isModuleInitPhase,
}
