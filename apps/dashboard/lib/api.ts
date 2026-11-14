/**
 * SkyNode Cloud API Client
 *
 * Provides a typed fetch wrapper for communicating with the SkyNode API.
 * Handles authentication, CSRF tokens, and structured error responses.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: Record<string, string[]>;
  };
  meta?: {
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface ApiError {
  message: string;
  code?: string;
  status: number;
  details?: Record<string, string[]>;
}

let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/csrf`, {
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.token ?? null;
      return csrfToken;
    }
  } catch {
    // CSRF endpoint unavailable — proceed without
  }

  return null;
}

export function clearCsrfToken(): void {
  csrfToken = null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };

  // Attach CSRF token for state-changing methods
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const token = await getCsrfToken();
    if (token) {
      headers['X-CSRF-Token'] = token;
    }
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      ...options,
    });

    // Handle 204 No Content
    if (res.status === 204) {
      return { success: true };
    }

    const json = await res.json();

    if (!res.ok) {
      return {
        success: false,
        error: {
          message: json.error?.message ?? json.message ?? 'Request failed',
          code: json.error?.code ?? String(res.status),
          details: json.error?.details,
        },
      };
    }

    return {
      success: true,
      data: json.data ?? json,
      meta: json.meta,
    };
  } catch (err) {
    return {
      success: false,
      error: {
        message:
          err instanceof Error ? err.message : 'Network error. Please try again.',
        code: 'NETWORK_ERROR',
      },
    };
  }
}

export const api = {
  get: <T>(path: string, options?: RequestInit) =>
    request<T>('GET', path, undefined, options),

  post: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>('POST', path, body, options),

  patch: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>('PATCH', path, body, options),

  put: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>('PUT', path, body, options),

  delete: <T>(path: string, options?: RequestInit) =>
    request<T>('DELETE', path, undefined, options),
};

export default api;
