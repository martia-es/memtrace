/** Llamadas fetch al flujo de Auth.js (CSRF, sign-in, sign-out): no son el puerto IdentityApi, viven aquí para que solo esta capa toque `fetch` directamente. */

export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/auth/csrf", { credentials: "include" });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

export async function postSignOut(csrfToken: string, callbackUrl: string): Promise<void> {
  await fetch("/api/auth/signout", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, callbackUrl }),
  });
}
