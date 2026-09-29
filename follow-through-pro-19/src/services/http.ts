/**
 * Thin HTTP transport for the FollowThrough REST API.
 *
 * Every service module goes through `request()`, which attaches the bearer
 * token from localStorage, encodes query parameters, and turns the
 * backend's RFC 7807 ProblemDetail bodies into `ApiError`s. The base URL
 * comes from `VITE_API_BASE_URL` (see `.env.local`); the default is the
 * Spring Boot API's pinned local port and context path.
 */

export const API_BASE_URL =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "http://localhost:8082/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    /** Per-field validation messages, when the backend's ProblemDetail body
     * included them (see GlobalExceptionHandler on the Spring Boot side). */
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: QueryParams;
  body?: unknown;
}

function buildUrl(path: string, params?: QueryParams) {
  const url = new URL(`${API_BASE_URL}${path}`);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("followthrough.token");
  } catch {
    return null;
  }
}

/**
 * The backend reports errors as an RFC 7807 ProblemDetail body (detail,
 * plus fieldErrors for validation failures — see GlobalExceptionHandler).
 */
async function toApiError(response: Response, path: string): Promise<ApiError> {
  try {
    const body: unknown = await response.json();
    const detail =
      body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
        ? body.detail
        : `Request failed with status ${response.status}`;
    const fieldErrors =
      body && typeof body === "object" && "fieldErrors" in body
        ? (body.fieldErrors as Record<string, string>)
        : undefined;
    return new ApiError(detail, response.status, path, fieldErrors);
  } catch {
    return new ApiError(`Request failed with status ${response.status}`, response.status, path);
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", params, body } = options;

  const token = getAuthToken();
  const response = await fetch(buildUrl(path, params), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw await toApiError(response, path);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
