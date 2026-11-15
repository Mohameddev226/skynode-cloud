const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Handle 204 No Content
    if (res.status === 204) return { success: true };

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        error: {
          message: json?.message ?? json?.error?.message ?? `HTTP ${res.status}`,
          code: json?.error?.code,
        },
      };
    }

    let payload = json?.data ?? json;
    if (payload && typeof payload === 'object' && 'data' in payload && !Array.isArray(payload)) {
      payload = (payload as Record<string, unknown>).data;
    }

    return { success: true, data: payload as T };
  } catch (err) {
    return {
      success: false,
      error: {
        message: err instanceof Error ? err.message : 'Network error',
      },
    };
  }
}

const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export default api;
