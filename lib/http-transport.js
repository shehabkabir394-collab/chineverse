let execFilePromise = null;
const curlPreferredHosts = new Map();

export const CHROME_SEC_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1"
};

export function isCurlPreferredForHost(rawUrl) {
  try {
    const host = new URL(String(rawUrl || "")).hostname.toLowerCase();
    const exp = curlPreferredHosts.get(host) || 0;
    if (exp > Date.now()) return true;
    if (exp) curlPreferredHosts.delete(host);
  } catch {}
  return false;
}

export function markCurlPreferredForHost(rawUrl, ttlMs = 15 * 60 * 1000) {
  try {
    const host = new URL(String(rawUrl || "")).hostname.toLowerCase();
    if (host) curlPreferredHosts.set(host, Date.now() + ttlMs);
  } catch {}
}

export function clearCurlPreferredForHost(rawUrl) {
  try {
    const host = new URL(String(rawUrl || "")).hostname.toLowerCase();
    if (host) curlPreferredHosts.delete(host);
  } catch {}
}

async function getExecFile() {
  if (typeof process === "undefined" || !process.versions?.node) return null;
  try {
    const mod = process.getBuiltinModule?.("child_process");
    if (mod?.execFile) return mod.execFile;
  } catch {}
  if (!execFilePromise) {
    const modName = "node:child_process";
    execFilePromise = import(/* @vite-ignore */ modName)
      .then(m => m?.execFile || null)
      .catch(() => null);
  }
  return await execFilePromise;
}

export async function curlHttpRequest(targetUrl, options = {}) {
  const execFile = await getExecFile();
  if (!execFile) return null;

  let parsed;
  try {
    parsed = new URL(String(targetUrl || ""));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }

  const method = String(options.method || "GET").toUpperCase();
  const timeoutMs = Math.max(2500, Number(options.timeoutMs) || 12000);
  const maxSec = Math.max(3, Math.ceil(timeoutMs / 1000));
  const followRedirects = options.followRedirects !== false;
  const marker = "__HTTP_TRANSP_META__:";

  const args = [
    "--http2",
    "--ipv4",
    "--compressed",
    "-sS",
    "--connect-timeout",
    String(Math.min(8, maxSec)),
    "--max-time",
    String(maxSec),
    "-X",
    method,
    "-w",
    `\n${marker}%{http_code}|%{url_effective}|%{redirect_url}`
  ];

  if (followRedirects) {
    args.push("-L", "--max-redirs", String(options.maxRedirs ?? 5));
  }

  const hdrs = options.headers && typeof options.headers === "object" ? options.headers : {};
  for (const [k, v] of Object.entries(hdrs)) {
    if (v == null || v === "") continue;
    const cleanKey = String(k).replace(/[\r\n:]+/g, "").trim();
    const cleanVal = String(v).replace(/[\r\n]+/g, " ").trim();
    if (cleanKey && cleanVal) {
      args.push("-H", `${cleanKey}: ${cleanVal}`);
    }
  }

  if (options.body != null && method !== "GET" && method !== "HEAD") {
    args.push("--data-raw", String(options.body));
  }

  args.push("--url", parsed.href);

  return await new Promise(resolve => {
    try {
      execFile(
        "curl",
        args,
        { maxBuffer: 12 * 1024 * 1024, encoding: "utf8", timeout: timeoutMs + 2500 },
        (err, stdout) => {
          const raw = typeof stdout === "string" ? stdout : "";
          const idx = raw.lastIndexOf(`\n${marker}`);
          if (idx < 0) {
            if (err) return resolve(null);
            return resolve(null);
          }
          const body = raw.slice(0, idx);
          const metaPart = raw.slice(idx + marker.length + 1).trim();
          const [codeStr = "0", effectiveUrl = parsed.href, redirectUrl = ""] = metaPart.split("|");
          const status = Number(codeStr) || 0;
          if (!status && err) return resolve(null);
          let finalOrigin = parsed.origin;
          try {
            finalOrigin = new URL(effectiveUrl || parsed.href).origin;
          } catch {}
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: body,
            finalUrl: effectiveUrl || parsed.href,
            finalOrigin,
            redirectUrl: redirectUrl || ""
          });
        }
      );
    } catch {
      resolve(null);
    }
  });
}

export function combineAbortSignals(sigA, sigB) {
  if (!sigA) return sigB;
  if (!sigB) return sigA;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any([sigA, sigB]);
  }
  const ctrl = new AbortController();
  const forwardAbort = src => {
    try {
      ctrl.abort(src?.reason);
    } catch {
      ctrl.abort();
    }
  };
  if (sigA.aborted) {
    forwardAbort(sigA);
    return ctrl.signal;
  }
  if (sigB.aborted) {
    forwardAbort(sigB);
    return ctrl.signal;
  }
  sigA.addEventListener("abort", () => forwardAbort(sigA), { once: true });
  sigB.addEventListener("abort", () => forwardAbort(sigB), { once: true });
  return ctrl.signal;
}
