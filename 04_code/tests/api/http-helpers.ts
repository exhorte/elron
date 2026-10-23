// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: Request, ctx?: any) => Promise<Response>;

export interface CallResult {
  status: number;
  bytes: Uint8Array;
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
    /** Corps multipart : le Content-Type et la frontière sont posés automatiquement. */
    form?: FormData;
    /** Corps en flux (sans Content-Length), pour tester le plafond de lecture. */
    stream?: { chunks: number; chunkBytes: number; contentType: string };
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
  let init: RequestInit & { duplex?: "half" };
  if (opts.stream) {
    const { chunks, chunkBytes, contentType } = opts.stream;
    let sent = 0;
    headers["content-type"] = contentType;
    init = {
      method: opts.method ?? "POST",
      headers,
      duplex: "half",
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= chunks) return controller.close();
          sent += 1;
          controller.enqueue(new Uint8Array(chunkBytes));
        },
      }),
    };
  } else {
    init = {
      method: opts.method ?? "GET",
      headers,
      body: opts.form ?? opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    };
  }
  const req = new Request(`http://localhost${opts.path}`, init);
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* corps non JSON */
  }
  return { status: res.status, bytes, json, text, headers: res.headers };
}

/** Extrait « alx_session=… » d'un en-tête Set-Cookie. */
export function cookieFrom(res: CallResult): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}
