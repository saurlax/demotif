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
    throw new ApiError('network_error', 'Cannot reach the local API. Is the backend running?')
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

export function createProject(input: { name: string; tempo: number }): Promise<Project> {
  return request('/projects', { method: 'POST', body: JSON.stringify(input) })
}

export function getProject(projectId: string): Promise<Project> {
  return request(`/projects/${projectId}`)
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

export function undoChange(projectId: string, expectedVersion: number): Promise<{ project: Project }> {
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
