# Dependency security audit

Audit date: 2026-11-06. Source: `npm.cmd audit --json` against the workspace lockfile. No environment files, databases, or services were changed.

## Remediated findings

| Package | Previous | Remediated version | Severity | Dependency path | Assessment |
| --- | --- | --- | --- | --- | --- |
| Vitest / `@vitest/mocker` / `tinypool` | 3.2.4 / 3.2.4 / 1.1.1 | Vitest 4.1.12 | Critical / Moderate | direct client development test runner | Fixed. Vitest 4 supports the existing Vite 6 and Node 24 runtime. The exposed UI server is not used by the test command, but development tooling must still be patched. |
| Vite | 6.4.4 | 6.4.5 | Moderate | direct client development/build tool | Fixed through the non-major audit update. The affected development server file-system behavior is not part of the production bundle. |
| `follow-redirects` | 1.16.1 | 1.16.2 | High | Axios, used by client and server HTTP calls | Fixed through the audit update. The finding concerns redirect credential handling. |
| `qs` | 6.16.0 | 6.16.2 | Moderate | Express/body-parser | Fixed through the audit update. The finding concerns a malformed `arrayFormat: comma` value. |

## Remaining finding

| Package | Installed | Severity | Directness | Fixed version | Decision |
| --- | --- | --- | --- | --- | --- |
| Zod | 3.25.76 | High | Direct in client and server | 4.6.7 (major) | Not automatically upgraded. The advisory concerns memory exhaustion with oversized constrained collections. The server has Express's 100 KB JSON body limit and route-level input bounds, which reduce exposure but do not replace a migration. Zod v4 requires deliberate API compatibility testing across every schema. |

`npm audit` after remediation reports exactly one high-severity Zod finding, and zero critical findings. A Zod v4 migration remains a tracked, separately reviewable change; `npm audit fix --force` was not used.

## Non-NPM components

- Python requirements are pinned. Optional computer-vision dependencies are isolated in `requirements-ai.txt`; they were not installed or downloaded.
- The .NET project references the Windows SDK supplied by the installed .NET toolchain and has no NuGet package references in its project file.

## Validation

- `npm.cmd run test -w client`: passed, 8 tests.
- `npm.cmd run build -w client`: passed.
- `npm.cmd run typecheck -w server`: passed.
