# ExamGuard design system

Status: replacement direction implemented. The previous blue workspace foundation was superseded at the user's direction. UI UX Pro Max regenerated the persisted system at `design-system/examguard/MASTER.md`, with page guidance for teacher workspace, candidate examination, and monitoring.

## Direction

ExamGuard now uses an editorial assessment identity: paper-toned public surfaces, ink navigation, restrained amber emphasis, serif display typography for narrative hierarchy, and compact sans-serif operational controls. The public site tells an assessment lifecycle rather than presenting a generic SaaS feature grid. Monitoring UI uses review language and never presents a signal as misconduct.

## Tokens

| Token group | Values |
| --- | --- |
| Brand | `--eg-primary` `#1c1917`, `--eg-primary-hover` `#44403c`, `--eg-accent` `#a16207` |
| Surfaces | `--eg-canvas`, `--eg-surface`, `--eg-subtle`, `--eg-line` |
| Feedback | `--eg-danger`, `--eg-success`; status needs a label and a dot, not color alone |
| Radius | 8px, 14px, 18px |
| Motion | 200ms interaction transitions; no decorative motion during examinations; reduced motion removes transitions |

Typography uses Plus Jakarta Sans when available with a system fallback. Body copy is at least 14px in dense application areas and 16px for long form/candidate examination reading.

## Component rules

- `button`: primary committed actions; minimum 44px target.
- `button-secondary`: reversible actions and navigation.
- `button-accent`: sparing, marketing/attention CTAs only; never a danger-state substitute.
- `input`: visible label, minimum 44px height, blue focus ring, inline error text.
- `card`: white surface, restrained border/shadow, 14–18px radius; do not stack decorative cards.
- `status-badge`: text plus dot; use `ready`, `review`, or `neutral` variants.
- Dialogs: labelled, visible close control, focus must not be hidden by fixed UI.

## Layout and navigation

Staff and candidate workspaces use a responsive, role-labelled application bar rather than the former persistent sidebar. Its tab set scrolls horizontally on small screens and keeps core routes visible. Workspace content has a keyboard skip link and a stable main landmark.

Candidate examinations use an intentionally plain `exam-workspace` surface: no decorative background, no autoplaying motion, clear timer/save state, and predictable question controls.

## Accessibility and responsiveness

- Focus indicators use a visible 2px blue ring and content scroll padding.
- Controls are native buttons/inputs with visible labels or accessible names.
- Reduced motion is respected globally.
- Layouts target 375px, 768px, 1024px, and 1440px; tables retain an overflow wrapper rather than clipping content.
- Signals must include text state and explanatory context. AI/radio signals are review-only.
