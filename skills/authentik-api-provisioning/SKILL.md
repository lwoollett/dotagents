---
name: "authentik-api-provisioning"
description: "Provision Authentik providers/apps/outposts via API and gate Caddy subdomains with forward auth"
---

# Provision Authentik via API (forward auth + OIDC)

Use when adding Authentik-protected apps to the homelab (gating a subdomain behind forward auth, or wiring an app's native OIDC). Working reference: `~/repos/ansible/authentik/provision.py` + the Caddyfile there. Tested against authentik 2026.8.3.

## Getting an API token (no UI, no basic auth)

Basic auth is rejected; session-cookie writes hit CSRF walls that the API never hands you. Mint a token inside the container instead:

```
echo 'from authentik.core.models import User, Token, TokenIntents
u = User.objects.get(username="akadmin")
t, _ = Token.objects.get_or_create(identifier="automation",
    defaults=dict(user=u, intent=TokenIntents.INTENT_API))
t.key = "<known 60-char hex>"; t.expiring = False; t.expires = None
t.save()' | docker exec -i authentik-worker ak shell
```

Set an explicit known key (keys are 60 chars and silently break when transcribed/truncated) and `expiring=False` (default expires in ~a day). Token auth = `Authorization: Bearer <key>`, no CSRF needed. Bootstrap username is ALWAYS `akadmin` (AUTHENTIK_BOOTSTRAP_NAME only changes the display name).

## API gotchas (2026.8.x)

- List/create endpoints are plain: `/api/v3/providers/proxy/`, `/api/v3/providers/oauth2/`, `/api/v3/outposts/instances/`, `/api/v3/core/applications/`. The nested paths (proxy/proxy/, oauth2/oauth2providers/, outposts/outposts/) 404.
- **`?name=` and `?slug=` query filters are silently ignored** — they return ALL rows and every "exists?" check lies. Fetch the full list and match client-side.
- Providers need BOTH `authorization_flow` (slug `default-provider-authorization-implicit-consent`) and `invalidation_flow` (slug `default-provider-invalidation-flow`).
- OAuth2 `redirect_uris` is a list of dicts: `[{"matching_mode": "strict", "url": "https://app/..."}]`. The client secret is only shown on create.
- Embedded outpost: create/reuse one of type=proxy with `providers=[pks]`, no service connection needed. **Must set `config.authentik_host = "https://auth.example"` or every forward-auth redirect goes to `http://localhost`.** The auto-managed one is named "authentik Embedded Outpost" — match by `type`, not name.

## Caddy wiring (per gated subdomain)

```
(authentik_gate) {
	reverse_proxy /outpost.goauthentik.io/* <authentik-ip>:9000
	forward_auth <authentik-ip>:9000 {
		uri /outpost.goauthentik.io/auth/caddy
		copy_headers X-Authentik-Username X-Authentik-Groups X-Authentik-Email X-Authentik-Name X-Authentik-Uid X-Authentik-Jwt X-Authentik-Meta-Jwks X-Authentik-Meta-Outpost X-Authentik-Meta-Provider X-Authentik-Meta-App X-Authentik-Meta-Version
	}
}
```

Import it inside a `route { }` block before the app's `reverse_proxy` (ordering matters). The auth domain itself must also route `/outpost.goauthentik.io/*` to :9000. Providers in `forward_domain` mode with `cookie_domain` set give one login for all subdomains.

Do NOT forward-auth apps with native mobile/TV clients (Jellyfin, Audiobookshelf) — the apps can't complete the web login flow. Use native OIDC (Booklore-style: issuer `https://auth.../application/o/<slug>/`) or leave own auth.
