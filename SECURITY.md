# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's security advisory flow: **Security → Advisories → Report a vulnerability** on <https://github.com/mayur19/loglens>.

Include the affected version or commit, steps to reproduce, the impact you observed, and any suggested fix. You can expect an acknowledgement within 3 working days and a fix or mitigation plan within 14 days for high-severity issues. We will credit reporters in the changelog unless you prefer otherwise.

Areas of particular interest:

- LensQL compilation: any input that reaches SQL text instead of a bound parameter, or escapes the tenant predicate.
- Cross-tenant data access through any endpoint.
- Authentication bypass, session fixation, CSRF bypass, or bypass of the login throttle.
- Ingestion API key forgery or timing leaks.

## Hardening notes for operators

- Set `NODE_ENV=production` and an explicit `TRUST_PROXY` that matches your proxy topology. The API refuses to start without it in production.
- Terminate TLS at nginx and serve the SPA and API from the same origin, so cookies stay `SameSite=Lax` and `Secure`.
- Run **one** API instance per database until LG-216 moves rate-limiter counters to PostgreSQL.
- Use a dedicated non-superuser database role. Keep `/etc/loglens/loglens.env` readable only by root and the service user.
- Encrypt backups at rest. Dumps contain log data, password hashes and API key hashes.
- Treat logged data as sensitive. Scrub secrets at the source and give the `viewer` role to people who only need to read.

The full analysis is in [docs/security/threat-model.md](docs/security/threat-model.md).
