// GENERATED from ai-service/assistant/knowledge/*.md by `node scripts/sync-assistant-kb.mjs`. Do not edit by hand.
export interface Article { id: string; title: string; audience: string[]; body: string }
export const articles: Article[] = [
  {
    "id": "account-access",
    "title": "Signing in, registration and password reset",
    "audience": [
      "candidate",
      "teacher",
      "admin"
    ],
    "body": "Sign in from the ExamGuard login page with your email and password, or with Google or Microsoft if your organization has enabled them. If you forgot your password, choose Forgot password on the sign-in page and follow the emailed link. Reset links expire, so request a new one if yours does not work.\nCandidates join an organization when the organization adds them or when they register for it. If you cannot see your exam, confirm you are signed in with the email address your organizer used, then ask your organizer to check your assignment."
  },
  {
    "id": "admin-operations",
    "title": "Automation, notifications and retention",
    "audience": [
      "admin"
    ],
    "body": "ExamGuard runs background jobs for you: exams become live at their start time, attempts are closed and submitted when their deadline passes, candidates get reminders before an exam starts, and expired short-lived records are purged. The Operations page shows job health and recent failures.\nEvidence is never deleted automatically. When evidence passes the configured retention period, administrators are notified and the audit log records it so a person can decide what to do."
  },
  {
    "id": "admin-organization",
    "title": "Organization administration",
    "audience": [
      "admin"
    ],
    "body": "Administrators manage members, roles, exams and candidates for their own organization only. An organization always keeps at least one active administrator. Role changes and removals are audited. Use the audit log to understand who changed what and when."
  },
  {
    "id": "assistant-about",
    "title": "About the ExamGuard assistant",
    "audience": [
      "candidate",
      "teacher",
      "admin"
    ],
    "body": "The assistant answers questions about using ExamGuard from the help articles, and shows which article it used. It cannot answer exam questions, reveal hidden tests, help avoid monitoring, or look up individual results or incidents. During an active exam it only helps with technical support and logistics. Its answers may be AI-assisted; confirm important details with your organizer."
  },
  {
    "id": "candidate-companion",
    "title": "Windows Companion pairing and consent",
    "audience": [
      "candidate",
      "teacher",
      "admin"
    ],
    "body": "The Windows Companion is a separate Windows app that is only used when an organization requires it. Start the exam in your browser, create a short-lived pairing token from the active exam, and paste it into the Companion. The token expires after about ten minutes; create a new one if it expires.\nRead and accept the consent disclosure before scanning starts. Monitoring status is shown in the Companion and you can stop it at any time. Companion observations are evidence for a human reviewer. They are not proof of misconduct, and the Companion does not store raw MAC addresses or BSSIDs.\nRequirements: Windows with the .NET 8 runtime and Bluetooth and Wi-Fi turned on. If the Companion cannot verify pairing, check your internet connection and the clock on your computer, then generate a new token."
  },
  {
    "id": "candidate-device-readiness",
    "title": "Camera, microphone and network readiness",
    "audience": [
      "candidate",
      "teacher",
      "admin"
    ],
    "body": "Camera and microphone access is always controlled by your browser. ExamGuard never grants permission silently. If the browser blocked access, click the lock icon beside the address bar, set Camera or Microphone to Allow for this site, and reload the page.\nClose other apps that use the camera. Use a wired or stable Wi-Fi connection. If your connection drops, ExamGuard keeps your unsent answers in the page and retries saving when you are back online. The exam timer is held by the server, so a disconnection does not pause it.\nVisible indicators in the exam show when monitoring is active. If you are unsure whether proctoring applies to your exam, read the exam instructions or ask your teacher."
  },
  {
    "id": "candidate-submission",
    "title": "Autosave, deadlines and submission",
    "audience": [
      "candidate",
      "teacher",
      "admin"
    ],
    "body": "Answers are saved automatically while you work. If the autosave indicator shows a problem, stay on the page and check your connection; saving retries automatically. When you submit, you receive a submission receipt. Submitting twice does not create a second submission.\nThe deadline is the earlier of the exam end time and your start time plus the exam duration. After the deadline the server closes your attempt and no further answers are accepted. Results appear only after your teacher releases them."
  },
  {
    "id": "teacher-authoring",
    "title": "Creating exams and using AI drafts",
    "audience": [
      "teacher",
      "admin"
    ],
    "body": "Create an exam from the Exams page, add questions manually or from a question bank, assign candidates, then publish. Publishing makes the exam visible to assigned candidates only.\nAI-drafted questions, answer keys and rubrics are suggestions. Review and edit them before use. They are never published automatically, and AI never grades or decides misconduct on its own."
  },
  {
    "id": "teacher-incident-review",
    "title": "Reviewing incidents and evidence",
    "audience": [
      "teacher",
      "admin"
    ],
    "body": "Browser, AI and Companion signals are automated observations that help prioritize human review. They are not findings. Open an incident in the Evidence Center, review the evidence, and record a decision with a reason. Every decision is written to the audit log.\nEvidence is private and opened through short-lived links. Candidates can submit an explanation, which reviewers should read before deciding."
  },
  {
    "id": "teacher-results",
    "title": "Grading, manual marking and releasing results",
    "audience": [
      "teacher",
      "admin"
    ],
    "body": "Submitted attempts can be graded automatically for objective questions. Descriptive answers need manual marking. Manual marks plus automatic marks cannot exceed the exam's maximum marks. A published result is final and cannot be re-graded or silently changed.\nCandidates are notified when a result is published. Use Results and reports for participation and completion figures; they are computed from real submissions in your organization."
  }
];
