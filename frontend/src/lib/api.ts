import type {
  AgentReply,
  CommandResult,
  ProducerCommand,
  Project,
  ProjectSummary,
  RevisionSummary,
} from '@/types/project'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

export class ApiError extends Error {
  code: string
  currentVersion?: number

  constructor(code: string, message: string, currentVersion?: number) {
    super(message)
    this.code = code
    this.currentVersion = currentVersion
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError(
      'network_error',
      'Cannot reach the local API. Is the backend running?',
    )
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      body?.code ?? 'request_failed',
      body?.message ?? `Request failed with status ${response.status}`,
      body?.current_version,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function listProjects(): Promise<ProjectSummary[]> {
  return request('/projects')
}

export function createProject(input: {
  name: string
  tempo: number
}): Promise<Project> {
  return request('/projects', { method: 'POST', body: JSON.stringify(input) })
}

export function getProject(projectId: string): Promise<Project> {
  return request(`/projects/${projectId}`)
}

export async function openProject(projectId: string): Promise<Project> {
  const project = await getProject(projectId)
  return project.is_draft ? project : request(`/projects/${projectId}/drafts`, { method: 'POST' })
}

export function saveDraft(projectId: string, expectedVersion: number, saveAs = false, name?: string): Promise<{ project: Project; saved_project_id: string }> {
  return request(`/projects/${projectId}/save`, {
    method: 'POST', body: JSON.stringify({ expected_version: expectedVersion, save_as: saveAs, name }),
  })
}

export function listRevisions(projectId: string): Promise<RevisionSummary[]> {
  return request(`/projects/${projectId}/revisions`)
}

export function applyCommand(
  projectId: string,
  expectedVersion: number,
  command: ProducerCommand,
): Promise<CommandResult> {
  return request(`/projects/${projectId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ expected_version: expectedVersion, command }),
  })
}

export function undoChange(
  projectId: string,
  expectedVersion: number,
): Promise<{ project: Project }> {
  return request(`/projects/${projectId}/undo`, {
    method: 'POST',
    body: JSON.stringify({ expected_version: expectedVersion }),
  })
}

export function sendProducerMessage(
  projectId: string,
  expectedVersion: number,
  text: string,
): Promise<AgentReply> {
  return request(`/projects/${projectId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, expected_version: expectedVersion }),
  })
}

export function applyBatch(
  projectId: string,
  expectedVersion: number,
  commands: ProducerCommand[],
  requestId: string = crypto.randomUUID(),
): Promise<{ project: Project }> {
  return request(`/projects/${projectId}/commands/batch`, {
    method: 'POST',
    body: JSON.stringify({
      expected_version: expectedVersion,
      request_id: requestId,
      commands,
    }),
  })
}
export async function uploadAudio(
  projectId: string,
  file: File,
): Promise<import('@/types/project').MediaAsset> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch(`${API_BASE}/projects/${projectId}/assets`, {
    method: 'POST',
    body,
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message ?? 'Upload failed')
  }
  return response.json()
}
export function mediaUrl(projectId: string, assetId: string) {
  return `${API_BASE}/projects/${projectId}/assets/${assetId}/content`
}
