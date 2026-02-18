import { describe, it, expect } from 'vitest'
import { Bash, InMemoryFs } from '@backend/lib/just-bash/src/browser'

function createBash() {
  return new Bash({ fs: new InMemoryFs(), cwd: '/home/user' })
}

describe('Backend Bash Execution', () => {
  it('executes basic echo and variable assignment', async () => {
    const bash = createBash()

    const r1 = await bash.exec('echo "hello world"')
    expect(r1.stdout.trim()).toBe('hello world')
    expect(r1.exitCode).toBe(0)

    const r2 = await bash.exec('NAME="Paraflow" && echo "Hello $NAME"')
    expect(r2.stdout.trim()).toBe('Hello Paraflow')
  })

  it('supports file creation, reading, and piping', async () => {
    const bash = createBash()

    await bash.exec('mkdir -p /home/user/project')
    await bash.exec('echo "line1\nline2\nline3" > /home/user/project/data.txt')

    const cat = await bash.exec('cat /home/user/project/data.txt')
    expect(cat.stdout).toContain('line1')

    const wc = await bash.exec('cat /home/user/project/data.txt | wc -l')
    expect(parseInt(wc.stdout.trim())).toBeGreaterThanOrEqual(3)
  })

  it('supports grep and text processing pipeline', async () => {
    const bash = createBash()

    await bash.exec('printf "apple\\nbanana\\napricot\\ncherry\\n" > /home/user/fruits.txt')

    const grep = await bash.exec('grep "^a" /home/user/fruits.txt')
    expect(grep.stdout).toContain('apple')
    expect(grep.stdout).toContain('apricot')
    expect(grep.stdout).not.toContain('banana')

    const sort = await bash.exec('cat /home/user/fruits.txt | sort -r | head -2')
    expect(sort.exitCode).toBe(0)
    expect(sort.stdout.trim().split('\n')).toHaveLength(2)
  })

  it('supports jq for JSON processing', async () => {
    const bash = createBash()

    await bash.exec('echo \'{"name":"test","value":42}\' > /home/user/data.json')

    const jq = await bash.exec('cat /home/user/data.json | jq ".name"')
    expect(jq.stdout.trim()).toBe('"test"')

    const jqVal = await bash.exec('cat /home/user/data.json | jq ".value"')
    expect(jqVal.stdout.trim()).toBe('42')
  })

  it('handles exit codes correctly for failing commands', async () => {
    const bash = createBash()

    const r = await bash.exec('cat /nonexistent/file')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toBeTruthy()
  })

  it('supports sed for text transformation', async () => {
    const bash = createBash()

    const result = await bash.exec('echo "hello world" | sed "s/world/bash/"')
    expect(result.stdout.trim()).toBe('hello bash')
  })

  it('supports find and ls for directory listing', async () => {
    const bash = createBash()

    await bash.exec('mkdir -p /home/user/src')
    await bash.exec('touch /home/user/src/a.ts /home/user/src/b.ts /home/user/src/c.js')

    const find = await bash.exec('find /home/user/src -name "*.ts"')
    expect(find.stdout).toContain('a.ts')
    expect(find.stdout).toContain('b.ts')
    expect(find.stdout).not.toContain('c.js')

    const ls = await bash.exec('ls /home/user/src')
    expect(ls.stdout).toContain('a.ts')
    expect(ls.stdout).toContain('c.js')
  })

  it('supports base64 encoding and decoding', async () => {
    const bash = createBash()

    const enc = await bash.exec('echo -n "secret" | base64')
    expect(enc.exitCode).toBe(0)
    const encoded = enc.stdout.trim()

    const dec = await bash.exec(`echo -n "${encoded}" | base64 -d`)
    expect(dec.stdout).toBe('secret')
  })
})
