/**
 * R2 Storage Client Fake - Pure TypeScript implementation
 *
 * @example
 * expect(r2Fake.storage.get('resource-id')?.extension).toBe('png')
 */
import type { R2UploadResult } from '../production/r2'

export interface FakeStoredFile {
  path: string
  data: ArrayBuffer | Blob | ReadableStream<Uint8Array>
  extension: string
  resourceUrl: string
  resourceId: string
}

let counter = 0

export const r2Fake = {
  storage: new Map<string, FakeStoredFile>(),

  async upload(path: string, data: ArrayBuffer | Blob | ReadableStream<Uint8Array>, extension: string): Promise<R2UploadResult> {
    const resourceId = `fake-r2-${++counter}`
    const resourceUrl = `https://fake-r2.test/${path}/${resourceId}.${extension}`
    r2Fake.storage.set(resourceId, { path, data, extension, resourceUrl, resourceId })
    return { resourceUrl, resourceId }
  },

  async download(resourceUrl: string): Promise<ArrayBuffer> {
    for (const file of r2Fake.storage.values()) {
      if (file.resourceUrl === resourceUrl && file.data instanceof ArrayBuffer) {
        return file.data
      }
    }
    return new ArrayBuffer(8)
  },

  async delete(resourceId: string): Promise<void> {
    r2Fake.storage.delete(resourceId)
  },

  reset() {
    counter = 0
    r2Fake.storage.clear()
  },
}
