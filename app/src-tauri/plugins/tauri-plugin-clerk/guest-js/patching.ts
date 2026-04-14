import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";

//
// PATCHING
//
// To code around some Clerk limitations we're piping
// clerk requests through rust
//

const realFetch = globalThis.fetch;

type Fetch = typeof realFetch;
type FetchReturn = ReturnType<Fetch>;
type FetchArgs = Parameters<Fetch>;

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

const urlForRequestInput = (input: FetchArgs[0]) =>
  typeof input === "string"
    ? new URL(input)
    : input instanceof URL
      ? input
      : new URL(input.url);

const runTauriFetch = async (input: FetchArgs[0], init: FetchArgs[1]) => {
  const req = new Request(input, init);
  const res = await tauriFetch(req);
  return res;
};

const shouldRunTauriFetch = (input: FetchArgs[0], init: FetchArgs[1]) => {
  const initHeaders = init?.headers;

  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      // Don't route Clerk requests through Tauri HTTP plugin — on Android,
      // the native HTTP layer auto-adds Origin, which conflicts with
      // Authorization (Clerk's origin_authorization_headers_conflict check).
      // Browser fetch + _is_native=1 handles this correctly.
      if (initHeaders.has("x-no-origin")) {
        return false;
      }
      return initHeaders.has("x-tauri-fetch");
    } else if (Array.isArray(initHeaders)) {
      if (initHeaders.some((h) => h[0] === "x-no-origin")) {
        return false;
      }
      return initHeaders.some((h) => h[0] === "x-tauri-fetch");
    } else {
      if (initHeaders["x-no-origin"]) {
        return false;
      }
      return !!initHeaders["x-tauri-fetch"];
    }
  }

  if (input instanceof Request) {
    if (input.headers.has("x-no-origin")) {
      return false;
    }
    return input.headers.has("x-tauri-fetch");
  }
  return false;
};

const parseTauriFetchBody = (
  obj: Json,
): { clientConfig: { [key: string]: Json } } => {
  if (
    obj &&
    typeof obj === "object" &&
    obj !== null &&
    "clientConfig" in obj &&
    typeof obj.clientConfig === "object" &&
    obj.clientConfig !== null &&
    !Array.isArray(obj.clientConfig)
  ) {
    return obj as { clientConfig: { [key: string]: Json } };
  }
  throw new Error("Invalid Tauri Fetch Body: no clientConfig");
};

const getHeadersFromTauriFetchBody = (body: {
  clientConfig: { [key: string]: Json };
}): [string, string][] => {
  if (
    "headers" in body.clientConfig &&
    Array.isArray(body.clientConfig.headers) &&
    body.clientConfig.headers.every(
      (v): v is [string, string] =>
        Array.isArray(v) &&
        v.length === 2 &&
        typeof v[0] === "string" &&
        typeof v[1] === "string",
    )
  ) {
    return body.clientConfig.headers;
  }
  throw new Error("Invalid Tauri Fetch Body: no headers");
};

const runRealFetch = async (input: FetchArgs[0], init: FetchArgs[1]) => {
  // tauri-plugin-http uses plain fetch so we here indentify
  // if we should modify the request headers that are sent
  // via tauri fetch
  const url = urlForRequestInput(input);
  const path = decodeURIComponent(url.pathname);
  const shouldInjectHeaders = path === "/plugin:http|fetch";

  let initToPass = init;

  if (shouldInjectHeaders && typeof init?.body === "string") {
    const rawBody = JSON.parse(init.body) as Json;
    const body = parseTauriFetchBody(rawBody);
    const existingHeaders = getHeadersFromTauriFetchBody(body);

    if (existingHeaders) {
      const headers = [
        ...existingHeaders,
        ["User-Agent", window.navigator.userAgent],
      ] as [string, string][];

      if (existingHeaders.some((h) => h[0] === "x-no-origin")) {
        headers.push(["Origin", ""]);
      } else {
        headers.push(["Origin", window.location.origin]);
      }

      initToPass = {
        ...init,
        body: JSON.stringify({
          body,
          clientConfig: {
            ...body.clientConfig,
            headers,
          },
        }),
      };
    }
  }

  const res = await realFetch(input, initToPass);

  return res;
};

const patchFetch = async (
  input: FetchArgs[0],
  init: FetchArgs[1],
): FetchReturn => {
  // Intercept Clerk API requests and route through Rust backend
  // to avoid Origin header conflicts on Android
  if (shouldProxyClerkRequest(input, init)) {
    return await proxyClerkRequest(input, init);
  }
  if (shouldRunTauriFetch(input, init)) {
    return await runTauriFetch(input, init);
  } else {
    return await runRealFetch(input, init);
  }
};

let __internalIsPatched = false;

// Check if a request targets Clerk's API and should be proxied through Rust
const shouldProxyClerkRequest = (
  input: FetchArgs[0],
  init: FetchArgs[1],
): boolean => {
  const initHeaders = init?.headers;
  const hasNoOrigin =
    initHeaders instanceof Headers
      ? initHeaders.has("x-no-origin")
      : Array.isArray(initHeaders)
        ? initHeaders.some((h) => h[0] === "x-no-origin")
        : initHeaders
          ? !!initHeaders["x-no-origin"]
          : false;

  if (!hasNoOrigin) return false;

  const url = urlForRequestInput(input);
  return url.hostname.endsWith(".clerk.accounts.dev") ||
    url.hostname.endsWith(".clerk.com") ||
    url.pathname.startsWith("/v1/client") ||
    url.pathname.startsWith("/v1/environment");
};

// Proxy a Clerk API request through the Rust backend
const proxyClerkRequest = async (
  input: FetchArgs[0],
  init: FetchArgs[1],
): FetchReturn => {
  const url = urlForRequestInput(input);
  const method = init?.method || "GET";

  // Collect headers as [key, value][] tuples
  const headerTuples: [string, string][] = [];
  const initHeaders = init?.headers;
  if (initHeaders instanceof Headers) {
    initHeaders.forEach((v, k) => headerTuples.push([k, v]));
  } else if (Array.isArray(initHeaders)) {
    headerTuples.push(...(initHeaders as [string, string][]));
  } else if (initHeaders) {
    for (const [k, v] of Object.entries(initHeaders)) {
      headerTuples.push([k, v as string]);
    }
  }

  let body: unknown = undefined;
  if (init?.body && typeof init.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }

  try {
    const result = await invoke<{
      status: number;
      headers: [string, string][];
      body: unknown;
    }>("plugin:clerk|clerk_proxy", {
      url: url.toString(),
      method,
      body: body ?? null,
      headers: headerTuples,
    });

    const responseHeaders = new Headers();
    for (const [k, v] of result.headers) {
      responseHeaders.append(k, v);
    }

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: responseHeaders,
    });
  } catch (e) {
    // Fall back to normal fetch if proxy fails
    console.error("[clerk] Proxy failed, falling back to direct fetch:", e);
    return await realFetch(input, init);
  }
};

export const applyGlobalPatches = (): void => {
  if (__internalIsPatched) {
    return;
  }
  __internalIsPatched = true;
  // !!!! WE DO PATCH GLOBAL FETCH !!!!
  globalThis.fetch = patchFetch;
};
