export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const clerk = (window as any).Clerk
  if (clerk?.session) {
    const token = await clerk.session.getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}

export async function errorText(res: Response): Promise<string> {
  try {
    const j = await res.clone().json()
    return j.error || JSON.stringify(j)
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}
