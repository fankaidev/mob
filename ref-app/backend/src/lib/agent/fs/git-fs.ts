/**
 * Lightweight Map-based filesystem for isomorphic-git clone storage.
 *
 * Returns two views of the same underlying Map:
 * - ifs: IFileSystem (for MountableFs mounting + bash tool browsing)
 * - isogitFs: { promises: {...} } (for isomorphic-git's git.clone)
 *
 * One Map, two interfaces, no adapter layer.
 */

import type { IFileSystem, MkdirOptions, RmOptions, ReadFileOptions, WriteFileOptions, BufferEncoding } from "../../just-bash/src/fs/interface"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function createGitFs() {
  const files = new Map<string, { content: Uint8Array; isDir: boolean; mode: number; mtime: Date }>()
  files.set("/", { content: new Uint8Array(0), isDir: true, mode: 0o755, mtime: new Date() })

  function normalizePath(p: string): string {
    if (!p || p === "/") return "/"
    let n = p.endsWith("/") && p !== "/" ? p.slice(0, -1) : p
    if (!n.startsWith("/")) n = `/${n}`
    const parts = n.split("/").filter((s) => s && s !== ".")
    const resolved: string[] = []
    for (const part of parts) {
      if (part === "..") resolved.pop()
      else resolved.push(part)
    }
    return `/${resolved.join("/")}`
  }

  function ensureParentDirs(path: string) {
    const parts = path.split("/").filter(Boolean)
    let current = ""
    for (let i = 0; i < parts.length - 1; i++) {
      current += "/" + parts[i]
      if (!files.has(current)) {
        files.set(current, { content: new Uint8Array(0), isDir: true, mode: 0o755, mtime: new Date() })
      }
    }
  }

  function enoent(op: string, path: string): never {
    throw Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${path}'`), { code: "ENOENT" })
  }

  // -- Shared core operations (used by both interfaces) --

  async function readFileImpl(path: string, opts?: { encoding?: string } | string): Promise<Uint8Array | string> {
    const n = normalizePath(path)
    const entry = files.get(n)
    if (!entry || entry.isDir) enoent("open", path)
    const encoding = typeof opts === "string" ? opts : opts?.encoding
    if (encoding === "utf8" || encoding === "utf-8") {
      return decoder.decode(entry!.content)
    }
    return entry!.content
  }

  async function writeFileImpl(path: string, content: string | Uint8Array): Promise<void> {
    const n = normalizePath(path)
    ensureParentDirs(n)
    const buf = typeof content === "string" ? encoder.encode(content) : content
    files.set(n, { content: buf, isDir: false, mode: 0o644, mtime: new Date() })
  }

  async function mkdirImpl(path: string, opts?: MkdirOptions | number): Promise<void> {
    const n = normalizePath(path)
    const recursive = typeof opts === "object" ? opts?.recursive : false
    if (recursive) {
      const parts = n.split("/").filter(Boolean)
      let current = ""
      for (const part of parts) {
        current += "/" + part
        if (!files.has(current)) {
          files.set(current, { content: new Uint8Array(0), isDir: true, mode: 0o755, mtime: new Date() })
        }
      }
    } else {
      if (files.has(n)) {
        throw Object.assign(new Error(`EEXIST: directory already exists, mkdir '${path}'`), { code: "EEXIST" })
      }
      files.set(n, { content: new Uint8Array(0), isDir: true, mode: 0o755, mtime: new Date() })
    }
  }

  async function readdirImpl(path: string): Promise<string[]> {
    const n = normalizePath(path)
    const prefix = n === "/" ? "/" : n + "/"
    const result = new Set<string>()
    for (const key of files.keys()) {
      if (key.startsWith(prefix) && key !== n) {
        const rest = key.slice(prefix.length)
        const name = rest.split("/")[0]
        if (name) result.add(name)
      }
    }
    return Array.from(result).sort()
  }

  async function statImpl(path: string) {
    const n = normalizePath(path)
    const entry = files.get(n)
    if (!entry) enoent("stat", path)
    const isFile = !entry!.isDir
    const isDirectory = entry!.isDir
    return {
      // boolean props (IFileSystem / FsStat)
      isFile,
      isDirectory,
      isSymbolicLink: false,
      size: entry!.content.length,
      mode: entry!.mode,
      mtime: entry!.mtime,
      // method accessors (isomorphic-git wants these)
      mtimeMs: entry!.mtime.getTime(),
      uid: 1000,
      gid: 1000,
    }
  }

  async function rmImpl(path: string, opts?: { force?: boolean; recursive?: boolean }): Promise<void> {
    const n = normalizePath(path)
    const entry = files.get(n)
    if (!entry) {
      if (opts?.force) return
      enoent("rm", path)
    }
    if (entry!.isDir && opts?.recursive) {
      const prefix = n === "/" ? "/" : n + "/"
      for (const key of [...files.keys()]) {
        if (key.startsWith(prefix)) files.delete(key)
      }
    }
    files.delete(n)
  }

  async function symlinkImpl(_target: string, _linkPath: string): Promise<void> {}
  async function readlinkImpl(_path: string): Promise<string> { return "" }

  async function chmodImpl(path: string, mode: number): Promise<void> {
    const n = normalizePath(path)
    const entry = files.get(n)
    if (entry) entry.mode = mode
  }

  // -- IFileSystem interface (for MountableFs + bash tool) --

  const ifs: IFileSystem = {
    async readFile(path: string, _opts?: ReadFileOptions | BufferEncoding): Promise<string> {
      // IFileSystem.readFile always returns string
      return readFileImpl(path, { encoding: "utf8" }) as Promise<string>
    },
    async readFileBuffer(path: string): Promise<Uint8Array> {
      return readFileImpl(path) as Promise<Uint8Array>
    },
    writeFile: writeFileImpl as IFileSystem["writeFile"],
    async appendFile(path: string, content: string | Uint8Array): Promise<void> {
      const n = normalizePath(path)
      const existing = files.get(n)?.content ?? new Uint8Array(0)
      const newContent = typeof content === "string" ? encoder.encode(content) : content
      const merged = new Uint8Array(existing.length + newContent.length)
      merged.set(existing, 0)
      merged.set(newContent, existing.length)
      files.set(n, { content: merged, isDir: false, mode: 0o644, mtime: new Date() })
    },
    async exists(path: string): Promise<boolean> {
      return files.has(normalizePath(path))
    },
    stat: statImpl as unknown as IFileSystem["stat"],
    lstat: statImpl as unknown as IFileSystem["lstat"],
    mkdir: mkdirImpl as IFileSystem["mkdir"],
    readdir: readdirImpl,
    rm: rmImpl,
    async cp(src: string, dest: string): Promise<void> {
      const sn = normalizePath(src)
      const entry = files.get(sn)
      if (!entry) enoent("cp", src)
      const dn = normalizePath(dest)
      ensureParentDirs(dn)
      files.set(dn, { ...entry! })
    },
    async mv(src: string, dest: string): Promise<void> {
      await ifs.cp(src, dest)
      await ifs.rm(src)
    },
    symlink: symlinkImpl,
    async link(_existing: string, _newPath: string): Promise<void> {},
    readlink: readlinkImpl,
    async realpath(path: string): Promise<string> { return normalizePath(path) },
    chmod: chmodImpl,
    async utimes(path: string, _atime: Date, mtime: Date): Promise<void> {
      const n = normalizePath(path)
      const entry = files.get(n)
      if (entry) entry.mtime = mtime
    },
    resolvePath(base: string, rel: string): string {
      if (rel.startsWith("/")) return normalizePath(rel)
      return normalizePath(base.replace(/\/$/, "") + "/" + rel)
    },
    getAllPaths(): string[] {
      return Array.from(files.keys())
    },
  }

  // -- isomorphic-git fs.promises interface --
  // Reuses the same core functions, just different method names / signatures

  const isogitFs = {
    promises: {
      readFile: readFileImpl,
      writeFile: writeFileImpl,
      unlink: (path: string) => rmImpl(path),
      rmdir: (path: string) => rmImpl(path),
      mkdir: mkdirImpl,
      readdir: readdirImpl,
      stat: statImpl,
      lstat: statImpl,
      symlink: symlinkImpl,
      readlink: readlinkImpl,
      chmod: chmodImpl,
    },
  }

  return { ifs, isogitFs }
}
