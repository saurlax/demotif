import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { voiceCatalog } from './profiles'
it('shows invalid installations as unavailable while empty installations remain usable', () => {
  const root = mkdtempSync(join(tmpdir(), 'vocal-profiles-'))
  try {
    expect(voiceCatalog(root)).toEqual([])
    mkdirSync(join(root, 'broken')); writeFileSync(join(root, 'broken/profile.json'), '{invalid')
    expect(voiceCatalog(root)).toMatchObject([{ id: 'broken', ready: false, reason: expect.stringContaining('invalid') }])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
