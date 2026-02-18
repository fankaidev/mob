import { describe, it, expect } from 'vitest'
import { createGitFs } from '@backend/lib/agent/fs/git-fs'

/**
 * Feature: Git Clone into Virtual Filesystem
 *
 * Tests createGitFs — a single Map-based filesystem that provides both
 * IFileSystem (for MountableFs) and isomorphic-git's fs.promises API.
 * No adapter layer needed.
 */

describe('createGitFs', () => {
  it('provides fs.promises API compatible with isomorphic-git', async () => {
    const { isogitFs } = createGitFs()

    // Verify the isogit interface
    expect(isogitFs.promises).toBeDefined()
    expect(typeof isogitFs.promises.readFile).toBe('function')
    expect(typeof isogitFs.promises.writeFile).toBe('function')
    expect(typeof isogitFs.promises.mkdir).toBe('function')
    expect(typeof isogitFs.promises.stat).toBe('function')
    expect(typeof isogitFs.promises.lstat).toBe('function')
    expect(typeof isogitFs.promises.readdir).toBe('function')
    expect(typeof isogitFs.promises.unlink).toBe('function')
    expect(typeof isogitFs.promises.rmdir).toBe('function')

    // Test write + read roundtrip (string via utf8 encoding)
    await isogitFs.promises.writeFile('/test.txt', 'hello world')
    const content = await isogitFs.promises.readFile('/test.txt', { encoding: 'utf8' })
    expect(content).toBe('hello world')

    // Test write + read roundtrip (binary)
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0xff])
    await isogitFs.promises.writeFile('/binary.bin', binary)
    const readBinary = await isogitFs.promises.readFile('/binary.bin')
    expect(readBinary).toBeInstanceOf(Uint8Array)
    expect(readBinary).toEqual(binary)

    // Test stat — isomorphic-git needs both boolean props and we provide them
    const stat = await isogitFs.promises.stat('/test.txt')
    expect(stat.isFile).toBe(true)
    expect(stat.isDirectory).toBe(false)

    // Test mkdir with recursive
    await isogitFs.promises.mkdir('/a/b/c', { recursive: true })
    const dirStat = await isogitFs.promises.stat('/a/b/c')
    expect(dirStat.isDirectory).toBe(true)

    // Test readdir
    await isogitFs.promises.writeFile('/a/file1.txt', 'test')
    const entries = await isogitFs.promises.readdir('/a')
    expect(entries).toContain('b')
    expect(entries).toContain('file1.txt')

    // Test unlink
    await isogitFs.promises.unlink('/a/file1.txt')
    await expect(isogitFs.promises.stat('/a/file1.txt')).rejects.toThrow('ENOENT')

    // Test error codes (isomorphic-git checks err.code)
    try {
      await isogitFs.promises.stat('/nonexistent')
      expect.unreachable()
    } catch (e: any) {
      expect(e.code).toBe('ENOENT')
    }
  })

  it('shares data between isogitFs and ifs (same underlying Map)', async () => {
    const { ifs, isogitFs } = createGitFs()

    // Write via isomorphic-git interface
    await isogitFs.promises.writeFile('/from-git.txt', 'cloned content')

    // Read via IFileSystem interface (what bash tool uses through MountableFs)
    const content = await ifs.readFile('/from-git.txt')
    expect(content).toBe('cloned content')

    // Write via IFileSystem
    await ifs.writeFile('/from-bash.txt', 'user wrote this')

    // Read via isomorphic-git interface
    const gitRead = await isogitFs.promises.readFile('/from-bash.txt', { encoding: 'utf8' })
    expect(gitRead).toBe('user wrote this')

    // getAllPaths works (used by git-clone-tool summary)
    const paths = ifs.getAllPaths()
    expect(paths).toContain('/from-git.txt')
    expect(paths).toContain('/from-bash.txt')
  })

  it('simulates isomorphic-git writing git objects and reading them back', async () => {
    const { isogitFs } = createGitFs()

    // Simulate git init
    await isogitFs.promises.mkdir('/.git/objects/pack', { recursive: true })
    await isogitFs.promises.mkdir('/.git/refs/heads', { recursive: true })
    await isogitFs.promises.writeFile('/.git/HEAD', 'ref: refs/heads/main\n')
    await isogitFs.promises.writeFile('/.git/config', '[core]\n\trepositoryformatversion = 0\n')

    // Simulate checked-out files
    await isogitFs.promises.writeFile('/index.js', 'console.log("hello")')
    await isogitFs.promises.writeFile('/package.json', '{"name":"cloned-repo"}')

    // Write binary data (like git pack files)
    const binaryData = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02])
    await isogitFs.promises.writeFile('/.git/objects/pack/pack-abc.pack', binaryData)

    // Read text with encoding
    const head = await isogitFs.promises.readFile('/.git/HEAD', { encoding: 'utf8' })
    expect(head).toBe('ref: refs/heads/main\n')

    // Read text without encoding (returns Uint8Array)
    const headBuf = await isogitFs.promises.readFile('/.git/HEAD')
    expect(typeof headBuf).not.toBe('string')
    expect((headBuf as Uint8Array).length).toBeGreaterThan(0)

    // Read binary back
    const packBack = await isogitFs.promises.readFile('/.git/objects/pack/pack-abc.pack')
    expect(packBack).toEqual(binaryData)

    // Stat
    const headStat = await isogitFs.promises.stat('/.git/HEAD')
    expect(headStat.isFile).toBe(true)
    expect(headStat.isDirectory).toBe(false)

    const dirStat = await isogitFs.promises.stat('/.git/objects')
    expect(dirStat.isDirectory).toBe(true)
    expect(dirStat.isFile).toBe(false)

    // ReadDir
    const gitDirEntries = await isogitFs.promises.readdir('/.git')
    expect(gitDirEntries).toContain('HEAD')
    expect(gitDirEntries).toContain('config')
    expect(gitDirEntries).toContain('objects')
    expect(gitDirEntries).toContain('refs')
  })
})
