// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: Request, ctx?: any) => Promise<Response>;

export interface CallResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  text: string;
  headers: Headers;
}

/** Appelle directement un handler de route Next.js avec une vraie `Request` (sans serveur HTTP). */
export async function call(
  handler: RouteHandler,
  opts: {
    method?: string;
    path: string;
    body?: unknown;
    rawBody?: string;
    contentType?: string | null;
    cookie?: string;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  },
): Promise<CallResult> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  const hasBody = opts.body !== undefined || opts.rawBody !== undefined;
  if (hasBody && opts.contentType !== null) headers["content-type"] = opts.contentType ?? "application/json";
  const req = new Request(`http://localhost${opts.path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* corps non JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Extrait « alx_session=… » d'un en-tête Set-Cookie. */
export function cookieFrom(res: CallResult): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}
