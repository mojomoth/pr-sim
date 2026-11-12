// Where the API lives. Web build: same origin (""). A native (Capacitor static export) build sets
// NEXT_PUBLIC_API_BASE to the deployed server, e.g. "https://pr-sim.example.com". Not a secret.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
