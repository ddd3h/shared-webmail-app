// A browser always says which site a request comes from (the Origin header). A form on another website that posts to
// us would carry that site's name, so a state-changing request whose Origin is not one of ours is refused.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function originProblem(method: string, origin: string | null, ownHosts: (string | null | undefined)[]): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  if (!origin) return false; // not a browser (scripts, server-to-server): the session cookie rules decide
  if (origin === 'null') return true; // sandboxed iframes and some redirects
  try {
    const host = new URL(origin).host;
    return !ownHosts.filter(Boolean).some(h => h!.toLowerCase() === host.toLowerCase());
  } catch { return true; }
}
