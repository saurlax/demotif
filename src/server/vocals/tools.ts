import { tool } from 'ai'
import { z } from 'zod'
import type { Store } from '../db'
import { getProject } from '../projects'
import { ApiError } from '../errors'
import { vocals, voices } from './jobs'

export function vocalTools(db: Store, projectId: string, emit?: (event: Record<string, unknown>) => void) {
  return {
    list_singing_voices: tool({
      description: 'List installed singing voices, supported languages, controls, readiness and usage terms.',
      inputSchema: z.object({}), execute: async () => voices(),
    }),
    render_vocal: tool({
      description: 'Synthesize an accepted vocal source only when requested. Apply proposed score edits first. Returns a durable job; does not edit or save the score.',
      inputSchema: z.object({ source_id: z.string(), expected_version: z.number().int() }),
      execute: async (input) => {
        try {
          const result = vocals(db).ensure(projectId, input)
          emit?.({ type: 'tool', name: 'render_vocal', status: result.status })
          return result
        }
        catch (e) {
          return { error: e instanceof Error ? e.message : 'Vocal rendering failed',
            ...(e instanceof ApiError ? { code: e.code, ...e.payload } : {}),
            ...(e instanceof ApiError && e.code === 'version_conflict' ? { action: 'Stop this render attempt. Do not guess versions; start a fresh request against the updated project.' } : {}),
          }
        }
      },
    }),
    vocal_status: tool({
      description: 'Read the current singing render and its actual stage. Stale audio cannot be used for the current score.',
      inputSchema: z.object({ source_id: z.string() }), execute: async ({ source_id }) => {
        getProject(db, projectId)
        return vocals(db).current(projectId, source_id)
      },
    }),
  }
}
