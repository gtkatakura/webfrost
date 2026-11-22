# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue: use **Security → Report a
vulnerability** on the [GitHub repository](https://github.com/gtkatakura/webfrost/security), or
email security@webfrost.dev.
Include the affected version or commit, steps to reproduce, and the impact you observed. Allow up
to 90 days for a fix before public disclosure.

## How WebFrost is secured

Authentication, rate limits, the SSRF guard and public read mode are described in
[Security](https://webfrost.dev/docs/architecture/security); the attack surface and open risks in the
[threat model](https://webfrost.dev/docs/architecture/threat-model). Before exposing a server, work
through [Harden a deployment](https://webfrost.dev/docs/guides/harden-a-deployment).
