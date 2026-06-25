# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **raquino@navistone.com** with:

- A description of the vulnerability and its impact
- Steps to reproduce or a minimal proof of concept
- Any relevant log output (redact real tokens/credentials)

You will receive a response within 72 hours. If the issue is confirmed, a fix will be
released as soon as possible and you will be credited in the release notes (unless you
prefer to remain anonymous).

## Scope

The following are in scope:

- Token/credential exposure via the MCP server HTTP endpoints
- Path traversal in `GET /dashboard/record`
- XSS via vault record content rendered in the dashboard
- Loopback-only bind bypass (server binding to `0.0.0.0` or `::`)

The following are out of scope:

- Vulnerabilities requiring physical access to the machine
- Issues in dependencies that have already been reported upstream
- Social engineering

## Security Invariants

Five invariants are enforced in every release. See [CONTRIBUTING.md](CONTRIBUTING.md#security)
for the full list and the verification commands.
