export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    payload: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}
export function invalid(message: string): never {
  throw new ApiError(422, "invalid_command", message);
}
export function missing(message = "Resource not found"): never {
  throw new ApiError(404, "not_found", message);
}
export function locked(): never {
  throw new ApiError(409, "locked_section", "This section is locked");
}
export function conflict(version: number): never {
  throw new ApiError(
    409,
    "version_conflict",
    "The project changed since you loaded it. Refresh before retrying.",
    { current_version: version },
  );
}
