# Security Policy

## Supported versions

Security fixes are applied to the latest code on `main` (editor site and Chrome extension `2.x`).

| Version | Supported |
| ------- | --------- |
| 2.x (current `main`) | Yes |
| Older releases / forks | No |

## What this project is

Bihar Police Notebook is a **static website** (`editor/`) plus a small **Chrome MV3 launcher** (`extension/`). Documents are stored only in the user’s browser (IndexedDB). There is no application server and no cloud account for notes.

## Reporting a vulnerability

Please report security issues privately so they can be fixed before public disclosure.

1. Prefer [GitHub Security Advisories](https://github.com/arverma/Bihar-Police-Notebook/security/advisories/new) for this repository, **or**
2. Open a [private security report](https://github.com/arverma/Bihar-Police-Notebook/security) if available, **or**
3. If neither works, open a GitHub issue **without** exploit details and ask for a private channel.

Include:

- Affected surface (`editor/`, `extension/`, or both)
- Browser / OS version
- Steps to reproduce
- Impact (e.g. data exposure, XSS, unexpected permissions)

We aim to acknowledge reports within **7 days** and share a fix timeline after triage.

## Out of scope (examples)

- Compromised or malicious browser extensions unrelated to this project
- User clearing site data / using a new domain (IndexedDB is origin-scoped; this is expected)
- Third-party services used by choice (e.g. Google Input Tools, optional cloud speech) when used as designed after user consent
- Social engineering or physical access to the device

## Scope notes for researchers

- The extension should only open/focus the editor tab and request minimal permissions (`tabs`).
- The editor must not exfiltrate document contents to our infrastructure (there is none for notes).
- XSS or injection in the editor that could read or alter local documents is in scope.
