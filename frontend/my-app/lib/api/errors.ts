/**
 * An error from the backend API. `message` is always safe to show people.
 *
 * When an AI provider fails (out of credit, rejected key, rate limit, outage) the backend
 * adds an `error` object with a code and, where it helps, a link to fix it, such as the
 * provider's billing page. See backend/core/provider_errors.py.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly actionUrl: string | null;
  readonly actionLabel: string | null;

  constructor(message: string, options: { status: number; code?: string | null; actionUrl?: string | null; actionLabel?: string | null }) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code ?? null;
    this.actionUrl = options.actionUrl ?? null;
    this.actionLabel = options.actionLabel ?? null;
  }
}

interface ApiErrorBody {
  detail?: unknown;
  error?: { code?: unknown; action_url?: unknown; action_label?: unknown };
}

const asString = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** Throws an ApiError built from a failed response; `fallback` is used when the body has no message. */
export async function readApiError(response: Response, fallback: string): Promise<never> {
  let body: ApiErrorBody | null = null;
  try {
    body = await response.json() as ApiErrorBody;
  } catch {
    // Not JSON (for example a proxy error page): fall back to the status code.
  }
  const message = asString(body?.detail) ?? `${fallback} (${response.status})`;
  throw new ApiError(message, {
    status: response.status,
    code: asString(body?.error?.code),
    actionUrl: asString(body?.error?.action_url),
    actionLabel: asString(body?.error?.action_label),
  });
}
