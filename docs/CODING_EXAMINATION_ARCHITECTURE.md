# Coding examination architecture

Status: **design and safe contract primitives only** (2026-11-06). ExamGuard has no enabled coding language and does not execute student code. This document is not an execution-readiness claim.

## Observed baseline

- The current `QuestionType` enum contains only `mcq`, `multiple_select`, `true_false`, `short_answer`, and `descriptive`.
- `Question`, `AttemptAnswer`, `ExamAttempt`, and `Grade` are the existing reusable assessment entities. There is no coding-question metadata, test-case store, source-code persistence, submission history, language configuration, or execution job/result model.
- The Express API and browser run in the primary application environment. They must never compile or run candidate source code.
- There is no Judge0 client, queue, worker, Monaco dependency, or deployed isolated runner in this repository.

## Proposed data model (requires explicit migration approval)

Extend the existing entities instead of duplicating examinations or attempts:

| Entity | Purpose and key fields | Security boundary |
| --- | --- | --- |
| `Question` | Add `coding` to `QuestionType`; retain existing marks, position, bank/exam ownership. | Existing draft-only teacher editing and tenant filters remain in force. |
| `CodingQuestion` | One-to-one question detail: title, statement sections, difficulty, mode (`function`/`stdin_stdout`), constraints, language IDs, starter-code JSON, comparison mode, time/memory limits. | Candidate query returns public fields and visible samples only. |
| `CodingTestCase` | Question-owned case with input, expected output, visibility (`sample`/`private`), order. | Private values are never serialized in candidate endpoints, logs, audit metadata, or runner responses. |
| `AttemptCode` | One row per attempt/question: source code, language, saved time, version. | Candidate ownership, active attempt, question belongs to attempt's exam, and deadline are checked for every write. |
| `CodeSubmission` | Immutable final/run record: attempt/question, language, source snapshot, kind (`run`/`submit`), queued/completed timestamps, runner job reference, status. | Source is authorized candidate/teacher data; it is never sent to another organization. |
| `CodeExecutionCaseResult` | Submission result per test case: status, score, time/memory, sanitized candidate output. | Links private case server-side; only aggregate/private-safe fields go to candidates. |

Recommended indexes: `CodingQuestion(questionId unique)`, `CodingTestCase(codingQuestionId, visibility, position)`, `AttemptCode(attemptId, questionId unique)`, `CodeSubmission(attemptId, questionId, createdAt desc)`, and tenant-bearing indexes matching every organization-scoped list/query.

## API/data flow

1. Teacher creates a regular draft `Exam`, then adds `coding` questions and private/sample cases. Server validates limits, enabled languages, question ownership, and draft status.
2. Candidate starts an existing authorized `ExamAttempt`. Candidate payload contains coding problem text, permitted languages, starter code, and sample cases—never private cases.
3. Code autosave writes `AttemptCode` through the existing authenticated, ownership- and deadline-checked answer path shape. Browser component state is transient edit state only; server persistence is always the authority and enables refresh recovery.
4. **Run** creates a rate-limited `CodeSubmission(kind=run)` and sends source plus only sample inputs to a private runner adapter. It does not change final marks or final submission state.
5. **Submit** snapshots source in `CodeSubmission(kind=submit)`, queues an authenticated runner request for all cases, persists sanitized results, calculates question score, then contributes to the existing `Grade` flow.
6. Teacher results endpoints may view submitted source and outcomes for their organization. Candidate endpoints receive aggregate status and sample detail only.

## Runner contract and deployment prerequisite

Use a maintained, separately deployed isolated runner such as self-hosted Judge0 only after an infrastructure/security review. The Express API calls it over a private authenticated network using a service credential that is never exposed to the browser.

The runner deployment must prove, per execution: non-root/least-privilege containers, no outbound network, read-only/minimal filesystem, CPU/memory/wall-clock/process limits, request/output/source-size caps, syscall/container isolation, bounded concurrency queue, cancellation/timeout handling, and logs that omit source and private tests. The runner must report compiler/runtime version and measured resource usage. Do not derive commands from candidate input.

Before enabling any language, record the runner's language identifier/version, compile/runtime command supplied by the runner, source extension, verified time/memory caps, and the date/version of an isolation test. The current language list is intentionally `not_configured`; it is a planning registry, not support.

## Required test plan

- Unit: coding-question validation, exact vs configured whitespace comparison, score calculation, private-case response redaction, language allow-list, and deadline/ownership predicates.
- API/integration (writes only with explicit `examguard_test` authorization): tenant isolation; draft-only editing; candidate autosave; run rate limit; submit idempotency; private-case non-disclosure; timeout/compiler/runtime failure persistence; grades/results authorization.
- Runner/security: harmless source only; verify time, memory, process, filesystem, network, output-size, queue, credential, and cancellation limits against the deployed runner. This requires an independently reviewed non-production sandbox.
- Browser: editor autosave/recovery, language change preserves per-question code, question navigation preserves code, run vs submit distinction, keyboard/fullscreen/responsive behavior, and no hidden-case leakage.

## Completed application preparation

- `server/src/coding.ts` declares five proposed languages as `not_configured`, implements exact and explicitly whitespace-normalized output comparison, and projects runner results so private test input/output/actual output cannot reach a candidate.
- `server/src/coding-contracts.ts` validates bounded coding question, test-case, autosave, and execution requests. It also declares separate rate-limit policy values: 12 sample runs/minute, 4 final submissions/minute, and 60 autosaves/minute. Route wiring waits for the migration-backed endpoints.
- `server/src/coding-submission-service.ts` provides a persistence/runner service interface and an ownership guard requiring the authenticated candidate, same organization, active attempt, and unexpired server deadline. It deliberately takes server-loaded runner test data, never a browser-supplied private test case.
- `server/src/judge0-adapter.ts` defines a private Judge0 HTTP adapter using a deployment-supplied authorization header, an abort timeout, caller-supplied server-side language ID, `enable_network: false`, and asynchronous job status retrieval. `UnavailableRunnerAdapter` throws rather than inventing a token or result.
- `client/src/coding-exam.tsx` provides the native Monaco split-pane coding interface: problem panel, question tabs, language/starter code switching, accessible resize control, editor theme toggle, full-screen control, visible samples, execution console, save status, and responsive layout. Code remains in component state across question changes; it is never placed in localStorage. Until a persistence/runner adapter is supplied, autosave, Run, Submit, server history, and final coding submission explicitly remain unavailable.
- The ordinary student examination route switches to this workspace only when a future authorized API payload contains `type: "coding"`; existing traditional exam behavior is unchanged.

## Prepared migration (not applied)

`server/prisma/migrations/20261106223000_add_coding_assessments/migration.sql` and the matching `schema.prisma` proposal add the `coding` question type and the `CodingQuestion`, `CodingTestCase`, `AttemptCode`, `CodeSubmission`, `ExecutionJob`, and `ExecutionResult` entities. They reuse existing organization, question, attempt, candidate, and grade ownership rather than creating duplicate exams. `npx.cmd prisma validate --schema prisma\\schema.prisma` passed without connecting to a database. No Prisma generate, migrate, deploy, reset, seed, or database query was run.

## Approvals needed to proceed

1. Approve the proposed schema/migration after review (and separately authorize applying it to the test database).
2. Select and provide a reviewed isolated runner deployment and private API credential approach; do not use the Express host or a local `child_process` executor.
3. Approve quotas/retention: source retention, submission history, max source/output size, per-run/per-submit rate, time/memory/process limits, runner queue limits, and candidate/teacher result visibility.
4. The maintained Monaco React wrapper is now installed for the client workspace; approve its use in production only after the backend contract and runner have passed the listed security checks.
