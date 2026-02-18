

const PREFIX =
  'Failed verify state snapshot, you mostly should modify the implemetation of state, api response type or other part'


const isPlainObj = (value: unknown) =>
  value?.constructor === Object || !value?.constructor


export function checkCanBeJsonStringify(value: unknown, path: string[] = []): void {
  const fieldPath = path.length > 0 ? path.join('.') : '<root>'

  // null and undefined is allowed
  if (value === null || value === undefined) {
    return
  }

  // primitives (string, number, boolean) are allowed
  if (typeof value !== 'object' && typeof value !== 'function') {
    return
  }
  // Symbol is not allowed
  if (typeof value === 'symbol') {
    throw new Error(
      `${PREFIX}: Cannot JSON stringify Symbol at ${fieldPath}`,
    )
  }

  // Arrays are allowed, recursively check elements
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      checkCanBeJsonStringify(value[i], [...path, `[${i}]`])
    }
    return
  }

  if (value !== null && typeof value === 'object' && !isPlainObj(value)) {
    throw new Error(
      `${PREFIX}: Cannot JSON stringify non-plain object at ${fieldPath}, it is ${value?.constructor?.toString()}`,
    )
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      checkCanBeJsonStringify((value as Record<string, unknown>)[key], [
        ...path,
        key,
      ])
    }
  }
}
