import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeWorker } from './worker'
const root = mkdtempSync(join(tmpdir(), 'demotif-worker-'))
const script = join(root, 'fake.mjs')
writeFileSync(script, `import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);
if(r.action==='hang')return;
if(r.action==='malformed'){console.log('bad json');return;}
console.log(JSON.stringify({protocol:1,id:r.id,event:'progress',stage:'synthesis'}));
console.log(JSON.stringify({protocol:1,id:r.id,event:r.action==='fail'?'error':'complete',error:{message:'test failure'},result:{pid:process.pid}}));});`)
const workers: NativeWorker[] = []
afterEach(() => { for (const w of workers) w.stop(); workers.length = 0 })
process.on('exit', () => rmSync(root, { recursive: true, force: true }))
const worker = () => { const w = new NativeWorker({ executable: process.execPath, entry: script }); workers.push(w); return w }
it('reuses one process and reports actual stages without poisoning it after a job failure', async () => {
  const w = worker(); const stages: string[] = []
  const a = await w.run<{ pid: number }>({ action: 'render' }, undefined, (s) => stages.push(s))
  await expect(w.run({ action: 'fail' })).rejects.toThrow('test failure')
  const b = await w.run<{ pid: number }>({ action: 'render' })
  expect(a.pid).toBe(b.pid); expect(stages).toEqual(['synthesis'])
})
it('cancels active work, rejects the pending call and starts a fresh process', async () => {
  const w = worker(); const a = await w.run<{ pid: number }>({ action: 'render' })
  const controller = new AbortController()
  const pending = w.run({ action: 'hang' }, controller.signal)
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await rejection
  const b = await w.run<{ pid: number }>({ action: 'render' })
  expect(b.pid).not.toBe(a.pid)
})

it('rejects malformed protocol output and restarts instead of hanging', async () => {
  const w = worker()
  await expect(w.run({ action: 'malformed' })).rejects.toThrow('invalid JSON')
  expect(await w.run({ action: 'render' })).toHaveProperty('pid')
})
