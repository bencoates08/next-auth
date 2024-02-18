import type { APIEvent } from "@solidjs/start/server"
import { redirect } from "@solidjs/router"
import { serialize } from "cookie"
import { json } from "@solidjs/router"

import { Auth, raw, skipCSRFCheck } from "@auth/core"
import type {
  AuthAction,
  AuthConfig as SolidAuthConfig,
} from "@auth/core/types"
import { setEnvDefaults } from "./env"

type SignInParams = Parameters<RequestEventLocals["signIn"]>

export async function signIn(
  provider: SignInParams[0],
  options: SignInParams[1] = {},
  authorizationParams: SignInParams[2],
  config: SolidAuthConfig,
  event: any
) {
  "use server"
  const { request } = event
  const headers = new Headers(request.headers)
  const {
    redirect: shouldRedirect = true,
    redirectTo,
    ...rest
  } = options instanceof FormData ? Object.fromEntries(options) : options

  const callbackUrl = redirectTo?.toString() ?? headers.get("Referer") ?? "/"
  const base = createActionURL("signin", headers, config.basePath)

  if (!provider) {
    const url = `${base}?${new URLSearchParams({ callbackUrl })}`
    if (shouldRedirect) redirect(url, 302)
    return url
  }

  let url = `${base}/${provider}?${new URLSearchParams(authorizationParams)}`
  let foundProvider: SignInParams[0] | undefined = undefined

  for (const _provider of config.providers) {
    const { id } = typeof _provider === "function" ? _provider() : _provider
    if (id === provider) {
      foundProvider = id
      break
    }
  }

  if (!foundProvider) {
    const url = `${base}?${new URLSearchParams({ callbackUrl })}`
    if (shouldRedirect) redirect(url, 302)
    return url
  }

  if (foundProvider === "credentials") {
    url = url.replace("signin", "callback")
  }

  headers.set("Content-Type", "application/x-www-form-urlencoded")
  const body = new URLSearchParams({ ...rest, callbackUrl })
  const req = new Request(url, { method: "POST", headers, body })
  const res = await Auth(req, { ...config, raw, skipCSRFCheck })

  for (const c of res?.cookies ?? []) {
    // setCookie(event, c.name, c.value, { path: "/", ...c.options })
    event.response.headers.set(
      "Set-Cookie",
      serialize(c.name, c.value, { path: "/", ...c.options })
    )
  }

  if (shouldRedirect) {
    return redirect(res.redirect!, 302)
  }

  // event.locals.auth = auth(event, config)
  // event.locals.getSession = auth(event, config)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.redirect as any
}

type SignOutParams = Parameters<RequestEventLocals["signOut"]>
export async function signOut(
  options: SignOutParams[0],
  config: SolidAuthConfig,
  event: APIEvent
) {
  "use server"
  const { request } = event
  const headers = new Headers(request.headers)
  headers.set("Content-Type", "application/x-www-form-urlencoded")

  const url = createActionURL("signout", headers, config.basePath)
  const callbackUrl = options?.redirectTo ?? headers.get("Referer") ?? "/"
  const body = new URLSearchParams({ callbackUrl })
  const req = new Request(url, { method: "POST", headers, body })

  const res = await Auth(req, { ...config, raw, skipCSRFCheck })

  for (const c of res?.cookies ?? []) {
    // setCookie(event, c.name, c.value, { path: "/", ...c.options })
    event.response.headers.set(
      "Set-Cookie",
      serialize(c.name, c.value, { path: "/", ...c.options })
    )
  }

  if (options?.redirect ?? true) return redirect(res.redirect!, 302)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res as any
}

export async function auth(
  event: APIEvent,
  config: SolidAuthConfig
): ReturnType<RequestEventLocals["auth"]> {
  "use server"
  setEnvDefaults(config)
  config.trustHost ??= true

  const { request: req } = event

  const sessionUrl = createActionURL("session", req.headers, config.basePath)
  const request = new Request(sessionUrl, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
  })
  const res = await Auth(request, config)

  // for (const c of response?.cookies ?? []) {
  //   setCookie(event, c.name, c.value, { path: "/", ...c })
  // }
  // for (const c of res?.cookies ?? []) {
  for (const c of res?.headers.getSetCookie() ?? []) {
    event.response.headers.set(
      "Set-Cookie",
      // serialize(c.name, c.value, { path: "/", ...c.options })
      serialize(c[0], c[1], { path: "/" })
    )
  }

  const { status = 200 } = res
  const data = await res.json()
  // const data = await res.body

  // event.locals.auth = auth(event, config)
  // event.locals.getSession = auth(event, config)

  if (!data || !Object.keys(data).length) return null
  if (status === 200) return json(data)
  throw new Error(data.message)
}

/**
 * Extract the origin and base path from either `AUTH_URL` or `NEXTAUTH_URL` environment variables,
 * or the request's headers and the {@link NextAuthConfig.basePath} option.
 */
export function createActionURL(
  action: AuthAction,
  headers: Headers,
  basePath?: string
) {
  let url = process.env.AUTH_URL
  if (!url) {
    const host = headers.get("x-forwarded-host") ?? headers.get("host")
    const proto = headers.get("x-forwarded-proto")
    url = `${proto === "http" || process.env.NODE_ENV === "development"
        ? "http"
        : "https"
      }://${host}${basePath}`
  }
  return new URL(`${url.replace(/\/$/, "")}/${action}`)
}
