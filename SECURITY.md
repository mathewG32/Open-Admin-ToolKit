# Security Policy

## Supported versions

OpenAdmin Kit is pre-alpha (`0.0.x`). No version is supported for production use yet. Security fixes land on `main`.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's **"Report a vulnerability"** button on this repository's Security tab (private vulnerability reporting).

<!-- TODO(maintainer): enable private vulnerability reporting in repo settings, and/or add a security contact email here. -->

Please include:
- affected package and commit/version
- a minimal reproduction (an Express app snippet and the HTTP requests)
- the impact you observed

## What to expect

This is a small, part-time project. We aim to:
- acknowledge reports within **7 days**
- reproduce privately, patch, test, and release
- publish an advisory listing the affected versions once a fix is available
- credit reporters who want to be credited

## Scope

In scope: authentication/authorization bypass, data exposure through resources or errors, audit-log injection or secret leakage, and anything that lets a client influence the actor, permissions, or tenant.

Out of scope: vulnerabilities in a host application's own `authenticate`, `authorize`, or data handlers (the toolkit can't fix those), and the demo login in `examples/`, which is intentionally fake.
