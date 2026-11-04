import { afterEach, expect, it, vi } from 'vitest'
import { navigate, registerNavigationGuard } from './navigation'

afterEach(() => vi.unstubAllGlobals())

it('keeps a cancelled departure on the draft and allows a confirmed departure', async () => {
  const assign = vi.fn()
  const replace = vi.fn()
  vi.stubGlobal('window', { location: { assign, replace } })
  const guard = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  const unregister = registerNavigationGuard(guard)
  try {
    await navigate('/')
    expect(assign).not.toHaveBeenCalled()
    await navigate('/')
    expect(assign).toHaveBeenCalledExactlyOnceWith('/')
  } finally {
    unregister()
  }
  await navigate('/studio/saved', { replace: true })
  expect(replace).toHaveBeenCalledExactlyOnceWith('/studio/saved')
  expect(guard).toHaveBeenCalledTimes(2)
})
