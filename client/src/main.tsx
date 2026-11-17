// @ts-nocheck -- legacy route module still needs incremental TypeScript extraction; new shared utilities/components are strictly typed.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import axios from "axios";
import { io } from "socket.io-client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileText,
  FileSearch,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
  UserCog,
  CircleUser,
  ScrollText,
  Gauge,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
  MapPin,
  Search,
  RefreshCw,
  Users,
  LifeBuoy,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { CoordinatorApplicationPage, ForgotPasswordPage, InstitutionApplicationPage, ResetPasswordPage, StudentApplicationPage } from "./auth-pages";
import { Landing } from "./marketing";
import { CodingExamWorkspace, type CodingExecutionResult } from "./coding-exam";
import { Badge, Button, CopyableId } from "./components/ui";
import { Checkbox, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui";
import { Dialog, DialogContent } from "./components/ui/dialog";
import { ReasonDialog } from "./components/shared";
import { api, publicApi, resolveCompanionApiOrigin } from "./lib/api";
import { dateTimeLocalValue, readPagination } from "./lib/pagination";
import { canAccessExamBuilder, canDecideIncidents, canEditOrganization, canExportReports, canManageCandidates, canManageExams } from "./lib/permissions";
import "./index.css";
import "./register-pwa";
type Session = {
  token: string;
  user: { name: string; email: string };
  organization: { id: string; name: string };
  role: string;
};
import { ExamBuilder } from "./exam-builder";
import { EvidenceCenter } from "./evidence-center";
import { AssistantPanel } from "./assistant";
import { NotificationBell } from "./notifications";
import { OperationsPage } from "./operations";
import { AnalyticsPanel } from "./analytics";
import { SubmissionsPage } from "./grading";
import { PeoplePage } from "./people";
import { StudentInvitationPage } from "./student-invitation";
import { SupportPage } from "./support";
import { SystemAdminPage } from "./system-admin";
import { AuditPage } from "./audit";
import { CandidateDashboard } from "./candidate-dashboard";
// Kept exported from here: existing tests and callers import it from "./main".
export { CandidateDashboard };
import { AccountPage } from "./account";
import { StaffOverview } from "./staff-dashboard";
import { CompanionStatus } from "./companion-status";
import { ExamTimer, QuestionPalette, SubmitReviewDialog, SyncIndicator } from "./exam-ui";
import { QuestionTypeRenderer, type ExamQuestionType } from "./question-renderer";
import { AnswerSync, pendingStore, type SyncSnapshot } from "./lib/answer-sync";
import { createSubmitter } from "./lib/submit-flow";
import { clockOffsetMs, isAnswered, loadMarks, progress as examProgress, remainingMs, saveMarks, serverAlignedNow } from "./lib/exam-state";
import { PendingWrites } from "./lib/pending-writes";
import { pairCompanionAttempt } from "./lib/companion-pairing";
import {
  browserCompatibility,
  cameraStreamHasLiveTrack,
  cameraStreamIsActive,
  checkCompanionBridge,
  companionBridgeAuthorization,
  createReadinessCheck,
  fullDisplayStreamIsActive,
  microphoneStreamIsActive,
  requestCameraStream,
  requestFullDisplayStream,
  requestMicrophoneStream,
  type ReadinessCheck,
} from "./lib/exam-readiness";
const queryClient = new QueryClient();

const nav = [
  { label: "Overview", icon: LayoutDashboard, path: "/app" },
  { label: "Examinations", icon: BookOpen, path: "/app/exams" },
  { label: "Candidates", icon: Users, path: "/app/candidates" },
  { label: "Incident review", icon: AlertTriangle, path: "/app/incidents" },
  { label: "Evidence Center", icon: FileSearch, path: "/app/evidence" },
  { label: "Results & reports", icon: BarChart3, path: "/app/reports" },
  { label: "People & roles", icon: UserCog, path: "/app/people" },
  { label: "Audit log", icon: ScrollText, path: "/app/audit" },
  { label: "Operations", icon: Gauge, path: "/app/operations" },
  { label: "Help & support", icon: LifeBuoy, path: "/app/support" },
  { label: "Organization settings", icon: Settings, path: "/app/settings" },
];
function useSession() {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const raw = sessionStorage.getItem("sentinel-session");
      return raw ? JSON.parse(raw) as Session : null;
    } catch {
      try { sessionStorage.removeItem("sentinel-session"); } catch { /* Storage is unavailable; start signed out. */ }
      return null;
    }
  });
  const save = useCallback((nextSession: Session) => {
    queryClient.clear();
    sessionStorage.setItem("sentinel-session", JSON.stringify(nextSession));
    setSession(nextSession);
  }, []);
  const clear = useCallback(() => {
    try { sessionStorage.removeItem("sentinel-session"); } catch { /* Always clear in-memory identity/cache even if storage is blocked. */ }
    queryClient.clear();
    setSession(null);
  }, []);
  return { session, save, clear };
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{label}</p>
    </div>
  );
}
const countries = [
  ["IN", "India"],
  ["US", "United States"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["GB", "United Kingdom"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["AE", "United Arab Emirates"],
  ["SG", "Singapore"],
  ["ZA", "South Africa"],
];
export function StudentEntry() {
  const navigate = useNavigate();
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [regions, setRegions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false);
  const [request, setRequest] = useState(false);
  const selectCountry = async (code: string) => {
    setCountry(code);
    setRegion("");
    setResults([]);
    setError("");
    setNotice("");
    setDirectoryUnavailable(false);
    if (!code) return setRegions([]);
    try {
      const { data } = await publicApi.get(
        `/api/public/institutions/regions?countryCode=${code}`,
      );
      setRegions(data.regions);
    } catch {
      setRegions([]);
    }
  };
  const find = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const selected = countries.find((c) => c[0] === country);
    if (!selected) return setError("Choose a country first.");
    if (search.trim().length < 2)
      return setError("Enter at least two characters of the institution name.");
    setLoading(true);
    setError("");
    setNotice("");
    setResults([]);
    setDirectoryUnavailable(false);
    try {
      const { data } = await publicApi.get("/api/public/institutions/search", {
        params: { country: selected[1], name: search },
      });
      setResults(data.results);
      if (!data.results.length)
        setNotice("No public directory match was returned. Try the full official name, or request a review below.");
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const message = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
      setDirectoryUnavailable(status === 503);
      setError(message ?? "We could not search the public directory. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };
  const submitRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!country || search.trim().length < 2) {
      setError("Choose a country and enter the institution name before submitting a review request.");
      return;
    }
    try {
      const email = String(new FormData(e.currentTarget).get("email") || "");
      const { data } = await publicApi.post("/api/public/institution-requests", {
        name: search,
        countryCode: country,
        region: region || undefined,
        requesterEmail: email,
      });
      setError("");
      setNotice(`Review request submitted. Reference: ${data.reference}`);
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.error
          : "Unable to submit request.",
      );
    }
  };
  return (
    <main className="app-surface min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 font-bold text-slate-950"
        >
          <span className="rounded-lg bg-blue-600 p-2 text-white">
            <ShieldCheck size={18} />
          </span>
          ExamGuard
        </button>
        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <section className="card p-5 sm:p-8">
          <div className="border-b border-slate-100 pb-6">
          <p className="eyebrow">Candidate access</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Find your institution</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Directory listings are public-source matches, not proof that your
            membership or institution is verified.
          </p>
          </div>
          <form onSubmit={find} className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Country
              <select
                className="input mt-1"
                value={country}
                onChange={(e) => selectCountry(e.target.value)}
                required
              >
                <option value="">Select country</option>
                {countries.map(([code, name]) => (
                  <option value={code} key={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {regions.length > 0 && (
              <label className="text-sm font-medium">
                State / province / region
                <select
                  className="input mt-1"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option value="">All regions</option>
                  {regions.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm font-medium sm:col-span-2">
              Institution / college name
              <input
                className="input mt-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                minLength={2}
                required
                placeholder="For example: Graphic Era University"
              />
            </label>
            <button disabled={loading} className="button gap-2 sm:w-fit">
              {loading ? "Searching…" : "Search directory"}
            </button>
          </form>
          {error && (
            <p
              role="alert"
              className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              <b>{directoryUnavailable ? "Public directory is temporarily unavailable." : "Search needs attention."}</b><br />
              {error}
            </p>
          )}
          {notice && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
          <div className="mt-6 space-y-3">
            {results.map((x) => (
              <article
                key={`${x.name}-${x.website}`}
                className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-200 hover:shadow-sm"
              >
                <h2 className="font-medium">{x.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {x.country}
                  {x.website && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        className="text-blue-700 underline"
                        href={x.website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Website
                      </a>
                    </>
                  )}
                </p>
                <button
                  onClick={() => navigate("/student/login")}
                  className="mt-3 text-sm font-semibold text-blue-700"
                >
                  Continue to sign in
                </button>
              </article>
            ))}
          </div>
            <button
            onClick={() => setRequest(!request)}
              className="mt-7 text-sm font-semibold text-blue-700 hover:text-blue-800"
          >
            Can’t find your institution?
          </button>
          {request && (
            <form
              onSubmit={submitRequest}
              className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              <p className="text-sm text-slate-600">
                Submit a review request. It does not create or verify an
                institution automatically.
              </p>
              <label className="mt-3 block text-sm font-medium">
                Your email
                <input
                  name="email"
                  type="email"
                  className="input mt-1"
                  required
                />
              </label>
              <button className="button mt-3">Submit review request</button>
            </form>
          )}
        </section>
        <aside className="space-y-4">
          <section className="card bg-slate-950 p-6 text-white"><p className="text-sm font-semibold">Already have an ExamGuard account?</p><p className="mt-2 text-sm leading-6 text-slate-300">Your college does not need to appear in this public search to access an assessment that has been assigned to you.</p><button type="button" onClick={() => navigate("/student/login")} className="mt-5 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-blue-50">Student sign in</button></section>
          <section className="card p-6"><h2 className="font-semibold text-slate-900">Search tips</h2><ul className="mt-3 space-y-3 text-sm leading-5 text-slate-600"><li>Use the complete official college or university name.</li><li>Choose a state to keep your review request accurate.</li><li>If search is unavailable, retry later or ask your institute for the assessment link.</li></ul></section>
        </aside>
        </div>
      </div>
    </main>
  );
}
function Auth({
  register,
  onSave,
}: {
  register?: boolean;
  onSave: (s: Session) => void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const { data } = await publicApi.post(
        register ? "/api/auth/register" : "/api/auth/login",
        {
          name: form.name,
          email: form.email,
          password: form.password,
          organizationName: form.organizationName,
        },
      );
      onSave(data);
      navigate("/app");
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.error ?? "Unable to continue")
          : "Unable to continue",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto mt-12 max-w-md">
        <button
          onClick={() => navigate("/")}
          className="mb-10 flex items-center gap-2 font-bold text-ink"
        >
          <span className="rounded-lg bg-blue-600 p-2 text-white">
            <ShieldCheck size={18} />
          </span>
          ExamGuard
        </button>
        <div className="card shadow-glow">
          <h1 className="text-2xl font-semibold">
            {register ? "Set up your organization" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {register
              ? "Start with a secure workspace for your institute."
              : "Sign in to your examination workspace."}
          </p>
          <form onSubmit={submit} className="mt-7 space-y-4">
            {register && (
              <>
                <label className="block text-sm font-medium">
                  Your name
                  <input name="name" required className="input mt-1" />
                </label>
                <label className="block text-sm font-medium">
                  Organization
                  <input
                    name="organizationName"
                    required
                    className="input mt-1"
                  />
                </label>
              </>
            )}
            <label className="block text-sm font-medium">
              Work email
              <input
                name="email"
                type="email"
                required
                className="input mt-1"
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                name="password"
                type="password"
                minLength={register ? 10 : 1}
                required
                className="input mt-1"
              />
            </label>
            {error && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <button disabled={loading} className="button w-full">
              {loading
                ? "Please wait…"
                : register
                  ? "Create secure workspace"
                  : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
function Shell({ session, clear }: { session: Session; clear: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [highContrast, setHighContrast] = useState(() => {
    try { return window.localStorage.getItem("examguard-high-contrast") === "true"; } catch { return false; }
  });
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceNav = session.role === "student"
    ? [{ label: "My assessments", icon: BookOpen, path: "/app" }, { label: "Help & support", icon: LifeBuoy, path: "/app/support" }, { label: "Account", icon: UserCog, path: "/app/account" }]
    : session.role === "platform_admin"
      ? [{ label: "System administration", icon: ShieldCheck, path: "/app" }, { label: "Help & support", icon: LifeBuoy, path: "/app/support" }, { label: "Account", icon: CircleUser, path: "/app/account" }]
      : ["institute_admin", "teacher", "proctor"].includes(session.role)
      ? [...nav.filter((item) => (canEditOrganization(session.role) || item.path !== "/app/settings") && (session.role === "institute_admin" || !["/app/operations", "/app/people", "/app/audit"].includes(item.path))), { label: "Account", icon: CircleUser, path: "/app/account" }]
      : [];
  const activeItem = workspaceNav.find((item) =>
    item.path === "/app"
      ? location.pathname === "/app" || location.pathname === "/app/"
      : location.pathname.startsWith(item.path),
  );
  const pageTitle = session.role === "student" && location.pathname.startsWith("/app/exams")
    ? "My assessments"
    : activeItem?.label ?? (location.pathname.includes("/take/") ? "Assessment workspace" : "Workspace");
  const go = (path: string) => {
    navigate(path);
    setMobileNavOpen(false);
  };
  useEffect(() => {
    document.documentElement.dataset.contrast = highContrast ? "high" : "standard";
    try { window.localStorage.setItem("examguard-high-contrast", String(highContrast)); } catch { /* The preference remains active for this session when storage is unavailable. */ }
  }, [highContrast]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const sidebar = sidebarRef.current;
    const focusable = sidebar?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      mobileMenuButtonRef.current?.focus();
    };
  }, [mobileNavOpen]);
  return (
    <div className={`eg-shell ${session.role === "student" ? "eg-shell-candidate" : ""} ${sidebarCollapsed ? "eg-sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
      {mobileNavOpen && <button className="eg-mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside ref={sidebarRef} className={`eg-sidebar ${mobileNavOpen ? "eg-sidebar-open" : ""}`} aria-label="Primary navigation" role={mobileNavOpen ? "dialog" : undefined} aria-modal={mobileNavOpen ? true : undefined}>
        <button type="button" className="eg-brand" onClick={() => go("/app")} aria-label="ExamGuard home">
          <span className="eg-brand-mark"><ShieldCheck size={19} strokeWidth={2.2} /></span>
          <span className="eg-brand-copy">examguard<span>ASSESSMENT OPERATIONS</span></span>
        </button>
        <div className="eg-org-switcher">
          <span className="eg-org-avatar">{session.organization.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1"><b>{session.organization.name}</b><small>{session.role.replaceAll("_", " ")}</small></span>
        </div>
        <p className="eg-nav-label">WORKSPACE</p>
        <nav className="eg-nav" aria-label="Workspace navigation">
          {workspaceNav.map((item) => {
            const Icon = item.icon;
            const active = item.path === "/app"
              ? location.pathname === "/app" || location.pathname === "/app/" || (session.role === "student" && location.pathname.startsWith("/app/exams"))
              : location.pathname.startsWith(item.path);
            return (
              <button key={item.path} type="button" onClick={() => go(item.path)}
                className={`eg-nav-item ${active ? "eg-nav-item-active" : ""}`}
                title={sidebarCollapsed ? item.label : undefined}
                aria-label={sidebarCollapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
                {active && <span className="eg-nav-indicator" />}
              </button>
            );
          })}
        </nav>
        <div className="eg-sidebar-bottom">
          <div className="eg-security-card">
            <span className="eg-security-icon"><ShieldCheck size={17}/></span>
            <b>Integrity by design</b>
            <p>Signals support human review. They never make misconduct decisions automatically.</p>
          </div>
          <button type="button" className="eg-profile" onClick={() => { clear(); navigate("/login"); }}>
            <span className="eg-profile-avatar">{session.user.name.split(" ").map((part) => part[0]).slice(0,2).join("").toUpperCase()}</span>
            <span className="min-w-0 flex-1"><b>{session.user.name}</b><small>Sign out of workspace</small></span>
            <LogOut size={16}/>
          </button>
        </div>
      </aside>
      <div className="eg-main-column">
        <header className="eg-topbar">
          {session.role === "platform_admin" && <button type="button" className="eg-desktop-sidebar-toggle" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={sidebarCollapsed} onClick={() => setSidebarCollapsed(value => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>}
          <button ref={mobileMenuButtonRef} type="button" className="eg-mobile-menu" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>
            {mobileNavOpen ? <X size={20}/> : <Menu size={20}/>}
          </button>
          <div className="eg-breadcrumb"><span>Workspace</span><ChevronRight size={14}/><b>{pageTitle}</b></div>
          <div className="eg-topbar-actions">
            <span className="eg-environment"><i/> SECURE WORKSPACE</span>
            <button type="button" className="button-secondary min-h-9 px-2 py-1 text-xs" aria-pressed={highContrast} onClick={() => setHighContrast(value => !value)}>{highContrast ? "Standard contrast" : "High contrast"}</button>
            <NotificationBell />
            <details className="eg-account-menu">
              <summary className="eg-user-chip" aria-label="Open account menu">
                <span>{session.user.name.split(" ")[0]}</span>
                <span className="eg-user-dot">{session.user.name.slice(0,1).toUpperCase()}</span>
              </summary>
              <div className="eg-account-popover">
                <b>{session.user.name}</b>
                <span>{session.user.email}</span>
                <small>{session.role.replaceAll("_", " ")}</small>
                <button type="button" onClick={() => { clear(); navigate("/login"); }}>Sign out</button>
              </div>
            </details>
          </div>
        </header>
        <main id="workspace-content" tabIndex={-1} className="eg-content">
          <div className="eg-page-intro">
            <div><p className="eg-overline">{session.organization.name}</p><h1>{pageTitle}</h1><p className="eg-page-subtitle">{session.role === "student" ? "Your secure assessment space." : "A clear view of your examination operations."}</p></div>
            <div className="eg-live-status"><span/> Signed-in workspace</div>
          </div>
          <Routes>
            <Route index element={session.role === "platform_admin" ? <SystemAdminPage /> : <Dashboard session={session} />} />
            <Route path="exams/:examId/submissions" element={["institute_admin", "teacher"].includes(session.role) ? <SubmissionsPage session={session} /> : <Navigate to="/app" replace />} />
            <Route path="exams" element={session.role === "student" ? <CandidateDashboard session={session} /> : <Exams session={session} />} />
            <Route path="candidates" element={<Candidates session={session} />} />
            <Route path="monitoring" element={<Navigate to="/app" replace />} />
            <Route path="incidents" element={<Incidents session={session} />} />
            <Route path="evidence" element={(["institute_admin", "teacher", "proctor"].includes(session.role)) ? <EvidenceCenter session={session} /> : <Navigate to="/app" replace />} />
            <Route path="reports" element={<Reports session={session} />} />
            <Route path="account" element={<AccountPage session={session} onSignOut={() => { clear(); navigate("/login", { replace: true }); }} />} />
            <Route path="support" element={<SupportPage session={session} />} />
            <Route path="people" element={session.role === "institute_admin" ? <PeoplePage session={session} /> : <Navigate to="/app" replace />} />
            <Route path="audit" element={session.role === "institute_admin" ? <AuditPage organizationId={session.organization.id} /> : <Navigate to="/app" replace />} />
            <Route path="operations" element={session.role === "institute_admin" ? <OperationsPage organizationId={session.organization.id} /> : <Navigate to="/app" replace />} />
            <Route path="settings" element={canEditOrganization(session.role) ? <OrganizationSettings session={session} /> : <Navigate to="/app" replace />} />
            <Route path="*" element={<Navigate to="/app" />} />
          </Routes>
        </main>
        <AssistantPanel organizationId={session.organization.id} role={session.role} />
        <footer className="eg-footer"><span>EXAMGUARD · SECURE ASSESSMENT OPERATIONS</span><span>Human-led review · Privacy-aware monitoring</span></footer>
      </div>
    </div>
  );
}
export function ReadinessChecks({ onStart, error, fullscreenRequired, organizationId, examId }: { onStart: () => void; error: string; fullscreenRequired: boolean; organizationId: string; examId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const meterFrame = useRef<number | null>(null);
  const [camera, setCamera] = useState("Not checked");
  const [microphone, setMicrophone] = useState("Not checked");
  const [level, setLevel] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [practiceAnswer, setPracticeAnswer] = useState("");
  const practiceCompleted = practiceAnswer === "blue";
  const [screen, setScreen] = useState("Not enabled");
  const screenStream = useRef<MediaStream | null>(null);
  const [companionStatus, setCompanionStatus] = useState("Use the Check Companion button to request local-network access and verify the bridge.");
  const [companionReady, setCompanionReady] = useState(false);
  const [aiStatus, setAiStatus] = useState("Checking AI proctoring service…");
  const [aiReady, setAiReady] = useState(false);
  const [evidenceStorageReady, setEvidenceStorageReady] = useState(false);
  const [evidenceStorageStatus, setEvidenceStorageStatus] = useState("Checking private evidence storage…");
  const [monitoringConsent, setMonitoringConsent] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== "undefined" && navigator.onLine);
  const [serverChecks, setServerChecks] = useState<ReadinessCheck[]>([]);
  const [lastChecked, setLastChecked] = useState<Record<string, string>>({});
  const [startError, setStartError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const browserCheck = useMemo(() => browserCompatibility(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
    typeof window !== "undefined" && window.isSecureContext,
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia,
  ), []);
  const markChecked = (id: string) => setLastChecked(existing => ({ ...existing, [id]: new Date().toISOString() }));
  const checkLocalCompanion = async () => {
    setCompanionStatus("Connecting to the local Windows Companion…");
    const companion = await checkCompanionBridge();
    setCompanionReady(companion.status === "ready");
    setCompanionStatus(companion.explanation);
    markChecked(companion.id);
  };
  const stopCamera = () => {
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    delete (window as any).__examguardCameraStream;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera("Not checked");
    markChecked("camera");
  };
  const stopMicrophone = () => {
    if (meterFrame.current) cancelAnimationFrame(meterFrame.current);
    meterFrame.current = null;
    audioContext.current?.close().catch(() => undefined);
    audioContext.current = null;
    microphoneStream.current?.getTracks().forEach((track) => track.stop());
    microphoneStream.current = null;
    setLevel(0);
    setMicrophone("Not checked");
    markChecked("microphone");
  };
  const stopScreen = () => {
    screenStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current = null;
    delete (window as any).__examguardScreenStream;
    setScreen("Not enabled");
    markChecked("screen_sharing");
  };
  useEffect(() => () => {
    // StudentExam owns camera and display streams across the readiness-to-exam handoff.
    microphoneStream.current?.getTracks().forEach(track => track.stop());
    audioContext.current?.close().catch(() => undefined);
  }, []);
  useEffect(() => {
    const online = () => setOnline(true);
    const offline = () => setOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);
  useEffect(() => {
    let active = true;
    const checkServices = async () => {
      try {
        const response = await api.get(`/api/student/organizations/${organizationId}/exams/${examId}/readiness`, { timeout: 7000 });
        if (!active) return;
        const checks = Array.isArray(response.data?.checks) ? response.data.checks as ReadinessCheck[] : [];
        setServerChecks(checks);
        const aiCheck = checks.find(check => check.id === "ai_service");
        setAiReady(aiCheck?.status === "ready");
        setAiStatus(aiCheck?.explanation ?? "The server did not return an AI readiness result.");
        const storageCheck = checks.find(check => check.id === "evidence_storage");
        const storageReady = storageCheck?.status === "ready";
        setEvidenceStorageReady(storageReady);
        setEvidenceStorageStatus(storageCheck?.explanation ?? "The server did not return an evidence storage readiness result.");
        for (const check of checks) markChecked(check.id);
      } catch (serviceError) {
        if (!active) return;
        const checks = axios.isAxiosError(serviceError) && Array.isArray(serviceError.response?.data?.checks)
          ? serviceError.response.data.checks as ReadinessCheck[]
          : [];
        setServerChecks(checks);
        const aiCheck = checks.find(check => check.id === "ai_service");
        const storageCheck = checks.find(check => check.id === "evidence_storage");
        setAiReady(false);
        setAiStatus(aiCheck?.explanation ?? (axios.isAxiosError(serviceError) ? serviceError.response?.data?.error : undefined) ?? "The server-side readiness check is unavailable.");
        setEvidenceStorageReady(false);
        setEvidenceStorageStatus(storageCheck?.explanation ?? "The server could not verify private evidence storage.");
        for (const check of checks) markChecked(check.id);
      }
    };
    void checkServices();
    const interval = window.setInterval(() => void checkServices(), 10_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [organizationId, examId, refreshKey]);
  const checkCamera = async () => {
    const existingTrack = cameraStream.current?.getVideoTracks().find(track => track.readyState === "live" && track.enabled);
    if (cameraStreamHasLiveTrack(cameraStream.current) && existingTrack && cameraStream.current) {
      if (videoRef.current) videoRef.current.srcObject = cameraStream.current;
      setCamera(existingTrack.muted ? "Camera track is paused — wait for it to resume or reconnect it." : "Camera ready");
      markChecked("camera");
      return;
    }
    stopCamera();
    setCamera("Checking camera access…");
    try {
      const stream = await requestCameraStream(navigator.mediaDevices ?? null);
      cameraStream.current = stream;
      (window as any).__examguardCameraStream = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamera("Camera ready");
      stream.getVideoTracks().forEach(track => {
        track.addEventListener("ended", () => {
          setCamera("Camera disconnected — reconnect the camera and retry.");
          markChecked("camera");
        });
        track.addEventListener("mute", () => {
          setCamera("Camera track is paused — reconnect it and retry.");
          markChecked("camera");
        });
        track.addEventListener("unmute", () => {
          setCamera(cameraStreamIsActive(stream) ? "Camera ready" : "Camera is not active — reconnect it and retry.");
          markChecked("camera");
        });
      });
    } catch (e) {
      setCamera(e instanceof Error ? e.message : "Camera access could not be verified.");
    } finally {
      markChecked("camera");
    }
  };
  const enableScreen = async () => {
    stopScreen();
    setScreen("Requesting display permission…");
    try {
      const stream = await requestFullDisplayStream(navigator.mediaDevices ?? null);
      const track = stream.getVideoTracks()[0];
      screenStream.current = stream;
      (window as any).__examguardScreenStream = stream;
      track.addEventListener("ended", () => {
        screenStream.current = null;
        delete (window as any).__examguardScreenStream;
        setScreen("Full-display sharing stopped — enable it again before starting.");
        markChecked("screen_sharing");
      }, { once: true });
      track.addEventListener("mute", () => {
        setScreen("Full-display sharing is paused — enable it again before starting.");
        markChecked("screen_sharing");
      }, { once: true });
      track.addEventListener("unmute", () => {
        setScreen(fullDisplayStreamIsActive(stream)
          ? "Full display selected — periodic still capture ready"
          : "The shared surface is no longer the full display — select Entire screen / Monitor again.");
        markChecked("screen_sharing");
      }, { once: true });
      setScreen("Full display selected — periodic still capture ready");
    } catch (e) {
      setScreen(e instanceof Error ? e.message : "Screen sharing could not be verified.");
    } finally {
      markChecked("screen_sharing");
    }
  };
  const checkMicrophone = async () => {
    stopMicrophone();
    setMicrophone("Checking microphone access…");
    try {
      const stream = await requestMicrophoneStream(navigator.mediaDevices ?? null);
      microphoneStream.current = stream;
      stream.getAudioTracks().forEach(track => {
        track.addEventListener("ended", () => {
          setMicrophone("Microphone disconnected — reconnect it and retry.");
          markChecked("microphone");
        }, { once: true });
        track.addEventListener("mute", () => {
          setMicrophone("Microphone track is paused — reconnect it and retry.");
          markChecked("microphone");
        }, { once: true });
        track.addEventListener("unmute", () => {
          setMicrophone(microphoneStreamIsActive(stream) ? "Microphone ready — audio is not recorded or sent." : "Microphone is not active — reconnect it and retry.");
          markChecked("microphone");
        }, { once: true });
      });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      audioContext.current = context;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteTimeDomainData(data);
        const average = data.reduce((sum, value) => sum + Math.abs(value - 128), 0) / data.length;
        setLevel(Math.min(100, Math.round(average * 4)));
        meterFrame.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
      setMicrophone("Microphone ready — audio is not recorded or sent.");
    } catch (e) {
      setMicrophone(e instanceof Error ? e.message : "Microphone access could not be verified.");
    } finally {
      markChecked("microphone");
    }
  };
  const localCheck = (id: string, value: string, readyText: string, remediation: string): ReadinessCheck => {
    const ready = value.startsWith(readyText);
    const pending = value === "Not checked" || value.startsWith("Checking") || value.startsWith("Requesting");
    return createReadinessCheck(
      id,
      ready ? "ready" : pending ? "pending" : value.includes("unavailable") ? "unavailable" : "failed",
      value,
      ready ? "No action needed." : remediation,
      lastChecked[id] ? new Date(lastChecked[id]) : new Date(),
    );
  };
  const serverCheck = (id: string, fallback: ReadinessCheck) => serverChecks.find(check => check.id === id) ?? fallback;
  const companionCheck = createReadinessCheck(
    "windows_companion",
    companionReady ? "ready" : "unavailable",
    companionStatus,
    companionReady ? "No action needed." : "Install and register the Windows Companion from your institution's trusted installer, then open it and retry.",
    lastChecked.windows_companion ? new Date(lastChecked.windows_companion) : new Date(),
  );
  const checks: ReadinessCheck[] = [
    serverCheck("exam_assignment", createReadinessCheck("exam_assignment", "pending", "Checking your assignment.", "Retry the server check.")),
    serverCheck("exam_window", createReadinessCheck("exam_window", "pending", "Checking the examination window.", "Retry the server check.")),
    browserCheck,
    localCheck("camera", camera, "Camera ready", "Allow camera access and connect a working camera, then retry."),
    localCheck("microphone", microphone, "Microphone ready", "Allow microphone access and connect a working microphone, then retry."),
    createReadinessCheck(
      "screen_sharing",
      fullDisplayStreamIsActive(screenStream.current) ? "ready" : screen === "Not enabled" ? "pending" : screen.includes("unavailable") ? "unavailable" : "failed",
      fullDisplayStreamIsActive(screenStream.current) ? "Full display is actively shared." : screen,
      "Start sharing again and select Entire screen / Monitor. Keep the browser's sharing indicator active.",
      lastChecked.screen_sharing ? new Date(lastChecked.screen_sharing) : new Date(),
    ),
    companionCheck,
    serverCheck("ai_service", createReadinessCheck("ai_service", "pending", aiStatus, "Retry the authenticated AI service check.")),
    serverCheck("evidence_storage", createReadinessCheck("evidence_storage", "pending", evidenceStorageStatus, "Retry the private storage check.")),
    createReadinessCheck("network", online ? "ready" : "failed", online ? "The browser reports an active network connection." : "The browser is offline.", "Reconnect to the internet before starting."),
    createReadinessCheck("instructions", acknowledged ? "ready" : "pending", acknowledged ? "Examination instructions acknowledged." : "Read and acknowledge the examination instructions.", "Review the exam instructions and select the acknowledgement."),
    createReadinessCheck("practice", practiceCompleted ? "ready" : "pending", practiceCompleted ? "Practice readiness exercise acknowledged." : "Complete the short practice readiness exercise.", "Complete the practice check before starting."),
    createReadinessCheck("monitoring_consent", monitoringConsent ? "ready" : "pending", monitoringConsent ? "Monitoring consent recorded for this browser session." : "Explicit consent is required before starting.", "Read the monitoring notice and consent only if you agree."),
  ];
  const mandatoryChecks = checks.filter(check => check.mandatory);
  const readyCount = mandatoryChecks.filter(check => check.status === "ready").length;
  const readinessPercent = Math.round(readyCount / mandatoryChecks.length * 100);
  const allReady = readyCount === mandatoryChecks.length;
  const checkTone = (status: ReadinessCheck["status"]) => status === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : status === "pending"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : status === "failed"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-slate-200 bg-slate-50 text-slate-600";
  const checkLabel = (status: ReadinessCheck["status"]) => status === "ready" ? "Ready" : status === "pending" ? "Pending" : status === "failed" ? "Failed" : "Unavailable";
  const checkName: Record<string, string> = {
    exam_assignment: "Exam assignment",
    exam_window: "Exam availability",
    browser: "Browser compatibility",
    camera: "Camera",
    microphone: "Microphone",
    screen_sharing: "Full-display sharing",
    windows_companion: "Windows Companion",
    ai_service: "AI proctoring",
    evidence_storage: "Private evidence storage",
    network: "Network connection",
    instructions: "Exam instructions",
    practice: "Practice check",
    monitoring_consent: "Monitoring consent",
  };
  const checkButton = (id: string) => id === "camera" ? <div className="mt-3 flex gap-3"><button type="button" onClick={() => void checkCamera()} className="text-sm font-semibold text-blue-700 underline">Check camera</button><button type="button" onClick={stopCamera} className="text-sm text-slate-600 underline">Stop preview</button></div>
    : id === "microphone" ? <div className="mt-3 flex gap-3"><button type="button" onClick={() => void checkMicrophone()} className="text-sm font-semibold text-blue-700 underline">Check microphone</button><button type="button" onClick={stopMicrophone} className="text-sm text-slate-600 underline">Stop test</button></div>
      : id === "screen_sharing" ? <button type="button" onClick={() => void enableScreen()} className="mt-3 text-sm font-semibold text-blue-700 underline">Share / retry display</button>
        : id === "windows_companion" ? <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={() => void checkLocalCompanion()} className="text-sm font-semibold text-blue-700 underline">{companionReady ? "Check Companion again" : "Connect / check Companion"}</button>
          <a className="text-sm font-semibold text-blue-700 underline" href="examguard-companion://start" target="_blank" rel="noreferrer">Open Windows Companion</a>
        </div>
          : id === "ai_service" || id === "evidence_storage" || id === "exam_assignment" || id === "exam_window" ? <button type="button" onClick={() => setRefreshKey(value => value + 1)} className="mt-3 text-sm font-semibold text-blue-700 underline">Retry server checks</button>
            : null;
  return <div className="card w-full max-w-5xl">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-blue-700">Before you begin</p><h2 className="mt-2 text-2xl font-semibold">Examination readiness</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Each status reflects a browser permission check, a live device test, or a server-verified service. A green check is not inferred from configuration alone.</p></div>
      <div className="min-w-40 rounded-xl border border-slate-200 bg-white px-4 py-3 text-right"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall readiness</p><p className="mt-1 text-2xl font-bold text-slate-900">{readinessPercent}%</p><p className="text-xs text-slate-500">{readyCount} of {mandatoryChecks.length} required checks</p></div>
    </div>
    <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Mandatory readiness checks" aria-valuenow={readinessPercent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${readinessPercent}%` }} /></div>
    <ol className="mt-5 grid gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-700 sm:grid-cols-2">
      <li>Use a current browser on the secure ExamGuard website and a supported Windows computer.</li>
      <li>Allow camera and microphone access, then select <b>Entire screen</b> or <b>Monitor</b> when sharing.</li>
      <li>Install and open the institution-provided Companion; keep its window running through submission.</li>
      <li>Review the notice and explicitly consent only if you agree. Fullscreen is {fullscreenRequired ? "required" : "not required"}.</li>
    </ol>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {checks.map(check => <section key={check.id} className={`rounded-xl border p-4 ${checkTone(check.status)}`} aria-label={`${checkName[check.id]}: ${checkLabel(check.status)}`}>
        <div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{checkName[check.id]}</h3><span className="rounded-full bg-white/80 px-2 py-1 text-xs font-semibold">{checkLabel(check.status)}</span></div>
        <p className="mt-2 text-sm leading-5">{check.explanation}</p>
        {check.status !== "ready" && <p className="mt-2 text-xs leading-5 opacity-80">{check.remediation}</p>}
        <p className="mt-3 text-[11px] opacity-70">Required · Checked {new Date(check.lastCheckedAt).toLocaleTimeString()}</p>
        {check.id === "camera" && <video ref={videoRef} autoPlay muted playsInline className="mt-3 aspect-video w-full rounded-lg bg-slate-200 object-cover" aria-label="Live camera preview" />}
        {check.id === "microphone" && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80"><div className="h-full bg-emerald-600 transition-[width]" style={{ width: `${level}%` }} /></div>}
        {checkButton(check.id)}
      </section>)}
    </div>
    <label className="mt-5 flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6"><input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.target.checked); markChecked("instructions"); }} /><span><b>Instructions reviewed.</b> I understand the examination rules and how to submit.</span></label>
    <fieldset className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6">
      <legend className="px-1 font-semibold">Practice answer check</legend>
      <p>To verify the answer controls, select <b>Blue</b> for this practice question. This does not submit exam answers.</p>
      <div className="mt-2 flex flex-wrap gap-4">
        {["Blue", "Green", "Red"].map(option => <label key={option} className="flex items-center gap-2"><input type="radio" name="readiness-practice-answer" value={option.toLowerCase()} checked={practiceAnswer === option.toLowerCase()} onChange={event => { setPracticeAnswer(event.target.value); markChecked("practice"); }} />{option}</label>)}
      </div>
      <p role="status" className="mt-2 text-xs text-slate-600">{practiceCompleted ? "Practice interaction completed." : "Select the requested answer to complete this check."}</p>
    </fieldset>
    <label className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><input type="checkbox" className="mt-1" checked={monitoringConsent} onChange={event => { setMonitoringConsent(event.target.checked); markChecked("monitoring_consent"); }} /><span><b>Monitoring consent required.</b> I consent to periodic camera-frame AI analysis, full-display still images, and Bluetooth/Wi-Fi access-point observations from the Windows Companion. This is not continuous video. Camera frames are analyzed every six seconds and are not retained by default; a frame is stored privately only when the existing 3-of-5 rule confirms a review signal. Full-display stills and linked incident context are also retained under my institution's published schedule. Automated signals are not proof of misconduct. Audio is not recorded or uploaded. I can stop sharing or withdraw consent, but monitoring will be interrupted. A normal browser cannot prevent switching to other applications.</span></label>
    <p className="mt-3 text-xs leading-5 text-slate-500">Browser camera, microphone, and screen capture are user-controlled. The server independently rechecks examination eligibility, authenticated AI availability, and private storage before creating an attempt; it does not trust browser claims about local hardware.</p>
    {(error || startError) && <p role="alert" className="mt-4 text-sm text-red-700">{startError || error}</p>}
    <button type="button" onClick={async () => {
      setStartError("");
      if (!cameraStreamIsActive(cameraStream.current)) { setCamera("Camera is not active. Reconnect and retry before starting."); markChecked("camera"); return; }
      if (!microphoneStreamIsActive(microphoneStream.current)) { setMicrophone("Microphone is not active. Reconnect and retry before starting."); markChecked("microphone"); return; }
      if (!fullDisplayStreamIsActive(screenStream.current)) { setScreen("Full-display sharing is not active. Enable it again before starting."); markChecked("screen_sharing"); return; }
      if (fullscreenRequired) {
        try { await document.documentElement.requestFullscreen(); }
        catch { setStartError("Fullscreen could not be enabled. Use a supported browser and allow fullscreen before starting."); return; }
        if (!document.fullscreenElement) { setStartError("Fullscreen could not be enabled. Use a supported browser and allow fullscreen before starting."); return; }
      }
      onStart();
    }} disabled={!allReady || !cameraStreamIsActive(cameraStream.current) || !microphoneStreamIsActive(microphoneStream.current) || !fullDisplayStreamIsActive(screenStream.current)} className="button mt-6 disabled:cursor-not-allowed disabled:opacity-50">Start secure exam</button>
  </div>;
}
function FullscreenLock({ onRestore }: { onRestore: () => void }) {
  return <div role="alertdialog" aria-modal="true" aria-labelledby="fullscreen-lock-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-6">
    <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
      <ShieldCheck className="mx-auto text-amber-600" size={32} />
      <h2 id="fullscreen-lock-title" className="mt-4 text-xl font-semibold">Return to exam fullscreen</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">This exam requires fullscreen. The exam screen is blocked until you return to fullscreen. Your organizer can help if your browser will not restore it.</p>
      <button type="button" className="button mt-5" onClick={onRestore}>Return to fullscreen</button>
      <p className="mt-3 text-xs leading-5 text-slate-500">Fullscreen detects leaving this page; it cannot prevent switching to other apps. Managed kiosk devices are required for enforced lockdown.</p>
    </div>
  </div>;
}
function StudentExam({ session }: { session: Session }) {
  const { examId = "" } = useParams();
  const location = useLocation();
  const [fullscreenRequired, setFullscreenRequired] = useState(location.state?.fullscreenRequired !== false);
  const [fullscreenLost, setFullscreenLost] = useState(false);
  const [payload, setPayload] = useState<any>();
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [completionStatus, setCompletionStatus] = useState<"submitted" | "expired">("submitted");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [current, setCurrent] = useState(0);
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [syncSnap, setSyncSnap] = useState<SyncSnapshot>({ phase: "saved", pending: 0, lastSavedAt: null, failures: 0 });
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const clockOffset = useRef(0);
  const sync = useRef<AnswerSync | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [pairingLoading, setPairingLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("Starting AI monitoring…");
  const [cameraStatus, setCameraStatus] = useState("Waiting for camera handoff.");
  const [cameraStreamVersion, setCameraStreamVersion] = useState(0);
  const [attentionWarning, setAttentionWarning] = useState("");
  const [singleWindowBlocked, setSingleWindowBlocked] = useState(false);
  const [singleWindowMessage, setSingleWindowMessage] = useState("");
  const [lockAttemptId, setLockAttemptId] = useState<string | null>(null);
  const [codingRunner, setCodingRunner] = useState({ available: false, unavailableReason: "Checking the isolated code runner…", history: [] as Array<{ id: string; kind: "run" | "submit"; status: string; createdAt: string }> });
  const pendingAttemptRef = useRef<{ organizationId: string; examId: string; candidateId: string; attemptId: string } | null>(null);
  const pendingProctorWrites = useRef(new PendingWrites());
  const submissionInProgress = useRef(false);
  const lockWaiters = useRef(new Map<string, (acquired: boolean) => void>());
  const startingAttempt = useRef(false);
  const contextBuffer = useRef<Array<{ capturedAt: number; blob: Blob }>>([]);
  const contextUploadEvents = useRef(new Set<string>());
  const recentSignalEvidence = useRef<{ evidenceKey: string; capturedAt: number } | null>(null);
  const serverNow = () => serverAlignedNow(Date.now(), clockOffset.current);
  const trackProctoringWrite = (work: Promise<unknown>) => pendingProctorWrites.current.track(work);
  const codingPersistence = useMemo(() => ({
    available: Boolean(payload?.attempt?.id),
    save: async ({ questionId, sourceCode }: { questionId: string; languageId: string; sourceCode: string }) => {
      if (!payload?.attempt?.id) throw new Error("The active attempt is unavailable.");
      await api.put(`/api/student/attempts/${payload.attempt.id}/answers/${questionId}`, { value: sourceCode });
      setAnswers(current => ({ ...current, [questionId]: sourceCode }));
    },
  }), [payload?.attempt?.id]);
  useEffect(() => {
    const activeAttemptId = payload?.attempt?.id;
    if (!activeAttemptId || !payload.questions?.some((question: any) => question.type === "coding")) return;
    let active = true;
    api.get(`/api/student/attempts/${activeAttemptId}/coding-executions`)
      .then(({ data }) => {
        if (!active) return;
        setCodingRunner({
          available: data.available === true,
          unavailableReason: data.unavailableReason ?? "",
          history: Array.isArray(data.history) ? data.history : [],
        });
      })
      .catch((error) => {
        if (!active) return;
        const message = axios.isAxiosError(error) ? error.response?.data?.error : undefined;
        setCodingRunner({ available: false, unavailableReason: message ?? "Could not check the isolated code runner. Contact your exam organizer.", history: [] });
      });
    return () => { active = false; };
  }, [payload?.attempt?.id, payload?.questions]);
  const runCodingExecution = useCallback(async (kind: "run" | "submit", input: { questionId: string; languageId: string; sourceCode: string }): Promise<CodingExecutionResult> => {
    const activeAttemptId = payload?.attempt?.id;
    if (!activeAttemptId) throw new Error("The active attempt is unavailable.");
    try {
      const { data } = await api.post<CodingExecutionResult & { submissionId: string; createdAt: string }>(
        `/api/student/attempts/${activeAttemptId}/coding-executions/${kind}`,
        input,
        { timeout: 110_000 },
      );
      setCodingRunner(current => ({
        ...current,
        history: [{ id: data.submissionId, kind, status: data.status, createdAt: data.createdAt }, ...current.history].slice(0, 20),
      }));
      return data;
    } catch (error) {
      const message = axios.isAxiosError(error) ? error.response?.data?.error : undefined;
      throw new Error(message ?? "The secure code execution request failed. Check your connection and retry.");
    }
  }, [payload?.attempt?.id]);
  const codingExecution = useMemo(() => payload?.attempt?.id ? ({
    available: codingRunner.available,
    unavailableReason: codingRunner.unavailableReason,
    run: (input: { questionId: string; languageId: string; sourceCode: string }) => runCodingExecution("run", input),
    submit: (input: { questionId: string; languageId: string; sourceCode: string }) => runCodingExecution("submit", input),
    history: codingRunner.history,
  }) : undefined, [payload?.attempt?.id, codingRunner, runCodingExecution]);
  useEffect(() => () => {
    const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
    stream?.getTracks().forEach((track) => track.stop());
    delete (window as any).__examguardCameraStream;
    const screenStream = (window as any).__examguardScreenStream as MediaStream | undefined;
    screenStream?.getTracks().forEach((track) => track.stop());
    delete (window as any).__examguardScreenStream;
  }, []);
  const captureStreamFrame = async (stream: MediaStream | undefined, maxWidth: number, quality: number) => {
    if (!stream?.active || !stream.getVideoTracks().some(track => track.readyState === "live" && track.enabled && !track.muted)) return null;
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    try {
      await video.play();
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      return blob && blob.size > 0 ? blob : null;
    } finally {
      video.pause();
      video.srcObject = null;
    }
  };
  const captureFrameBlob = async () => {
    const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
    return captureStreamFrame(stream, 1280, 0.72);
  };
  const uploadContextFrame = async (eventId: string, contextType: "before" | "after", sequence: number, capturedAt: number, blob: Blob) => {
    const form = new FormData();
    form.append("frame", blob, `ai-context-${contextType}-${sequence}.jpg`);
    form.append("parentEventId", eventId);
    form.append("contextType", contextType);
    form.append("sequence", String(sequence));
    form.append("capturedAt", new Date(capturedAt).toISOString());
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await api.post(`/api/student/attempts/${payload!.attempt.id}/ai-context-frame`, form, { timeout: 16_000 });
        return;
      } catch (error) {
        lastError = error;
        const retryable = !axios.isAxiosError(error) || !error.response || error.response.status >= 500;
        if (!retryable || attempt > 0) throw error;
      }
    }
    throw lastError;
  };
  const captureIncidentContext = async (eventId: string, occurredAt: string) => {
    if (contextUploadEvents.current.has(eventId)) return;
    contextUploadEvents.current.add(eventId);
    const incidentAt = Date.parse(occurredAt);
    const afterFrames: Array<{ sequence: number; capturedAt: number; blob: Blob }> = [];
    for (let sequence = 0; sequence < 5; sequence += 1) {
      if (sequence > 0) await new Promise(resolve => window.setTimeout(resolve, 700));
      try {
        const blob = await captureFrameBlob();
        if (!blob) throw new Error("No camera frame was available.");
        const capturedAt = serverNow();
        if (!Number.isFinite(incidentAt) || capturedAt < incidentAt || capturedAt > incidentAt + 5_000) {
          setAttentionWarning("The incident context window expired before another camera frame could be saved.");
          break;
        }
        afterFrames.push({ sequence, capturedAt, blob });
      } catch {
        setAttentionWarning("Some camera images around the review signal could not be captured.");
        break;
      }
    }
    const before = contextBuffer.current
      .filter(frame => frame.capturedAt <= incidentAt && frame.capturedAt >= incidentAt - 5_000)
      .slice(-5);
    let savedBeforeFrames = 0;
    for (const [sequence, frame] of before.entries()) {
      try {
        await uploadContextFrame(eventId, "before", sequence, frame.capturedAt, frame.blob);
        savedBeforeFrames += 1;
      } catch {
        setAttentionWarning("Some camera images from just before the review signal could not be saved.");
        break;
      }
    }
    if (!savedBeforeFrames) {
      contextUploadEvents.current.delete(eventId);
      setAttentionWarning("A before-context camera frame was unavailable; after-context frames were not saved.");
      return;
    }
    for (const frame of afterFrames) {
      try { await uploadContextFrame(eventId, "after", frame.sequence, frame.capturedAt, frame.blob); }
      catch { setAttentionWarning("Some camera images around the review signal could not be saved."); break; }
    }
  };
  const captureScreenBlob = async () => {
    const stream = (window as any).__examguardScreenStream as MediaStream | undefined;
    if (!fullDisplayStreamIsActive(stream)) return null;
    return captureStreamFrame(stream, 1600, 0.65);
  };
  const captureEvidence = async () => {
    const now = serverNow();
    const recentFrame = [...contextBuffer.current].reverse().find((frame) => now - frame.capturedAt <= 5_000);
    const blob = recentFrame?.blob ?? await captureFrameBlob();
    if (!blob) throw new Error("No recent camera frame was available.");
    const form = new FormData();
    form.append("file", blob, "browser-signal.jpg");
    form.append("source", "camera");
    const { data } = await api.post(`/api/student/attempts/${payload.attempt.id}/evidence`, form, { timeout: 16_000 });
    if (typeof data.evidenceKey !== "string" || !data.evidenceKey) {
      throw new Error("The evidence service did not return a saved image reference.");
    }
    return data.evidenceKey as string;
  };
  const start = async () => {
    if (startingAttempt.current) return;
    startingAttempt.current = true;
    try {
      const startUrl = `/api/student/organizations/${session.organization.id}/exams/${examId}/start`;
      const startBody = { monitoringConsentAccepted: true, monitoringConsentVersion: "examguard-monitoring-v2" };
      let response = await api.post(startUrl, startBody);
      let data = response.data;
      const attemptId = data?.attempt?.id;
      if (!attemptId) throw new Error("The server did not return an active attempt. Retry or contact your exam organizer.");
      if (typeof data.attempt.organizationId !== "string") throw new Error("The server did not return the attempt organization. Retry or contact your exam organizer.");
      const requiredFullscreen = data.exam?.fullscreenRequired !== false;
      setFullscreenRequired(requiredFullscreen);
      pendingAttemptRef.current = {
        organizationId: data.attempt.organizationId,
        examId: data.attempt.examId,
        candidateId: data.attempt.candidateId,
        attemptId,
      };
      if (lockAttemptId !== attemptId) {
        const acquiredLock = new Promise<boolean>((resolve) => lockWaiters.current.set(attemptId, resolve));
        setLockAttemptId(attemptId);
        const acquired = await acquiredLock;
        lockWaiters.current.delete(attemptId);
        if (!acquired) {
          setLockAttemptId(null);
          pendingAttemptRef.current = null;
          throw new Error("This exam is already open in another browser tab or window. Close the other exam tab and retry here.");
        }
      }
      // Always renew a fresh attempt-scoped credential and complete the local
      // handshake before asking the API to release any exam questions.
      const connected = await createCompanionPairing(attemptId);
      if (!connected) throw new Error("The required Windows Companion could not connect. Open the Companion and retry; the exam questions remain locked until it reports successfully.");
      response = await api.post(startUrl, startBody);
      data = response.data;
      if (data.companionRequired || !Array.isArray(data.questions)) throw new Error("The Windows Companion has not confirmed its first heartbeat yet. Retry the automatic connection.");
      if (data.attempt.organizationId !== pendingAttemptRef.current?.organizationId) throw new Error("The attempt organization changed while starting. Retry or contact your exam organizer.");
      // Align the countdown with the server clock so a wrong device clock cannot add or remove time.
      clockOffset.current = clockOffsetMs(response.headers?.date as string | undefined, Date.now());
      pendingAttemptRef.current = {
        organizationId: data.attempt.organizationId,
        examId: data.attempt.examId,
        candidateId: data.attempt.candidateId,
        attemptId: data.attempt.id,
      };
      setLockAttemptId(data.attempt.id);
      const cameraStream = (window as any).__examguardCameraStream as MediaStream | undefined;
      setCameraStatus(cameraStreamIsActive(cameraStream) ? "Camera active" : "Camera unavailable. Reconnect it to continue monitoring.");
      setCameraStreamVersion(version => version + 1);
      setPayload(data);
      setFullscreenLost(requiredFullscreen && !document.fullscreenElement);
      setAnswers(Object.fromEntries(data.answers.map((answer: any) => [String(answer.questionId), answer.value])));
      setMarked(loadMarks(typeof sessionStorage === "undefined" ? undefined : sessionStorage, data.attempt.id));
      setLeft(remainingMs(data.attempt.deadlineAt, Date.now(), clockOffset.current));
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 500) {
        const requestId = e.response.data?.requestId;
        setError(`The exam server could not start this attempt. Your attempt may be resumable; retry once. If it still fails, contact your organizer${requestId ? ` and share reference ${requestId}` : ""}.`);
      } else {
        setError(
          axios.isAxiosError(e)
            ? e.response?.data?.error ?? "Unable to start exam"
            : e instanceof Error ? e.message : "Unable to start exam",
        );
      }
    } finally {
      startingAttempt.current = false;
    }
  };
  const reconnectCamera = async () => {
    if (!payload?.attempt?.id || receipt) return;
    setCameraStatus("Requesting camera access…");
    try {
      const stream = await requestCameraStream(navigator.mediaDevices ?? null);
      const previous = (window as any).__examguardCameraStream as MediaStream | undefined;
      if (previous && previous !== stream) previous.getTracks().forEach(track => track.stop());
      (window as any).__examguardCameraStream = stream;
      setCameraStreamVersion(version => version + 1);
      setCameraStatus("Camera active");
      setAiStatus("Camera reconnected. Waiting for the next confirmed frame analysis.");
    } catch (reconnectError) {
      const message = reconnectError instanceof Error ? reconnectError.message : "Camera access could not be restored.";
      setCameraStatus(`Camera unavailable: ${message}`);
      setAiStatus("Camera recovery failed. Allow camera access in browser settings, close other camera apps, then retry.");
    }
  };
  useEffect(() => {
    if (!payload) return;
    const id = setInterval(
      () => setLeft(remainingMs(payload.attempt.deadlineAt, Date.now(), clockOffset.current)),
      1000,
    );
    return () => clearInterval(id);
  }, [payload]);
  // Answer synchronisation: ordered, retried, flushed before submission. See lib/answer-sync.ts.
  const attemptId: string | undefined = payload?.attempt?.id;
  useEffect(() => {
    if (!attemptId) return;
    const engine = new AnswerSync({
      save: async (questionId, value) => { await api.put(`/api/student/attempts/${attemptId}/answers/${questionId}`, { value }); },
      isClosedError: (error) => axios.isAxiosError(error) && (error.response?.status === 409 || error.response?.status === 404),
      onChange: setSyncSnap,
      debounceMs: 700,
      persist: pendingStore(typeof sessionStorage === "undefined" ? undefined : sessionStorage, attemptId),
    });
    sync.current = engine;
    // Answers that were unsent when this page was last left (offline, reload, expired session) are shown again and re-sent.
    const restored = engine.restore();
    if (Object.keys(restored).length) setAnswers((existing) => ({ ...existing, ...restored }));
    const goOnline = () => { setOnline(true); engine.retryNow(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline); window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); engine.dispose(); if (sync.current === engine) sync.current = null; };
  }, [attemptId]);
  useEffect(() => { if (attemptId) saveMarks(typeof sessionStorage === "undefined" ? undefined : sessionStorage, attemptId, marked); }, [attemptId, marked]);
  useEffect(() => {
    if (!payload) return;
    let hiddenAt: number | null = null;
    let blurredAt: number | null = null;
    const reportBrowserSignal = (
      type: "visibility_hidden" | "window_blur" | "focus_regain" | "multiple_window_hint" | "fullscreen_exit",
      message: string,
      details: Record<string, unknown> = {},
    ) => {
      if (submissionInProgress.current) return;
      const occurredAt = new Date(serverNow());
      setAttentionWarning(message);
      void trackProctoringWrite((async () => {
        let evidenceKey: string | undefined;
        if (type !== "multiple_window_hint") {
          try {
            const previousEvidence = recentSignalEvidence.current;
            evidenceKey = previousEvidence && serverNow() - previousEvidence.capturedAt <= 5_000
              ? previousEvidence.evidenceKey
              : await captureEvidence();
            recentSignalEvidence.current = { evidenceKey, capturedAt: serverNow() };
          } catch (captureError) {
            const reason = captureError instanceof Error ? captureError.message : "The camera image could not be saved.";
            setAttentionWarning(`${message} Camera evidence was unavailable: ${reason} The event will still be recorded.`);
          }
        }
        try {
          await api.post(`/api/organizations/${payload.attempt.organizationId}/proctoring/events`, {
            examId: payload.attempt.examId,
            candidateId: payload.attempt.candidateId,
            attemptId: payload.attempt.id,
            type,
            occurredAt: occurredAt.toISOString(),
            source: "browser",
            ...(evidenceKey ? { evidenceKey } : {}),
            details: { clientWarning: true, ...details },
          });
        } catch (recordError) {
          const reason = axios.isAxiosError(recordError)
            ? recordError.response?.data?.error ?? "The server could not save the review event."
            : "The server could not save the review event.";
          setAttentionWarning(`${message} The event could not be recorded: ${reason}`);
        }
      })());
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        reportBrowserSignal("visibility_hidden", "Warning: you left the examination tab. Return immediately and keep this exam in focus.");
      } else if (hiddenAt !== null) {
        const hiddenDurationMs = Date.now() - hiddenAt;
        hiddenAt = null;
        reportBrowserSignal("focus_regain", `Your examination tab was hidden for ${Math.ceil(hiddenDurationMs / 1000)} second(s). This was recorded for review; keep the exam tab active.`, { hiddenDurationMs });
      }
    };
    const fullscreen = () => {
      const exited = !document.fullscreenElement;
      setFullscreenLost(exited && payload.exam.fullscreenRequired === true);
      if (exited) reportBrowserSignal("fullscreen_exit", "Warning: fullscreen was exited. Return to fullscreen and remain on the examination screen.");
    };
    const blur = () => { blurredAt = Date.now(); reportBrowserSignal("window_blur", "Warning: the examination window lost focus. Return immediately."); };
    const focus = () => {
      if (blurredAt !== null) {
        const blurDurationMs = Date.now() - blurredAt;
        blurredAt = null;
        reportBrowserSignal("focus_regain", `The examination window lost focus for ${Math.ceil(blurDurationMs / 1000)} second(s). This was recorded for review; keep the exam window active.`, { blurDurationMs });
      }
    };
    const resize = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) reportBrowserSignal("multiple_window_hint", "Warning: another window may be open over the examination. Keep only the examination window visible.");
    };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "Your examination is still in progress."; };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", fullscreen);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    window.addEventListener("resize", resize);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", fullscreen);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      window.removeEventListener("resize", resize);
      window.removeEventListener("beforeunload", unload);
    };
  }, [payload]);
  useEffect(() => {
    const activeAttempt = pendingAttemptRef.current;
    const activeAttemptId = lockAttemptId;
    if (!activeAttemptId || receipt) return;
    const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lockKey = "examguard:active-exam-window";
    let stopped = false;
    let reported = false;
    let retryTimer: number | null = null;
    let releaseWebLock: (() => void) | null = null;
    let waiterSettled = false;
    const settleWaiter = (acquired: boolean) => {
      if (waiterSettled) return;
      waiterSettled = true;
      const resolve = lockWaiters.current.get(activeAttemptId);
      if (resolve) {
        lockWaiters.current.delete(activeAttemptId);
        resolve(acquired);
      }
    };
    const isFresh = (value: string | null) => {
      if (!value) return false;
      try {
        const lock = JSON.parse(value) as { owner?: string; heartbeat?: number };
        return lock.owner !== owner && typeof lock.heartbeat === "number" && Date.now() - lock.heartbeat < 4_000;
      } catch {
        return false;
      }
    };
    const block = (message = "Another ExamGuard examination is already active in this browser profile. Close it and return here to continue.") => {
      if (stopped) return;
      setSingleWindowBlocked(true);
      setSingleWindowMessage(message);
      if (!reported && activeAttempt) {
        reported = true;
        if (!submissionInProgress.current) void trackProctoringWrite(api.post(`/api/organizations/${activeAttempt.organizationId}/proctoring/events`, {
          examId: activeAttempt.examId,
          candidateId: activeAttempt.candidateId,
          attemptId: activeAttemptId,
          type: "multiple_window_hint",
          occurredAt: new Date().toISOString(),
          source: "browser",
          details: { clientWarning: true, enforcement: "single_window_lock" },
        })).catch(() => undefined);
      }
    };
    const lockManager = (navigator as any).locks;
    if (lockManager?.request) {
      const held = new Promise<void>((resolve) => { releaseWebLock = resolve; });
      const requestLock = () => {
        void lockManager.request(lockKey, { mode: "exclusive", ifAvailable: true }, async (lock: unknown) => {
          if (stopped) return;
          if (!lock) {
            block();
            settleWaiter(false);
            retryTimer = window.setTimeout(requestLock, 1000);
            return;
          }
          setSingleWindowBlocked(false);
          setSingleWindowMessage("");
          settleWaiter(true);
          await held;
        }).catch(() => {
          if (stopped) return;
          block("This browser could not establish the exam tab lock. Use a supported browser with site storage enabled, then retry.");
          settleWaiter(false);
        });
      };
      requestLock();
      return () => {
        stopped = true;
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        releaseWebLock?.();
        settleWaiter(false);
      };
    }

    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("examguard:active-exam-window");
    const heartbeat = () => {
      try {
        const current = localStorage.getItem(lockKey);
        if (isFresh(current)) {
          block();
          settleWaiter(false);
          return;
        }
        setSingleWindowBlocked(false);
        setSingleWindowMessage("");
        localStorage.setItem(lockKey, JSON.stringify({ owner, heartbeat: Date.now() }));
        channel?.postMessage({ type: "window_present", owner });
        settleWaiter(true);
      } catch {
        block("Browser storage is unavailable, so ExamGuard cannot safely hold the single-tab lock. Enable site storage and retry.");
        settleWaiter(false);
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === lockKey && isFresh(event.newValue)) block();
    };
    const message = (event: MessageEvent<{ type?: string; owner?: string }>) => {
      if (event.data?.owner !== owner && event.data?.type === "window_present") block();
    };
    window.addEventListener("storage", storage);
    channel?.addEventListener("message", message);
    heartbeat();
    channel?.postMessage({ type: "window_present", owner });
    const interval = window.setInterval(heartbeat, 1_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      settleWaiter(false);
      window.removeEventListener("storage", storage);
      channel?.removeEventListener("message", message);
      channel?.close();
      try {
        const current = JSON.parse(localStorage.getItem(lockKey) ?? "null") as { owner?: string } | null;
        if (current?.owner === owner) localStorage.removeItem(lockKey);
      } catch {
        // A malformed lock is harmless and will expire on its own.
      }
    };
  }, [lockAttemptId, receipt]);
  const save = async (questionId: string, value: unknown) => {
    if (singleWindowBlocked) return;
    // Keep what the candidate typed on screen immediately; the engine saves it (latest value only, in order, with retries).
    setAnswers((existing) => ({ ...existing, [questionId]: value }));
    setError("");
    sync.current?.set(questionId, value, { immediate: typeof value !== "string" });
  };
  const resumeScreenSharing = async () => {
    try {
      const stream = await requestFullDisplayStream(navigator.mediaDevices ?? null);
      const track = stream.getVideoTracks()[0];
      (window as any).__examguardScreenStream = stream;
      track.addEventListener("ended", () => {
        setAttentionWarning("Full-display sharing stopped. Screen evidence is no longer being captured; tell your exam organizer if this was accidental.");
        if (!submissionInProgress.current) void trackProctoringWrite(api.post(`/api/organizations/${payload.attempt.organizationId}/proctoring/events`, {
          examId: payload.attempt.examId,
          candidateId: payload.attempt.candidateId,
          attemptId: payload.attempt.id,
          type: "screen_sharing_stopped",
          occurredAt: new Date().toISOString(),
          source: "browser",
          details: { clientWarning: true, displaySurface: "monitor" },
        })).catch(() => undefined);
      }, { once: true });
      setAttentionWarning("Full-display sharing is active again.");
    } catch (resumeError) {
      setAttentionWarning(resumeError instanceof Error ? resumeError.message : "Full-display sharing could not be restarted.");
    }
  };
  const submitter = useRef<ReturnType<typeof createSubmitter> | null>(null);
  const submit = async (automatic = false) => {
    if (!payload || singleWindowBlocked || submissionInProgress.current) return;
    const activeScreen = fullDisplayStreamIsActive((window as any).__examguardScreenStream as MediaStream | undefined);
    if (!activeScreen) {
      setAttentionWarning("Full-display sharing is not active. Resume sharing before you submit.");
      if (!automatic) return;
    }
    submitter.current ??= createSubmitter({
      flush: async () => (await sync.current?.flush()) ?? true,
      post: async () => {
        await pendingProctorWrites.current.flush();
        const result = (await api.post(`/api/student/attempts/${payload.attempt.id}/submit`)).data;
        // Submission is authoritative on the server; stop local radio scanning
        // immediately afterwards. This bridge endpoint is loopback + origin restricted.
        void fetch("http://127.0.0.1:43117/stop", {
          method: "POST",
          headers: companionBridgeAuthorization(),
          cache: "no-store",
          signal: AbortSignal.timeout(1500),
        }).catch(() => undefined);
        return result;
      },
      interpretError: (e) => { const body = axios.isAxiosError(e) ? e.response?.data : undefined; return { receiptCode: body?.receiptCode, message: body?.error }; },
    });
    submissionInProgress.current = true;
    setError(""); setSubmitBusy(true);
    const outcome = await submitter.current.run(automatic);
    setSubmitBusy(false);
    if (outcome.kind === "submitted" || outcome.kind === "expired" || outcome.kind === "already_submitted") {
      sync.current?.clearPersisted();
      setCompletionStatus(outcome.kind === "expired" ? "expired" : "submitted"); setReceipt(outcome.receipt); setReviewing(false);
      setLockAttemptId(null);
      pendingAttemptRef.current = null;
      const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
      stream?.getTracks().forEach((track) => track.stop());
      delete (window as any).__examguardCameraStream;
      const screenStream = (window as any).__examguardScreenStream as MediaStream | undefined;
      screenStream?.getTracks().forEach((track) => track.stop());
      delete (window as any).__examguardScreenStream;
    } else if (outcome.kind === "blocked_unsaved") {
      submissionInProgress.current = false;
      setError("Some answers couldn't be saved yet. Check your connection and try again. Nothing has been lost.");
    } else if (outcome.kind === "error") {
      submissionInProgress.current = false;
      setError(outcome.message);
    }
  };
  const createCompanionPairing = async (attemptId = payload?.attempt?.id): Promise<boolean> => {
    if (!attemptId) return false;
    setPairingError("");
    setPairingLoading(true);
    try {
      await pairCompanionAttempt(
        attemptId,
        resolveCompanionApiOrigin(),
        async activeAttemptId => (await api.post(`/api/student/attempts/${activeAttemptId}/companion-pairing`)).data,
      );
      setPairingError("");
      return true;
    } catch (requestError) {
      const message = axios.isAxiosError(requestError)
        ? requestError.response?.data?.error ?? "Could not authenticate the Companion for this attempt."
        : requestError instanceof Error ? requestError.message : "Could not connect the Windows Companion.";
      setPairingError(message);
      return false;
    } finally {
      setPairingLoading(false);
    }
  };
  useEffect(() => {
    if (!payload?.attempt?.id || receipt) return;
    // Refresh the short-lived Companion credential before its 10-minute expiry.
    const renewal = window.setInterval(() => { void createCompanionPairing(payload.attempt.id); }, 8 * 60_000);
    return () => window.clearInterval(renewal);
  }, [payload?.attempt?.id, receipt]);
  useEffect(() => {
    const activeAttemptId = payload?.attempt?.id;
    if (!activeAttemptId || receipt) return;
    let stopped = false;
    let sending = false;
    let resumeAfterCurrent = false;
    const analyzeFrame = async () => {
      if (stopped || submissionInProgress.current || document.visibilityState !== "visible") return;
      if (sending) return;
      sending = true;
      try {
        const blob = await captureFrameBlob();
        if (stopped) return;
        if (!blob) {
          setAiStatus("No non-empty camera frame is available; frame analysis will retry.");
          return;
        }
        const form = new FormData();
        form.append("frame", blob, "camera-frame.jpg");
        const response = await api.post<{
          analysis: {
            face_count: number;
            multiple_faces: boolean;
            phone_detection: "detected" | "not_detected" | "unavailable";
            phone_confidence?: number | null;
          };
          recorded?: Array<{ type?: string; eventId?: string; occurredAt?: string }>;
          evidenceAttached?: boolean;
        }>(`/api/student/attempts/${activeAttemptId}/ai-frame`, form, { timeout: 16_000 });
        clockOffset.current = clockOffsetMs(response.headers?.date as string | undefined, Date.now());
        if (!response.data.analysis) throw new Error("The AI service did not confirm frame analysis.");
        for (const signal of response.data.recorded ?? []) {
          if (signal.eventId && signal.occurredAt) {
            void trackProctoringWrite(captureIncidentContext(signal.eventId, signal.occurredAt)).catch(() => undefined);
          }
        }
        const evidenceStatus = response.data.evidenceAttached
          ? "confirmed incident image saved"
          : "no incident image retained for this frame";
        if (!stopped && import.meta.env.DEV) {
          const { face_count, multiple_faces, phone_detection, phone_confidence } = response.data.analysis;
          const confidence = typeof phone_confidence === "number" ? ` ${phone_confidence.toFixed(2)}` : "";
          const recorded = response.data.recorded?.map((signal) => signal.type).filter(Boolean).join(", ") || "none";
          setAiStatus(`AI analysis confirmed: ${face_count} faces; multiple ${multiple_faces ? "yes" : "no"}; phone ${phone_detection}${confidence}; event ${recorded}; ${evidenceStatus}.`);
        } else if (!stopped) {
          setAiStatus(`AI frame analysis confirmed; ${evidenceStatus}.`);
        }
      } catch (analysisError) {
        if (!stopped) {
          const message = axios.isAxiosError(analysisError) ? analysisError.response?.data?.error : undefined;
          setAiStatus(`Camera frame analysis or upload failed: ${message ?? (analysisError instanceof Error ? analysisError.message : "check the connection and retry")}`);
        }
      } finally {
        sending = false;
        if (resumeAfterCurrent) {
          resumeAfterCurrent = false;
          if (!stopped && document.visibilityState === "visible") runAnalysis();
        }
      }
    };
    const runAnalysis = () => {
      if (submissionInProgress.current) return;
      void trackProctoringWrite(analyzeFrame()).catch(() => undefined);
    };
    const analyzeWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (sending) {
        resumeAfterCurrent = true;
        setAiStatus("Exam tab is active again; waiting for the current frame request before resuming.");
        return;
      }
      runAnalysis();
    };
    const interval = window.setInterval(runAnalysis, 6000);
    document.addEventListener("visibilitychange", analyzeWhenVisible);
    runAnalysis();
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", analyzeWhenVisible);
      resumeAfterCurrent = false;
    };
  }, [payload?.attempt?.id, receipt, cameraStreamVersion]);
  useEffect(() => {
    const activeAttemptId = payload?.attempt?.id;
    if (!activeAttemptId || receipt) {
      contextBuffer.current = [];
      return;
    }
    let stopped = false;
    let captureInFlight = false;
    const capture = async () => {
      if (stopped || captureInFlight || document.visibilityState !== "visible") return;
      captureInFlight = true;
      try {
        const blob = await captureFrameBlob();
        if (!blob || stopped) return;
        const capturedAt = serverNow();
        contextBuffer.current = [...contextBuffer.current, { capturedAt, blob }]
          .filter(frame => frame.capturedAt >= capturedAt - 5_000)
          .slice(-6);
      } catch { /* Camera failures are reported by the monitoring request. */ }
      finally { captureInFlight = false; }
    };
    void capture();
    const interval = window.setInterval(() => void capture(), 1_000);
    document.addEventListener("visibilitychange", capture);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", capture);
      contextBuffer.current = [];
      contextUploadEvents.current.clear();
    };
  }, [payload?.attempt?.id, receipt, cameraStreamVersion]);
  useEffect(() => {
    const activeAttemptId = payload?.attempt?.id;
    if (!activeAttemptId || receipt) return;
    let stopped = false;
    let captureInFlight = false;
    const capture = async () => {
      if (stopped || captureInFlight || document.visibilityState !== "visible") return;
      captureInFlight = true;
      try {
        const blob = await captureScreenBlob();
        if (stopped) return;
        if (!blob) {
          setAttentionWarning("A full-display still could not be captured. Keep screen sharing enabled and tell your organizer if this continues.");
          return;
        }
        const form = new FormData();
        form.append("file", blob, "full-display-still.jpg");
        form.append("capturedAt", new Date().toISOString());
        form.append("displaySurface", "monitor");
        await api.post(`/api/student/attempts/${activeAttemptId}/screen-capture`, form, { timeout: 16_000 });
      } catch (captureError) {
        setAttentionWarning(axios.isAxiosError(captureError) && captureError.response?.data?.error
          ? `Full-display still could not be saved: ${captureError.response.data.error}`
          : "A full-display still could not be saved. Check your connection and keep screen sharing enabled.");
      } finally {
        captureInFlight = false;
      }
    };
    void capture();
    const interval = window.setInterval(() => void capture(), 15_000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [payload?.attempt?.id, receipt]);
  useEffect(() => {
    const activeAttemptId = payload?.attempt?.id;
    const stream = (window as any).__examguardScreenStream as MediaStream | undefined;
    const track = stream?.getVideoTracks()[0];
    if (!activeAttemptId || receipt || !track) return;
    const handleEnded = () => {
      setAttentionWarning("Full-display sharing stopped. Screen evidence is no longer being captured; tell your exam organizer if this was accidental.");
      if (!submissionInProgress.current) void trackProctoringWrite(api.post(`/api/organizations/${payload.attempt.organizationId}/proctoring/events`, {
        examId: payload.attempt.examId,
        candidateId: payload.attempt.candidateId,
        attemptId: activeAttemptId,
        type: "screen_sharing_stopped",
        occurredAt: new Date().toISOString(),
        source: "browser",
        details: { clientWarning: true, displaySurface: "monitor" },
      })).catch(() => undefined);
    };
    track.addEventListener("ended", handleEnded);
    return () => track.removeEventListener("ended", handleEnded);
  }, [payload?.attempt?.candidateId, payload?.attempt?.examId, payload?.attempt?.id, payload?.attempt?.organizationId, receipt]);
  useEffect(() => {
    const activeAttemptId = payload?.attempt?.id;
    const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
    if (!activeAttemptId || receipt || !stream) return;
    let active = true;
    let eventReported = false;
    const track = stream.getVideoTracks()[0];
    if (!track) {
      setCameraStatus("Camera unavailable. Reconnect it to continue monitoring.");
      return;
    }
    const updateStatus = () => {
      if (track.readyState !== "live" || !stream.active) {
        setCameraStatus("Camera disconnected. Reconnect it to continue monitoring.");
        setAiStatus("Camera is unavailable. Reconnect it; frame analysis cannot continue without an active camera.");
      } else if (track.muted) {
        setCameraStatus("Camera temporarily paused by the browser or device. Wait for it to resume or reconnect.");
        setAiStatus("Camera track is paused; frame analysis will resume when the camera is available.");
      } else if (!track.enabled) {
        setCameraStatus("Camera track is disabled. Reconnect it to continue monitoring.");
        setAiStatus("Camera track is disabled; frame analysis cannot continue until it is restored.");
      } else {
        setCameraStatus("Camera active");
      }
    };
    const reportEnded = () => {
      updateStatus();
      if (eventReported) return;
      eventReported = true;
      contextBuffer.current = [];
      contextUploadEvents.current.clear();
      if (!submissionInProgress.current) void trackProctoringWrite(api.post(`/api/organizations/${payload.attempt.organizationId}/proctoring/events`, {
        examId: payload.attempt.examId,
        candidateId: payload.attempt.candidateId,
        attemptId: activeAttemptId,
        type: "camera_permission_lost",
        occurredAt: new Date().toISOString(),
        source: "browser",
        details: {
          clientWarning: true,
          cameraState: "disconnected",
          trackKind: track.kind,
          reason: "media_track_ended",
        },
      })).catch((reportError) => {
        if (!active) return;
        const message = axios.isAxiosError(reportError) ? reportError.response?.data?.error : undefined;
        setCameraStatus(`Camera disconnected. Its status could not be recorded: ${message ?? "check the connection"}.`);
      });
    };
    const handleMute = () => updateStatus();
    const handleUnmute = () => updateStatus();
    const handleDeviceChange = () => updateStatus();
    track.addEventListener("ended", reportEnded);
    track.addEventListener("mute", handleMute);
    track.addEventListener("unmute", handleUnmute);
    stream.addEventListener("inactive", reportEnded);
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    updateStatus();
    return () => {
      active = false;
      track.removeEventListener("ended", reportEnded);
      track.removeEventListener("mute", handleMute);
      track.removeEventListener("unmute", handleUnmute);
      stream.removeEventListener("inactive", reportEnded);
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [payload?.attempt?.candidateId, payload?.attempt?.examId, payload?.attempt?.id, payload?.attempt?.organizationId, receipt, cameraStreamVersion]);
  useEffect(() => {
    if (payload && left === 0) void submit(true);
  }, [left, payload]);
  if (!payload) return <ReadinessChecks onStart={start} error={error} fullscreenRequired={fullscreenRequired} organizationId={session.organization.id} examId={examId} />;
  if (receipt)
    return (
      <div className="card max-w-xl text-center py-14">
        <ShieldCheck className="mx-auto text-emerald-600" />
        <h2 className="mt-4 text-xl font-semibold">{completionStatus === "expired" ? "Time expired" : "Submission received"}</h2>
        <p className="mt-2 text-slate-500">
          {payload.exam.isPractice
            ? completionStatus === "expired"
              ? "Your practice attempt was closed at the deadline. It is not graded or included in official reports."
              : `Your practice attempt was submitted. It is not graded or included in official reports. Receipt code: ${receipt}.`
            : completionStatus === "expired"
              ? "Your attempt was closed when the server deadline was reached."
              : "Your receipt code is "}<b>{payload.exam.isPractice || completionStatus === "expired" ? "" : receipt}</b>{payload.exam.isPractice || completionStatus === "expired" ? "" : "."}
        </p>
      </div>
    );
  const question = payload.questions[current];
  const answered = (id: string) => isAnswered(answers[id]);
  return (
    <div className="mx-auto max-w-6xl">
      <div className="card mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">{payload.exam.title} {payload.exam.isPractice && <Badge variant="outline">Practice · ungraded</Badge>}</h2>
          {payload.exam.isPractice && <p className="text-sm font-medium text-amber-800">Practice mode — this attempt is not graded or included in official reports.</p>}
          <p className="text-sm text-slate-500">{payload.exam.instructions}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4"><span className="text-xs font-semibold text-slate-600">{pairingLoading ? "Connecting Companion…" : "Companion required"}</span><CompanionStatus attemptId={payload.attempt.id} /><span className="text-xs font-semibold text-emerald-700">One active ExamGuard exam enforced</span><span className={`max-w-48 text-right text-xs ${cameraStatus === "Camera active" ? "text-emerald-700" : "text-amber-800"}`}>Browser camera: {cameraStatus}</span><span className="max-w-48 text-right text-xs text-slate-500">{aiStatus}</span><div className="flex flex-col items-end gap-1"><ExamTimer ms={left} /><SyncIndicator online={online} sync={syncSnap} /></div></div>
      </div>
      {error && !reviewing && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {cameraStatus !== "Camera active" && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span><b>Browser camera needs attention.</b> {cameraStatus} Allow camera access in browser site settings, close other apps using the camera, then reconnect. The Windows Companion status is shown separately.</span><button type="button" onClick={() => void reconnectCamera()} className="font-semibold underline">Reconnect camera</button></div>}
      {attentionWarning && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span><b>Attention required.</b> {attentionWarning}</span><div className="flex items-center gap-3">{!fullDisplayStreamIsActive((window as any).__examguardScreenStream as MediaStream | undefined) && <button type="button" onClick={() => void resumeScreenSharing()} className="font-semibold underline">Resume full-display sharing</button>}{!document.fullscreenElement && <button type="button" onClick={() => { void document.documentElement.requestFullscreen?.().catch(() => setAttentionWarning("Fullscreen could not be restored. Continue only after your organizer helps resolve the browser issue.")); }} className="font-semibold underline">Return to fullscreen</button>}<button type="button" onClick={() => setAttentionWarning("")} className="font-semibold">Dismiss</button></div></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_250px]">
        <section className="card">
          <div className="flex items-center justify-between gap-3"><p className="font-medium">Question {current + 1} of {payload.questions.length}</p><button type="button" onClick={() => setMarked((items) => ({ ...items, [question.id]: !items[question.id] }))} aria-pressed={Boolean(marked[question.id])} className="text-sm font-semibold text-blue-700">{marked[question.id] ? "Remove review mark" : "Mark for review"}</button></div>
          <p className="mt-5 text-lg font-medium">{question.prompt}</p>
          {question.type === "coding" ? (() => {
            const languageIds: string[] = question.coding?.languageIds ?? [];
            const initialCode = typeof answers[question.id] === "string"
              ? answers[question.id]
              : question.coding?.starterCode?.[languageIds[0]] ?? "";
            return <CodingExamWorkspace
              assessment={{ title: payload.exam.isPractice ? `${payload.exam.title} — Practice (ungraded)` : payload.exam.title, instructions: payload.exam.instructions, deadlineAt: payload.attempt.deadlineAt }}
              attemptId={payload.attempt.id}
              questions={[{
                id: question.id,
                title: question.coding?.title ?? "Coding problem",
                description: question.coding?.description ?? question.prompt,
                difficulty: question.coding?.difficulty ?? "medium",
                inputFormat: question.coding?.inputFormat,
                outputFormat: question.coding?.outputFormat,
                constraints: question.coding?.constraints,
                explanation: question.coding?.explanation,
                marks: question.marks,
                languageIds,
                starterCode: question.coding?.starterCode ?? {},
                samples: question.coding?.samples ?? [],
              }]}
              initialCodes={{ [question.id]: { languageId: languageIds[0] ?? "", sourceCode: initialCode } }}
              persistence={codingPersistence}
              execution={codingExecution}
              submissionError={error}
              clockOffsetMs={clockOffset.current}
            />;
          })() : <QuestionTypeRenderer
            mode="candidate"
            type={question.type as ExamQuestionType}
            groupId={question.id}
            options={question.options ?? []}
            value={answers[question.id]}
            label={`Answer for question ${current + 1}`}
            onChange={value => { void save(question.id, value); }}
            onBlur={() => void sync.current?.flush()}
          />}
          <div className="mt-7 flex justify-between"><button type="button" disabled={current === 0} onClick={() => setCurrent((value) => value - 1)} className="button disabled:opacity-50">Previous</button><button type="button" disabled={current === payload.questions.length - 1} onClick={() => setCurrent((value) => value + 1)} className="button disabled:opacity-50">Next</button></div>
        </section>
        <aside className="card h-fit" aria-label="Question navigation">
          <h3 className="mb-3 font-semibold">Questions</h3>
          <QuestionPalette questions={payload.questions} current={current} isAnswered={answered} isMarked={(id) => Boolean(marked[id])} onSelect={setCurrent} />
          <button type="button" onClick={() => setReviewing(true)} className="button mt-5 w-full">Review and submit</button>
        </aside>
      </div>
      <SubmitReviewDialog open={reviewing} onOpenChange={setReviewing} {...examProgress(payload.questions, answers, marked)} sync={syncSnap} online={online} busy={submitBusy} error={error} onJump={setCurrent} onConfirm={() => void submit()} />
      {pairingError && <p role="alert" className="mt-3 text-sm text-red-600">{pairingError}</p>}
      {fullscreenLost && <FullscreenLock onRestore={() => { void document.documentElement.requestFullscreen().catch(() => setAttentionWarning("Fullscreen could not be restored. Continue only after your organizer helps resolve the browser issue.")); }} />}
      {singleWindowBlocked && <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6">
        <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
          <ShieldCheck className="mx-auto text-red-600" size={32} />
          <h2 className="mt-4 text-xl font-semibold">Single exam-tab lock active</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{singleWindowMessage}</p>
          <p className="mt-3 text-xs leading-5 text-slate-500">Only one active ExamGuard exam is allowed in this browser profile. Browser security does not let a website close unrelated tabs or apps. The signal is for human review, not an automatic misconduct decision.</p>
        </div>
      </div>}
    </div>
  );
}
function Dashboard({ session }: { session: Session }) {
  if (session.role === "student") return <CandidateDashboard session={session} />;
  return <StaffOverview session={session} />;
}

export function Exams({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["exams", session.organization.id],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/exams`)
        .then((r) => r.data),
  });
  const canManage = canManageExams(session.role);
  const { data: candidates = [], isLoading: candidatesLoading, isError: candidatesError, refetch: refetchCandidates } = useQuery({
    queryKey: ["exam-assignment-candidates", session.organization.id],
    enabled: canManage,
    // This existing assignment picker previously received the entire candidate
    // array. Fetch every confirmed page so the new 50-row API default does not
    // silently make candidates beyond page one impossible to assign.
    queryFn: async () => {
      const first = await api.get(`/api/organizations/${session.organization.id}/candidates`, { params: { page: 1, pageSize: 100 } });
      const firstMeta = readPagination(first);
      if (!firstMeta || firstMeta.page !== 1 || firstMeta.pageSize !== 100) throw new Error("Candidate pagination headers are missing or inconsistent; refusing to show an incomplete assignment list.");
      const allCandidates = [...first.data as any[]];
      for (let nextPage = 2; nextPage <= firstMeta.totalPages; nextPage += 1) {
        const response = await api.get(`/api/organizations/${session.organization.id}/candidates`, { params: { page: nextPage, pageSize: 100 } });
        const metadata = readPagination(response);
        if (!metadata || metadata.page !== nextPage || metadata.pageSize !== firstMeta.pageSize || metadata.totalCount !== firstMeta.totalCount || metadata.totalPages !== firstMeta.totalPages) {
          throw new Error("Candidate records changed while loading the assignment list. Reload and try again.");
        }
        allCandidates.push(...response.data as any[]);
      }
      return allCandidates;
    },
  });
  const [assignmentExam, setAssignmentExam] = useState<any>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const [assigning, setAssigning] = useState(false);
  const openAssignment = (exam: any) => {
    if (!canManage) return;
    setAssignmentExam(exam);
    setSelectedCandidateIds([]);
    setAssignmentNotice("");
    setAssignmentError("");
  };
  const toggleCandidate = (candidateId: string) => setSelectedCandidateIds((current) => current.includes(candidateId) ? current.filter((id) => id !== candidateId) : [...current, candidateId]);
  const assignSelected = async () => {
    if (!assignmentExam || !selectedCandidateIds.length) {
      setAssignmentError("Select at least one student first.");
      return;
    }
    setAssigning(true);
    setAssignmentError("");
    try {
      const results = await Promise.allSettled(selectedCandidateIds.map((candidateId) => api.post(`/api/organizations/${session.organization.id}/exams/${assignmentExam.id}/assignments`, { candidateId })));
      const failedIds = selectedCandidateIds.filter((_, index) => results[index].status === "rejected");
      const assignedCount = selectedCandidateIds.length - failedIds.length;
      if (assignedCount) setAssignmentNotice(`${assignedCount} student${assignedCount === 1 ? "" : "s"} assigned successfully.`);
      if (failedIds.length) setAssignmentError(`${failedIds.length} assignment${failedIds.length === 1 ? "" : "s"} could not be saved. Review the remaining selection and retry.`);
      setSelectedCandidateIds(failedIds);
    } catch (error) {
      setAssignmentError(axios.isAxiosError(error) ? (error.response?.data?.error ?? "Could not save every assignment.") : "Could not save every assignment.");
    } finally {
      setAssigning(false);
    }
  };
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Examinations</h2>
          <p className="text-sm text-slate-500">
            Create, schedule, and supervise assessment delivery.
          </p>
        </div>
        {canManage && <button type="button" onClick={() => navigate("/app/exam-builder")} className="button">
          <Plus size={16} /> New examination
        </button>}
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-slate-500">
            <tr>
              <th className="pb-3 font-medium">Assessment</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Duration</th>
              <th className="pb-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="py-8 text-slate-500" colSpan={4}>Loading assessments…</td></tr>
            ) : isError ? (
              <tr><td className="py-8 text-center text-red-700" colSpan={4}>Assessments could not be loaded. <button type="button" className="underline" onClick={() => refetch()}>Retry</button></td></tr>
            ) : data.length ? (
              data.map(
                (e: {
                  id: string;
                  title: string;
                  status: string;
                  durationMinutes: number;
                isPractice?: boolean;
              }) => (
                <tr className="border-b last:border-0" key={e.id}>
                  <td className="py-4 font-medium">
                    {e.title} {e.isPractice && <Badge variant="outline">Practice · ungraded</Badge>}
                    <CopyableId id={e.id} label="Examination UUID" compact />
                  </td>
                    <td className="py-4">
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">
                        {e.status}
                      </span>
                    </td>
                    <td className="py-4 text-slate-500">
                      {e.durationMinutes ?? "—"} min
                    </td>
                    <td className="py-4">
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {canManage ? <>
                          <button
                            type="button"
                            disabled={e.status !== "draft"}
                            onClick={() => navigate(`/app/exam-builder/${e.id}`)}
                            className="text-sm font-semibold text-blue-700 disabled:text-slate-400"
                          >
                            {e.status === "draft" ? "Edit draft" : "Locked"}
                          </button>
                          <button
                            type="button"
                            disabled={!['published', 'scheduled', 'live'].includes(e.status)}
                            onClick={() => openAssignment(e)}
                            className="text-sm font-semibold text-emerald-700 disabled:text-slate-400"
                          >
                            Assign candidates
                          </button>
                          <button
                            type="button"
                            disabled={e.status === "draft"}
                            onClick={() => navigate(`/app/exams/${e.id}/submissions`)}
                            className="text-sm font-semibold text-slate-800 disabled:text-slate-400"
                          >
                            Submissions
                          </button>
                        </> : <span className="text-xs text-slate-400">View only</span>}
                      </div>
                    </td>
                  </tr>
                ),
              )
            ) : (
              <tr>
                <td className="py-12 text-center text-slate-500" colSpan={4}>
                  {canManage ? "No examinations yet. Create your first assessment." : "No examinations are available to view."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Dialog open={Boolean(assignmentExam)} onOpenChange={(open) => { if (!open) setAssignmentExam(null); }} ariaLabel="Assign assessment">
        {assignmentExam && <DialogContent className="w-[min(100vw-2rem,32rem)]">
          <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Assessment delivery</p><h3 className="mt-1 text-lg font-semibold">Assign candidates</h3><p className="mt-1 text-sm text-slate-500">{assignmentExam.title} · {assignmentExam.durationMinutes} minutes</p><CopyableId id={assignmentExam.id} label="Examination UUID" compact /></div><button type="button" onClick={() => setAssignmentExam(null)} className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100">Close</button></div>
          <div className="mt-5 space-y-2">{candidatesLoading ? <p className="py-6 text-center text-sm text-slate-500">Loading candidates…</p> : candidatesError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Candidate records could not be loaded. <button type="button" className="ml-1 underline" onClick={() => refetchCandidates()}>Retry</button></div> : candidates.length ? candidates.map((candidate: any) => <div key={candidate.id} className="rounded-xl border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/40"><label className="flex min-w-0 cursor-pointer items-center gap-3"><Checkbox checked={selectedCandidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} aria-label={`Select ${candidate.name}`} /><span className="min-w-0"><span className="block text-sm font-semibold">{candidate.name}</span><span className="block text-xs text-slate-500">{candidate.email}</span></span></label><div className="mt-2 border-t border-slate-100 pt-2"><CopyableId id={candidate.id} label="Candidate UUID" compact /></div></div>) : <p className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">Create a student account before assigning this assessment.</p>}</div>
          {assignmentError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{assignmentError}</p>}
          {assignmentNotice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{assignmentNotice}</p>}
          <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setAssignmentExam(null)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" disabled={assigning || !candidates.length} onClick={assignSelected} className="button">{assigning ? "Assigning…" : `Assign selected (${selectedCandidateIds.length})`}</button></div>
        </DialogContent>}
      </Dialog>
    </div>
  );
}
function Reports({ session }: { session: Session }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["reports", session.organization.id],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/reports/summary`)
        .then((r) => r.data),
  });
  const exportCsv = async () => {
    setExporting(true);
    setExportError("");
    try {
      const response = await api.get(`/api/organizations/${session.organization.id}/reports/export.csv`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "examguard-results.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(axios.isAxiosError(error) ? (error.response?.data?.error ?? "The CSV export could not be downloaded.") : "The CSV export could not be downloaded.");
    } finally {
      setExporting(false);
    }
  };
  if (isLoading)
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((x) => (
          <div
            key={x}
            className="h-28 animate-pulse rounded-2xl bg-slate-200"
          />
        ))}
      </div>
    );
  if (isError)
    return (
      <div className="card text-center">
        <AlertTriangle className="mx-auto text-red-500" />
        <p className="mt-3">
          Reports are unavailable for this role or connection.
        </p>
      </div>
    );
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Results & reports</h2>
          <p className="text-sm text-slate-500">
            Live organization metrics from submitted attempts.
          </p>
        </div>
        {canExportReports(session.role) && <button type="button" className="button" onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? "Preparing export…" : "Export CSV"}
        </button>}
      </div>
      {exportError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{exportError}</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Metric
          label="Completion rate"
          value={`${Math.round(data.completionRate * 100)}%`}
        />
        <Metric
          label="Submissions"
          value={`${data.submission.submitted}/${data.submission.assigned}`}
        />
        <Metric label="Incidents" value={String(data.incidents)} />
      </div>
      {(session.role === "institute_admin" || session.role === "teacher") && <AnalyticsPanel organizationId={session.organization.id} />}
      <div className="card mt-6">
        <h3 className="font-semibold">Published and pending grades</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="pb-2">Candidate / UUID</th>
                <th className="pb-2">Score</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.grades.length ? (
                data.grades.map(
                  (
                    g: {
                      candidateId: string;
                      totalMarks: number;
                      maxMarks: number;
                      status: string;
                    },
                    i: number,
                  ) => (
                    <tr className="border-b" key={`${g.candidateId}-${i}`}>
                      <td className="py-3"><CopyableId id={g.candidateId} label="Candidate UUID" compact /></td>
                      <td>
                        {g.totalMarks}/{g.maxMarks}
                      </td>
                      <td>{g.status}</td>
                    </tr>
                  ),
                )
              ) : (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-500">
                    No graded attempts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
const candidateCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter the candidate's full name.").max(100),
  email: z.string().trim().email("Enter a valid email address."),
  initialPassword: z.string().min(10, "Use at least 10 characters.").regex(/[A-Z]/, "Add an uppercase letter.").regex(/[a-z]/, "Add a lowercase letter.").regex(/[0-9]/, "Add a number."),
  confirmPassword: z.string(),
}).refine((values) => values.initialPassword === values.confirmPassword, {
  path: ["confirmPassword"], message: "The passwords do not match.",
});
type CandidateCreateValues = z.infer<typeof candidateCreateSchema>;
function CandidateCreateForm({ onCreate, error, notice }: { onCreate: (values: CandidateCreateValues) => Promise<boolean>; error: string; notice: string }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CandidateCreateValues>({
    resolver: zodResolver(candidateCreateSchema),
    defaultValues: { name: "", email: "", initialPassword: "", confirmPassword: "" },
  });
  const submit = handleSubmit(async (values) => {
    if (await onCreate(values)) reset();
  });
  return (
    <form onSubmit={submit} className="card h-fit">
      <p className="eyebrow">Student onboarding</p>
      <h2 className="mt-1 font-semibold">Create student account</h2>
      <p className="mt-2 text-sm leading-5 text-slate-500">Create the candidate profile and student login. The initial password is never shown again.</p>
      <label className="mt-4 block text-sm font-medium">Full name
        <Input className="mt-1" autoComplete="name" {...register("name")} />
        {errors.name && <span className="mt-1 block text-xs text-red-700" role="alert">{errors.name.message}</span>}
      </label>
      <label className="mt-3 block text-sm font-medium">Email
        <Input className="mt-1" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <span className="mt-1 block text-xs text-red-700" role="alert">{errors.email.message}</span>}
      </label>
      <label className="mt-3 block text-sm font-medium">Initial password
        <Input className="mt-1" type="password" autoComplete="new-password" {...register("initialPassword")} />
        {errors.initialPassword && <span className="mt-1 block text-xs text-red-700" role="alert">{errors.initialPassword.message}</span>}
      </label>
      <label className="mt-3 block text-sm font-medium">Confirm initial password
        <Input className="mt-1" type="password" autoComplete="new-password" {...register("confirmPassword")} />
        {errors.confirmPassword && <span className="mt-1 block text-xs text-red-700" role="alert">{errors.confirmPassword.message}</span>}
      </label>
      <p className="mt-2 text-xs leading-5 text-slate-500">Use 10+ characters with uppercase, lowercase and a number. Share it securely; students can use password recovery later.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <Button type="submit" className="mt-4 w-full" disabled={isSubmitting}>{isSubmitting ? "Creating account…" : "Create student account"}</Button>
    </form>
  );
}
function Candidates({ session }: { session: Session }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Math.min(10_000, Number(searchParams.get("page") ?? 1) || 1));
  const pageSizeValue = Number(searchParams.get("pageSize") ?? 50);
  const pageSize = [25, 50, 100].includes(pageSizeValue) ? pageSizeValue : 50;
  const search = searchParams.get("search") ?? "";
  const sortBy = ["name", "email", "createdAt"].includes(searchParams.get("sortBy") ?? "") ? searchParams.get("sortBy")! : "name";
  const sortOrder = searchParams.get("sortOrder") === "desc" ? "desc" : "asc";
  const updateListParams = (changes: Record<string, string | null>) => setSearchParams(current => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key); else next.set(key, value);
    }
    return next;
  });
  const { data: candidatePage = { items: [], pagination: null }, isLoading: candidatesLoading, isError: candidatesError, refetch } = useQuery({
    queryKey: ["candidates", session.organization.id, page, pageSize, search, sortBy, sortOrder],
    queryFn: async () => {
      const response = await api.get(`/api/organizations/${session.organization.id}/candidates`, {
        params: { page, pageSize, ...(search.trim() ? { search: search.trim() } : {}), sortBy, sortOrder },
      });
      return { items: response.data as any[], pagination: readPagination(response) };
    },
  });
  const data = candidatePage.items;
  const pagination = candidatePage.pagination;
  const { data: availableExams = [] } = useQuery({
    queryKey: ["assignable-exams", session.organization.id],
    enabled: ["institute_admin", "teacher"].includes(session.role),
    queryFn: () => api.get(`/api/organizations/${session.organization.id}/exams`).then((response) => response.data),
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [applicationRejectOpen, setApplicationRejectOpen] = useState(false);
  const { data: candidateDetails, isLoading: detailsLoading, refetch: refetchCandidateDetails } = useQuery({
    queryKey: ["candidate-details", session.organization.id, selectedCandidateId],
    enabled: Boolean(selectedCandidateId),
    queryFn: () => api.get(`/api/organizations/${session.organization.id}/candidates/${selectedCandidateId}`).then((response) => response.data),
  });
  const canManage = canManageCandidates(session.role);
  const add = async (values: CandidateCreateValues): Promise<boolean> => {
    if (!canManage) return false;
    setError("");
    setNotice("");
    try {
      await api.post(`/api/organizations/${session.organization.id}/candidates`, {
        name: values.name, email: values.email, initialPassword: values.initialPassword,
      });
      setNotice("Student account created. Share the initial password with the student through a secure channel.");
      await refetch();
      return true;
    } catch (e) {
      setError(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Could not create the student account.") : "Could not create the student account.");
      return false;
    }
  };
  const assignAssessment = async (examId: string) => {
    if (!canManage || !selectedCandidateId) return;
    setError("");
    try {
      await api.post(`/api/organizations/${session.organization.id}/exams/${examId}/assignments`, { candidateId: selectedCandidateId });
      setNotice("Assessment assigned to this student.");
      refetch();
      refetchCandidateDetails();
    } catch (e) {
      setError(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Could not assign this assessment.") : "Could not assign this assessment.");
    }
  };
  const reviewStudentApplication = async (approved: boolean, reason: string): Promise<boolean> => {
    const verificationId = candidateDetails?.verification?.id;
    if (!verificationId) return false;
    setError("");
    try {
      await api.post(`/api/organizations/${session.organization.id}/student-applications/${verificationId}/decision`, { action: approved ? "approve" : "reject", reason });
      setNotice(approved ? "Student application approved." : "Student application rejected.");
      await refetchCandidateDetails();
      return true;
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? (requestError.response?.data?.error ?? "Could not review the student application.") : "Could not review the student application.");
      return false;
    }
  };
  const openStudentIdDocument = async () => {
    const verificationId = candidateDetails?.verification?.id;
    if (!verificationId) return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) return setError("Allow pop-ups to view the private student ID document.");
    tab.opener = null;
    setError("");
    try {
      const { data } = await api.get<{ url: string }>(`/api/organizations/${session.organization.id}/student-applications/${verificationId}/documents/idDocument`);
      tab.location.replace(data.url);
    } catch (requestError) {
      tab.close();
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? "The student ID document could not be opened." : "The student ID document could not be opened.");
    }
  };
  const requestApplicationDecision = (approved: boolean) => {
    if (approved) void reviewStudentApplication(true, "Approved by institute review");
    else setApplicationRejectOpen(true);
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      {canManage ? <CandidateCreateForm onCreate={add} error={error} notice={notice} /> : <section className="card h-fit"><p className="eyebrow">Candidate directory</p><h2 className="mt-1 font-semibold">Read-only access</h2><p className="mt-2 text-sm leading-6 text-slate-500">Your role can inspect candidate records but cannot create accounts or assign assessments.</p></section>}
      <div className="card min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold">Candidates</h2><p className="mt-1 text-sm text-slate-500">Select a candidate to see application, assessment and result status.</p></div>
          <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{pagination ? `${pagination.totalCount} total` : "Total unavailable"}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_150px]">
          <label className="text-xs font-semibold text-slate-600">Search candidates
            <Input value={search} maxLength={120} onChange={(event) => updateListParams({ search: event.target.value, page: null })} placeholder="Name, email, phone or external ID" className="mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Sort by
            <select value={sortBy} onChange={(event) => updateListParams({ sortBy: event.target.value, page: null })} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
              <option value="name">Name</option><option value="email">Email</option><option value="createdAt">Date added</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Direction
            <select value={sortOrder} onChange={(event) => updateListParams({ sortOrder: event.target.value, page: null })} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
              <option value="asc">Ascending</option><option value="desc">Descending</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Application</TableHead><TableHead>Account</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {candidatesLoading ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-stone-500">Loading candidates…</TableCell></TableRow>
              : candidatesError ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-red-700">Candidate records could not be loaded. <button type="button" className="ml-2 underline" onClick={() => refetch()}>Retry</button></TableCell></TableRow>
              : data.length ? data.map((candidate: { id: string; name: string; email: string; verificationStatus?: string; userId?: string }) => (
                <TableRow key={candidate.id}>
                  <TableCell className="font-semibold text-stone-900">{candidate.name}<CopyableId id={candidate.id} label="Candidate UUID" compact /></TableCell>
                  <TableCell>{candidate.email}</TableCell>
                  <TableCell><Badge variant={candidate.verificationStatus === "approved" ? "success" : candidate.verificationStatus === "submitted" ? "warning" : candidate.verificationStatus === "rejected" ? "danger" : "muted"}>{(candidate.verificationStatus ?? "not_submitted").replaceAll("_", " ")}</Badge></TableCell>
                  <TableCell><Badge variant={candidate.userId ? "success" : "muted"}>{candidate.userId ? "Linked" : "Not linked"}</Badge></TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={() => setSelectedCandidateId(candidate.id)}>View details</Button></TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={5} className="py-10 text-center text-stone-500">{search ? "No candidates match this search." : "No candidates yet."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-xs text-slate-600">Rows per page
            <select value={String(pageSize)} onChange={(event) => updateListParams({ pageSize: event.target.value, page: null })} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select>
          </label>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{pagination ? `Page ${pagination.page} of ${Math.max(1, pagination.totalPages)} · ${pagination.totalCount} records` : "Pagination metadata unavailable"}</span>
            <Button type="button" variant="outline" size="sm" disabled={!pagination || page <= 1 || candidatesLoading} onClick={() => updateListParams({ page: String(page - 1) })}>Previous</Button>
            <Button type="button" variant="outline" size="sm" disabled={!pagination || pagination.totalPages === 0 || page >= pagination.totalPages || candidatesLoading} onClick={() => updateListParams({ page: String(page + 1) })}>Next</Button>
          </div>
        </div>
      </div>
      <aside className="card h-fit xl:sticky xl:top-6">
        {!selectedCandidateId ? <div className="py-10 text-center"><Users className="mx-auto text-blue-600" size={28}/><h2 className="mt-3 font-semibold">Candidate details</h2><p className="mt-2 text-sm leading-6 text-slate-500">Choose a candidate to inspect their real account, assessment and result details.</p></div> : detailsLoading ? <div className="h-72 animate-pulse rounded-xl bg-slate-100" /> : candidateDetails ? <CandidateDetails details={candidateDetails} exams={availableExams} onAssign={assignAssessment} onReview={requestApplicationDecision} onOpenIdDocument={openStudentIdDocument} canReview={session.role === "institute_admin"} canAssign={canManage} onClose={() => setSelectedCandidateId("")} /> : <p className="text-sm text-red-600">Candidate details could not be loaded.</p>}
      </aside>
      <ReasonDialog
        open={applicationRejectOpen}
        title="Reject student application"
        maxLength={1000}
        description="Provide a reason for rejecting this student application."
        submitLabel="Reject application"
        onCancel={() => setApplicationRejectOpen(false)}
        onSubmit={async (reason) => {
          const saved = await reviewStudentApplication(false, reason);
          if (saved) setApplicationRejectOpen(false);
          return saved;
        }}
      />
    </div>
  );
}
function CandidateDetails({ details, exams, onAssign, onReview, onOpenIdDocument, canReview, canAssign, onClose }: { details: any; exams: any[]; onAssign: (examId: string) => void; onReview: (approved: boolean) => void; onOpenIdDocument: () => void; canReview: boolean; canAssign: boolean; onClose: () => void }) {
  const c = details.candidate;
  const hasIdentityDocument = Boolean(details.verification.hasIdentityDocument);
  const assignedIds = new Set(details.assessments.map((item: any) => String(item.exam?.id)));
  const assignable = exams.filter((exam) => ["published", "scheduled", "live"].includes(exam.status) && !assignedIds.has(String(exam.id)));
  return <div>
    <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Candidate profile</p><h2 className="mt-1 text-lg font-semibold">{c.name}</h2><CopyableId id={c.id} label="Candidate UUID" /></div><button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-900">Close</button></div>
    <dl className="mt-5 space-y-3 text-sm">
      <div><dt className="text-slate-500">Email</dt><dd className="mt-1 break-all font-medium">{c.email}</dd></div>
      <div className="grid grid-cols-2 gap-3"><div><dt className="text-slate-500">Signup application</dt><dd className="mt-1 font-medium capitalize">{String(details.verification.status).replaceAll("_", " ")}</dd></div><div><dt className="text-slate-500">Exam account</dt><dd className="mt-1 font-medium">{c.accountLinked ? "Linked" : "Not linked"}</dd></div></div>
      {canReview && <div><dt className="text-slate-500">Government ID proof</dt><dd className="mt-1">{hasIdentityDocument ? <button type="button" onClick={onOpenIdDocument} className="font-semibold text-blue-700 underline">View private ID proof</button> : <span className="text-amber-700">Not submitted</span>}</dd></div>}
      {canReview && details.verification.status === "submitted" && <div className="flex gap-3">{hasIdentityDocument ? <button type="button" onClick={() => onReview(true)} className="text-sm font-semibold text-emerald-700">Approve application</button> : <span className="text-sm text-amber-700">ID proof is required before approval.</span>}<button type="button" onClick={() => onReview(false)} className="text-sm font-semibold text-red-700">Reject application</button></div>}
      {c.externalId && <div><dt className="text-slate-500">Institution-provided candidate ID</dt><dd className="mt-1 font-medium">{c.externalId}</dd></div>}
    </dl>
    <div className="mt-6 border-t pt-5"><h3 className="font-semibold">Assign an assessment</h3>{!canAssign ? <p className="mt-2 text-sm text-slate-500">Assessment assignment is restricted to institute administrators and teachers.</p> : assignable.length ? <div className="mt-3 space-y-2">{assignable.map((exam) => <div key={exam.id} className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm"><div className="min-w-0"><b className="block text-slate-900">{exam.title}</b><span className="text-slate-600">{exam.durationMinutes} minutes · {exam.status}</span></div><button type="button" onClick={() => onAssign(exam.id)} className="shrink-0 font-semibold text-blue-700">Assign</button></div>)}</div> : <p className="mt-2 text-sm text-slate-500">No unassigned published assessments are available.</p>}
      <h3 className="mt-6 font-semibold">Assigned assessments</h3><div className="mt-3 space-y-3">{details.assessments.length ? details.assessments.map((item: any, index: number) => <article key={index} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-medium">{item.exam?.title ?? "Assessment unavailable"}</p>{item.exam?.id && <CopyableId id={item.exam.id} label="Examination UUID" compact />}<p className="mt-1 capitalize text-slate-500">{item.attempt?.status?.replaceAll("_", " ") ?? "Assigned — not started"}</p>{item.attempt?.id && <CopyableId id={item.attempt.id} label="Attempt UUID" compact />}{item.attempt?.receiptCode && <p className="mt-1 text-xs text-slate-500">Receipt: {item.attempt.receiptCode}</p>}{item.grade && <p className="mt-2 font-semibold text-emerald-700">Score: {item.grade.totalMarks}/{item.grade.maxMarks} · {item.grade.status}</p>}</article>) : <p className="text-sm text-slate-500">No assessments assigned yet.</p>}</div>
    </div>
  </div>;
}
function Incidents({ session }: { session: Session }) {
  const [selected, setSelected] = useState<any>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Math.max(
    1,
    Math.min(10_000, Number(searchParams.get("page") ?? 1) || 1),
  );

  const pageSizeValue = Number(searchParams.get("pageSize") ?? 50);
  const pageSize = [25, 50, 100].includes(pageSizeValue)
    ? pageSizeValue
    : 50;

  const candidateId = searchParams.get("candidateId") ?? "";
  const examId = searchParams.get("examId") ?? "";
  const status = searchParams.get("status") ?? "";
  const eventType = searchParams.get("eventType") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const [liveUpdatesStatus, setLiveUpdatesStatus] = useState("Enter an examination UUID to enable live updates.");

  useEffect(() => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(examId)) {
      setLiveUpdatesStatus("Enter an examination UUID to enable live updates.");
      return;
    }

    setLiveUpdatesStatus("Connecting to live exam updates…");
    const socket = io(api.defaults.baseURL || window.location.origin, {
      auth: { token: session.token },
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => {
      socket.emit("join-exam", { organizationId: session.organization.id, examId });
    });
    socket.on("subscription_ready", () => setLiveUpdatesStatus("Live updates connected for this exam."));
    socket.on("subscription_error", (message: { error?: string }) => {
      setLiveUpdatesStatus(message.error || "Live updates are not authorized for this exam.");
    });
    socket.on("connect_error", () => setLiveUpdatesStatus("Live updates unavailable; reconnecting…"));
    socket.on("disconnect", () => setLiveUpdatesStatus("Live updates disconnected; reconnecting…"));
    socket.on("proctoring_incident", () => {
      void queryClient.invalidateQueries({ queryKey: ["incidents", session.organization.id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", session.organization.id] });
    });
    return () => socket.disconnect();
  }, [examId, session.organization.id, session.token]);

  const updateListParams = (
    changes: Record<string, string | null>,
  ) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);

      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }

      return next;
    });

  const {
    data: incidentPage = { items: [], pagination: null },
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: [
      "incidents",
      session.organization.id,
      page,
      pageSize,
      candidateId,
      examId,
      status,
      eventType,
      from,
      to,
    ],
    queryFn: async () => {
      const response = await api.get(
        `/api/organizations/${session.organization.id}/incidents`,
        {
          params: {
            page,
            pageSize,
            ...(candidateId ? { candidateId } : {}),
            ...(examId ? { examId } : {}),
            ...(status ? { status } : {}),
            ...(eventType.trim()
              ? { eventType: eventType.trim() }
              : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
          },
        },
      );

      return {
        items: Array.isArray(response.data) ? response.data : [],
        pagination: readPagination(response),
      };
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const data = Array.isArray(incidentPage.items)
    ? incidentPage.items.filter((item: any) => item && typeof item === "object")
    : [];

  const pagination = incidentPage.pagination;
  const canDecide = canDecideIncidents(session.role);

  const [decisionError, setDecisionError] = useState("");
  const [decidingId, setDecidingId] = useState("");
  const [pendingDecision, setPendingDecision] = useState<{
    id: string;
    action: string;
  } | null>(null);

  const decide = async (
    id: string,
    action: string,
    reason: string,
  ): Promise<boolean> => {
    if (!canDecide) return false;

    setDecisionError("");
    setDecidingId(id);

    try {
      await api.post(
        `/api/organizations/${session.organization.id}/incidents/${id}/decision`,
        {
          action,
          reason: reason.trim(),
        },
      );

      await refetch();
      return true;
    } catch (error) {
      setDecisionError(
        axios.isAxiosError(error)
          ? error.response?.data?.error ??
              "The reviewer decision could not be saved."
          : "The reviewer decision could not be saved.",
      );

      return false;
    } finally {
      setDecidingId("");
    }
  };

  const openCase = async (id: string) => {
    try {
      // Refresh the incident list to renew private evidence URLs.
      const refreshed = await refetch();

      // The query returns { items, pagination }, not an array.
      const refreshedItems = Array.isArray(refreshed.data?.items)
        ? refreshed.data.items
        : data;

      const record = refreshedItems.find(
        (item: any) => item && item.id === id,
      );

      // Only open a valid incident object.
      if (record && typeof record === "object") {
        setSelected(record);
      } else {
        setSelected(null);
        setDecisionError(
          "This incident could not be found. Refresh the incident list and try again.",
        );
      }
    } catch {
      setSelected(null);
      setDecisionError(
        "Could not refresh the incident details. Please try again.",
      );
    }
  };

  if (isLoading) {
    return (
      <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />
    );
  }

  if (isError) {
    return (
      <div className="card">
        <p role="alert" className="text-sm text-red-700">
          Incident records could not be loaded. Check the filter values
          and your organization access.
        </p>

        <button
          type="button"
          className="button mt-4"
          onClick={() => refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  const incidentType = (value: unknown) =>
    typeof value === "string" && value.trim()
      ? value.replaceAll("_", " ")
      : "Unspecified incident";

  const selectedEvents = Array.isArray(selected?.eventIds)
    ? selected.eventIds.filter(
        (event: any) => event && typeof event === "object",
      )
    : [];

  const selectedEvidence = selectedEvents.filter(
    (event: any) => typeof event.evidenceUrl === "string",
  );

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Human review queue</p>
          <h2 className="mt-1 font-semibold">Incident timeline</h2>

          <p className="mt-1 text-sm text-slate-500">
            {canDecide
              ? "Signals are review priorities, not findings of wrongdoing."
              : "Read-only review access. Reviewer decisions are restricted to institute administrators and proctors."}
          </p>
        </div>

        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            data.length
              ? "bg-amber-50 text-amber-800"
              : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {pagination
            ? `${pagination.totalCount} review items`
            : "Total unavailable"}
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-500" role="status">{liveUpdatesStatus}</p>

      {/* Incident filters */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-xs font-semibold text-slate-600">
          Review status

          <select
            value={status}
            onChange={(event) =>
              updateListParams({
                status: event.target.value,
                page: null,
              })
            }
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="dismissed">Dismissed</option>
            <option value="resolved">Resolved</option>
            <option value="escalated">Escalated</option>
            <option value="awaiting_student">Awaiting student</option>
          </select>
        </label>

        <label className="text-xs font-semibold text-slate-600">
          Event type

          <input
            value={eventType}
            maxLength={80}
            onChange={(event) =>
              updateListParams({
                eventType: event.target.value,
                page: null,
              })
            }
            placeholder="e.g. phone_detected"
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          />
        </label>

        <label className="text-xs font-semibold text-slate-600">
          Candidate ID
          <span className="mt-1 block font-normal text-slate-500">Copy the Candidate UUID from the Candidates list or a review record.</span>

          <input
            value={candidateId}
            onChange={(event) =>
              updateListParams({
                candidateId: event.target.value,
                page: null,
              })
            }
            placeholder="Candidate UUID"
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          />
        </label>

        <label className="text-xs font-semibold text-slate-600">
          Examination ID
          <span className="mt-1 block font-normal text-slate-500">Copy the Examination UUID from the Examinations list or a review record.</span>

          <input
            value={examId}
            onChange={(event) =>
              updateListParams({
                examId: event.target.value,
                page: null,
              })
            }
            placeholder="Examination UUID"
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          />
        </label>

        <label className="text-xs font-semibold text-slate-600">
          From

          <input
            type="datetime-local"
            value={dateTimeLocalValue(from)}
            onChange={(event) =>
              updateListParams({
                from: event.target.value
                  ? new Date(event.target.value).toISOString()
                  : null,
                page: null,
              })
            }
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          />
        </label>

        <label className="text-xs font-semibold text-slate-600">
          To

          <input
            type="datetime-local"
            value={dateTimeLocalValue(to)}
            onChange={(event) =>
              updateListParams({
                to: event.target.value
                  ? new Date(event.target.value).toISOString()
                  : null,
                page: null,
              })
            }
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          />
        </label>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-slate-100 py-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Rows per page

          <select
            value={String(pageSize)}
            onChange={(event) =>
              updateListParams({
                pageSize: event.target.value,
                page: null,
              })
            }
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>

        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>
            {pagination
              ? `Page ${pagination.page} of ${Math.max(
                  1,
                  pagination.totalPages,
                )} · ${pagination.totalCount} records`
              : "Pagination metadata unavailable"}
          </span>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!pagination || page <= 1 || isFetching}
            onClick={() =>
              updateListParams({ page: String(page - 1) })
            }
          >
            Previous
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              !pagination ||
              pagination.totalPages === 0 ||
              page >= pagination.totalPages ||
              isFetching
            }
            onClick={() =>
              updateListParams({ page: String(page + 1) })
            }
          >
            Next
          </Button>
        </div>
      </div>

      {isFetching && !isLoading && (
        <p className="mt-2 text-xs text-slate-500" role="status">
          Updating incident results…
        </p>
      )}

      {decisionError && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {decisionError}
        </p>
      )}

      {/* Incident records */}
      <div className="mt-5 space-y-3">
        {data.length ? (
          data.map((i: any) => {
            const events = Array.isArray(i.eventIds)
              ? i.eventIds.filter(
                  (event: any) => event && typeof event === "object",
                )
              : [];

            const evidence = events.filter(
              (event: any) => typeof event.evidenceUrl === "string",
            );

            const signals = Array.isArray(i.contributingSignals)
              ? i.contributingSignals.filter(
                  (signal: any) =>
                    signal && typeof signal === "object",
                )
              : [];
            const incidentCandidate = i.candidateId && typeof i.candidateId === "object" ? i.candidateId : null;
            const incidentExam = i.examId && typeof i.examId === "object" ? i.examId : null;

            return (
              <article
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                key={i.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{incidentType(i.type)}</b>

                  <span className="text-sm text-slate-500">
                    Priority {i.riskPriority ?? "Not assigned"} ·{" "}
                    {i.status ?? "Unknown"}
                  </span>
                </div>

                <p className="mt-2 text-sm text-slate-600">
                  {i.details ?? "No additional incident details provided."}
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {incidentCandidate?.id && <div><p className="mb-1 text-xs font-medium text-slate-500">{incidentCandidate.name ?? "Candidate"}</p><CopyableId id={incidentCandidate.id} label="Candidate UUID" compact /></div>}
                  {incidentExam?.id && <div><p className="mb-1 text-xs font-medium text-slate-500">{incidentExam.title ?? "Examination"}</p><CopyableId id={incidentExam.id} label="Examination UUID" compact /></div>}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2">
                    {evidence.length ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {evidence.map((event: any, imageIndex: number) => (
                          <button key={event.id ?? imageIndex} type="button" onClick={() => void openCase(i.id)} className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left">
                            <img
                              src={event.evidenceUrl}
                              alt={`Private evidence image ${imageIndex + 1} for this incident`}
                              className="aspect-video w-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                            <span className="block truncate px-2 py-1 text-[10px] text-slate-600">{incidentType(event.type)} · {event.occurredAt ? new Date(event.occurredAt).toLocaleTimeString() : "Time unavailable"}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex min-h-24 items-center justify-center p-3 text-center text-xs leading-5 text-slate-500">
                        <span>
                          <ShieldCheck className="mx-auto mb-1 text-slate-400" size={20} />
                          No captured image evidence is attached to this incident.
                        </span>
                      </div>
                    )}
                    <p className="border-t border-slate-200 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">
                      {evidence.length} authorized evidence image{evidence.length === 1 ? "" : "s"} · open case for full-size gallery
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">
                      Review flags
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {signals.map((signal: any, index: number) => (
                        <span
                          key={signal.id ?? index}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                        >
                          {incidentType(signal.type)} · weight{" "}
                          {signal.weight ?? "N/A"}
                        </span>
                      ))}
                    </div>

                    <p className="mt-3 text-xs text-slate-500">
                      Created{" "}
                      {i.createdAt
                        ? new Date(i.createdAt).toLocaleString()
                        : "Timestamp unavailable"}{" "}
                      · authorized reviewers only.
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  <button
                    type="button"
                    onClick={() => void openCase(i.id)}
                    className="font-semibold text-blue-700"
                  >
                    View case details
                  </button>

                  {canDecide && (
                    <>
                      <button
                        type="button"
                        disabled={decidingId === i.id}
                        onClick={() =>
                          setPendingDecision({
                            id: i.id,
                            action: "dismissed",
                          })
                        }
                        className="text-slate-700 disabled:opacity-50"
                      >
                        Dismiss
                      </button>

                      <button
                        type="button"
                        disabled={decidingId === i.id}
                        onClick={() =>
                          setPendingDecision({
                            id: i.id,
                            action: "resolved",
                          })
                        }
                        className="text-emerald-700 disabled:opacity-50"
                      >
                        Resolve
                      </button>

                      {i.status === "awaiting_student" ? (
                        <span className="font-medium text-amber-700">
                          Student explanation requested
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={decidingId === i.id}
                          onClick={() =>
                            setPendingDecision({
                              id: i.id,
                              action: "awaiting_student",
                            })
                          }
                          className="text-blue-700 disabled:opacity-50"
                        >
                          Ask student for context
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 px-6 py-10 text-center">
            <ShieldCheck
              className="mx-auto text-emerald-600"
              size={28}
            />

            <p className="mt-3 font-medium text-slate-800">
              No incidents match these filters
            </p>

            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">
              Try changing or clearing the review filters to see other incidents.
            </p>
          </div>
        )}
      </div>

      {/* Reviewer decision dialog */}
      <ReasonDialog
        open={Boolean(pendingDecision)}
        title={
          pendingDecision?.action === "awaiting_student"
            ? "Request candidate context"
            : pendingDecision?.action === "resolved"
              ? "Resolve incident"
              : "Dismiss incident"
        }
        description={
          pendingDecision?.action === "awaiting_student"
            ? "Explain what additional context is needed. The request is not a penalty and will be recorded for the candidate."
            : "Record the reviewer rationale. This decision is a human review outcome, not an automatic system action."
        }
        submitLabel={
          pendingDecision?.action === "awaiting_student"
            ? "Send request"
            : pendingDecision?.action === "resolved"
              ? "Resolve incident"
              : "Dismiss incident"
        }
        onCancel={() => setPendingDecision(null)}
        onSubmit={async (reason) => {
          if (!pendingDecision) return false;

          const saved = await decide(
            pendingDecision.id,
            pendingDecision.action,
            reason,
          );

          if (saved) setPendingDecision(null);

          return saved;
        }}
      />

      {/* Case details dialog: never render children without a selected incident */}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        ariaLabel="Incident case details"
        className="fixed inset-y-0 right-0 m-0 h-dvh max-h-dvh w-full max-w-xl"
      >
        {selected && (
          <DialogContent className="h-full max-h-dvh w-full rounded-none p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Review case</p>

                <h3 className="mt-1 text-xl font-semibold capitalize">
                  {incidentType(selected.type)}
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  {selected.candidateId?.name ?? "Candidate"} ·{" "}
                  {selected.examId?.title ?? "Assessment"}
                </p>
                <div className="mt-3 space-y-2">
                  {selected.candidateId?.id && <CopyableId id={selected.candidateId.id} label="Candidate UUID" />}
                  {selected.examId?.id && <CopyableId id={selected.examId.id} label="Examination UUID" />}
                  {selected.id && <CopyableId id={selected.id} label="Incident UUID" />}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {selectedEvidence.length ? (
                selectedEvidence.map((event: any, index: number) => (
                  <figure key={event.id ?? index}>
                    <img
                      src={event.evidenceUrl}
                      alt="Private evidence captured during this assessment event"
                      className="max-h-[420px] w-full rounded-xl border border-slate-200 bg-slate-50 object-contain"
                      referrerPolicy="no-referrer"
                    />

                    <figcaption className="mt-1 text-xs text-slate-500">
                      {incidentType(event.type)} ·{" "}
                      {event.occurredAt
                        ? new Date(event.occurredAt).toLocaleString()
                        : "Timestamp unavailable"}
                    </figcaption>
                  </figure>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                  <ShieldCheck
                    className="mx-auto mb-2"
                    size={24}
                  />
                  No captured image evidence is attached to this incident.
                </div>
              )}
            </div>

            <div className="mt-5 rounded-xl bg-stone-50 p-4 text-sm leading-6 text-stone-700">
              <b>Review guidance.</b> Captured material is contextual
              evidence. Review it alongside the event timeline and
              candidate explanation; automated and radio signals are not
              findings of misconduct.
            </div>

            <dl className="mt-6 space-y-4 text-sm">
              <div>
                <dt className="text-slate-500">Current status</dt>
                <dd className="mt-1 font-semibold capitalize">
                  {incidentType(selected.status)}
                </dd>
              </div>

              <div>
                <dt className="text-slate-500">Reviewer guidance</dt>
                <dd className="mt-1 leading-6 text-slate-700">
                  Use “Ask student for context” only when the signal is
                  ambiguous and a response can help your review. It creates
                  a response deadline; it is not a penalty.
                </dd>
              </div>

              <div>
                <dt className="text-slate-500">Decision record</dt>
                <dd className="mt-1 leading-6 text-slate-700">
                  {selected.decisionReason ??
                    "No reviewer decision recorded yet."}
                </dd>
              </div>
            </dl>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function OrganizationSettings({ session }: { session: Session }) {
  const isAdministrator = session.role === "institute_admin";
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({ name: "", slug: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState("");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["organization", session.organization.id],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}`)
        .then((response) => response.data),
  });

  useEffect(() => {
    if (data) setForm({ name: data.name ?? "", slug: data.slug ?? "" });
  }, [data]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaved("");
    setSaveError("");
    const errors: Record<string, string> = {};
    const name = form.name.trim();
    const slug = form.slug.trim();
    if (name.length < 2) errors.name = "Enter an organization name with at least 2 characters.";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.slug = "Use lowercase letters, numbers, and single hyphens only.";
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    setFieldErrors({});
    try {
      await api.patch(`/api/organizations/${session.organization.id}`, { name, slug });
      await refetch();
      setSaved("Organization profile saved.");
    } catch (error: any) {
      setSaveError(error?.response?.data?.error ?? "The organization profile could not be saved. Try again.");
    }
  };

  if (isLoading) return <div className="h-64 animate-pulse rounded-sm bg-stone-200" />;
  if (isError) return <div className="card max-w-2xl"><AlertTriangle className="text-amber-700" size={28} /><h2 className="mt-3 text-lg font-semibold">Organization profile is unavailable</h2><p className="mt-1 text-sm text-slate-600">The current organization record could not be loaded. Check your access and try again.</p><button type="button" className="button mt-5" onClick={() => refetch()}>Retry</button></div>;

  return (
    <section className="mx-auto max-w-3xl">
      <div className="border-b border-stone-300 pb-6">
        <p className="eyebrow">Organization</p>
        <h2 className="mt-2 text-3xl font-medium tracking-tight text-stone-950">Profile and workspace identity</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">Keep the organization name and URL identifier accurate for your assessment workspace.</p>
      </div>
      <form className="card mt-6" onSubmit={save} noValidate>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-5">
          <div><h3 className="font-semibold text-stone-950">Profile details</h3><p className="mt-1 text-sm text-stone-600">These are the only organization profile fields stored by ExamGuard today.</p></div>
          <span className={`status-badge ${data.status === "active" ? "status-ready" : "status-neutral"}`}>{data.status}</span>
        </div>
        {!isAdministrator && <div className="mt-5 rounded-sm border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><b>Read-only access.</b> Only an institute administrator can change this organization profile.</div>}
        {(Object.keys(fieldErrors).length > 0 || saveError) && <div ref={errorSummaryRef} tabIndex={-1} role="alert" className="mt-5 rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-900"><b>There is a problem with this form.</b><ul className="mt-2 list-disc pl-5">{Object.values(fieldErrors).map((message) => <li key={message}>{message}</li>)}{saveError && <li>{saveError}</li>}</ul></div>}
        {saved && <p className="mt-5 rounded-sm border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">{saved}</p>}
        <div className="mt-6 grid gap-5">
          <label className="block text-sm font-semibold text-stone-800" htmlFor="organization-name">Organization name
            <input id="organization-name" className={`input mt-2 ${fieldErrors.name ? "border-red-500" : ""}`} value={form.name} disabled={!isAdministrator} onChange={(event) => setForm({ ...form, name: event.target.value })} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "organization-name-error" : undefined} />
            {fieldErrors.name && <span id="organization-name-error" className="mt-2 block text-sm font-medium text-red-700">{fieldErrors.name}</span>}
          </label>
          <label className="block text-sm font-semibold text-stone-800" htmlFor="organization-slug">Workspace identifier
            <input id="organization-slug" className={`input mt-2 ${fieldErrors.slug ? "border-red-500" : ""}`} value={form.slug} disabled={!isAdministrator} onChange={(event) => setForm({ ...form, slug: event.target.value })} aria-invalid={Boolean(fieldErrors.slug)} aria-describedby={fieldErrors.slug ? "organization-slug-help organization-slug-error" : "organization-slug-help"} />
            <span id="organization-slug-help" className="mt-2 block text-sm font-normal leading-5 text-stone-500">Lowercase letters, numbers, and hyphens only. This is not a public URL until the application exposes one.</span>
            {fieldErrors.slug && <span id="organization-slug-error" className="mt-2 block text-sm font-medium text-red-700">{fieldErrors.slug}</span>}
          </label>
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5"><p className="text-xs leading-5 text-stone-500">Created {new Date(data.createdAt).toLocaleDateString()} · Last updated {new Date(data.updatedAt).toLocaleString()}.</p>{isAdministrator && <button className="button" type="submit">Save organization profile</button>}</div>
      </form>
      <aside className="mt-6 border-l-2 border-stone-900 bg-stone-100 px-5 py-4 text-sm leading-6 text-stone-700"><b className="text-stone-950">Not configured here.</b> Branding, contact details, retention rules, and assessment policy settings do not have organization-level stored fields. They are intentionally not shown as pretend controls.</aside>
    </section>
  );
}
function UnsupportedWorkspace({ session, clear }: { session: Session; clear: () => void }) {
  const navigate = useNavigate();
  return (
    <main className="eg-candidate-exam grid min-h-screen place-items-center p-6">
      <section className="card w-full max-w-lg text-center">
        <ShieldCheck className="mx-auto text-stone-500" size={32}/>
        <h1 className="mt-4 text-xl font-semibold">No organization workspace is available</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">This account has the <b>{session.role.replaceAll("_", " ")}</b> role. The current ExamGuard backend does not expose a platform-administration workspace through organization routes.</p>
        <button type="button" className="button mt-5" onClick={() => { clear(); navigate("/login", { replace: true }); }}>Sign out</button>
      </section>
    </main>
  );
}

function LoginChoice({ onSave }: { onSave: (session: Session) => void }) {
  const navigate = useNavigate();
  const [oauthError, setOauthError] = useState("");
  const sessionExpired = new URLSearchParams(window.location.search).get("reason") === "session-expired";
  useEffect(() => {
    const encoded = new URLSearchParams(window.location.hash.slice(1)).get("oauth");
    if (!encoded) return;
    try {
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
      const session = JSON.parse(decoded) as Session;
      if (!session?.token || !session?.user?.email || !session?.organization?.id || !session?.role) throw new Error("Invalid OAuth session");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      onSave(session);
      navigate("/app", { replace: true });
    } catch {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setOauthError("The provider sign-in response was invalid or incomplete. Please try again.");
    }
  }, [navigate, onSave]);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-9">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between gap-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-3 rounded-xl font-bold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
            <span className="rounded-xl bg-slate-950 p-2.5 text-cyan-300 shadow-sm"><ShieldCheck size={20} /></span>
            <span className="text-lg">ExamGuard</span>
          </button>
          <span className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 sm:inline-flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Secure assessment platform
          </span>
        </header>
        <section className="mt-7 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
          <div className="grid gap-8 bg-slate-950 px-6 py-9 text-white md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-10 md:py-12">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Secure access · role-based workspaces</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Welcome to ExamGuard</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Choose a workspace to continue. Your account permissions determine which assessments, people, and platform tools you can access.</p>
            </div>
            <div className="hidden rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300 md:block">
              <div className="flex items-center gap-2 font-semibold text-white"><ShieldCheck size={17} className="text-cyan-300" /> Protected sign-in</div>
              <p className="mt-1 text-xs">Every workspace uses your assigned role.</p>
            </div>
          </div>
          <div className="p-5 sm:p-8 lg:p-10">
          {sessionExpired && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Your session expired. Sign in again to continue.</p>}
          {oauthError && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{oauthError}</p>}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Choose a workspace</p><p className="mt-1 text-sm text-slate-600">Select the role that matches your account.</p></div>
            <span className="text-xs text-slate-500">4 secure portals</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <button onClick={() => navigate("/student/login")} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-950/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              <GraduationCap className="text-blue-700" size={30} />
              <h2 className="mt-4 text-lg font-semibold">Student login</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">See your assigned exams, take an assessment, and view released results.</p>
              <span className="mt-5 inline-block text-sm font-semibold text-blue-700">Open student workspace →</span>
            </button>
            <button onClick={() => navigate("/institute/login")} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-violet-300 hover:shadow-lg hover:shadow-violet-950/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
              <Building2 className="text-slate-800" size={30} />
              <h2 className="mt-4 text-lg font-semibold">Institute login</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">For administrators, teachers and proctors who create and manage assessments.</p>
              <span className="mt-5 inline-block text-sm font-semibold text-slate-800">Open institute workspace →</span>
            </button>
            <button onClick={() => navigate("/teacher/login")} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-amber-300 hover:shadow-lg hover:shadow-amber-950/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
              <BriefcaseBusiness className="text-violet-700" size={30} />
              <h2 className="mt-4 text-lg font-semibold">Exam coordinator</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Conduct exams, author coding questions, manage learners, grade work, and review reports.</p>
              <span className="mt-5 inline-block text-sm font-semibold text-violet-700">Open coordinator workspace →</span>
            </button>
            <button onClick={() => navigate("/system/login")} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-cyan-300 hover:shadow-lg hover:shadow-cyan-950/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700">
              <ShieldCheck className="text-emerald-700" size={30} />
              <h2 className="mt-4 text-lg font-semibold">System administration</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Approve institutions, verify staff, manage access, and review platform operations.</p>
              <span className="mt-5 inline-block text-sm font-semibold text-emerald-700">Open admin workspace →</span>
            </button>
          </div>
          </div>
        </section>
        <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
          <span>ExamGuard · Secure examination management</span>
          <span>Access is restricted by account role and institution membership.</span>
        </footer>
      </div>
    </main>
  );
}
function PortalLogin({ portal, onSave }: { portal: "student" | "institute" | "teacher" | "system"; onSave: (session: Session) => void }) {
  const navigate = useNavigate();
  const student = portal === "student";
  const teacher = portal === "teacher";
  const system = portal === "system";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter the complete email address, including its domain (for example, name@college.edu).");
      return;
    }
    setLoading(true);
    try {
      const { data } = await publicApi.post("/api/auth/login", { email: normalizedEmail, password });
      const correctWorkspace = student ? data.role === "student" : teacher ? data.role === "teacher" : system ? data.role === "platform_admin" : data.role !== "student";
      if (!correctWorkspace) {
        setError(student ? "This is an institute account. Please use Institute or Coordinator login." : teacher ? "This is not a coordinator account. Please use the workspace that matches your role." : system ? "This account is not a system administrator." : "This is a student account. Please use Student login.");
        return;
      }
      onSave(data);
      navigate("/app");
    } catch (requestError) {
      const responseStatus = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
      setError(responseStatus === 400 ? "Enter a complete email address and try again." : axios.isAxiosError(requestError) ? (requestError.response?.data?.error ?? "Could not sign in. Please check your details.") : "Could not sign in. Please check your details.");
    } finally {
      setLoading(false);
    }
  };
  const otherPortal = student ? "institute" : "student";
  return (
    <main className={`min-h-screen px-5 py-6 text-slate-900 sm:px-8 sm:py-10 ${student ? "bg-[radial-gradient(circle_at_10%_0%,#dbeafe,transparent_34%),linear-gradient(135deg,#f8fbff_0%,#eef4ff_52%,#f8fafc_100%)]" : "bg-slate-50"}`}>
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between">
          <button onClick={() => navigate("/")} className="group flex items-center gap-3 font-bold tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/25"><ShieldCheck size={20} /></span>
            <span>ExamGuard<small className="ml-2 hidden text-[10px] font-semibold uppercase tracking-[.18em] text-slate-400 sm:inline">Assessment platform</small></span>
          </button>
          <button onClick={() => navigate("/")} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-slate-900"><ArrowLeft size={16}/> Back home</button>
        </header>
        <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-[1.05fr_.95fr]">
          <section className={`relative hidden overflow-hidden rounded-[2rem] p-10 text-white shadow-2xl lg:flex lg:flex-col lg:justify-between ${student ? "bg-slate-950 shadow-blue-900/15" : "bg-[#10243f] shadow-slate-900/15"}`}>
            <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue-500/25 blur-3xl" />
            <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-blue-200"><LockKeyhole size={14}/> {student ? "Protected candidate access" : "Trusted institution access"}</span>
              <h1 className="mt-8 max-w-lg text-4xl font-semibold leading-tight tracking-tight">{student ? "A calm, focused place to do your best work." : "Run every assessment with confidence and control."}</h1>
              <p className="mt-5 max-w-md text-sm leading-7 text-slate-300">{student ? "Access assigned assessments, save your progress, and review released results from one secure student workspace." : "Coordinate exams, review evidence, and keep every important decision inside one accountable workspace."}</p>
            </div>
            <div className="relative mt-12 space-y-3">
              {(student ? ["Your answers save as you work", "Exam timing is held by the server", "Review signals are handled by people"] : ["Create and deliver structured assessments", "Review incidents with full context", "Publish results when your team is ready"]).map((item) => <div key={item} className="flex items-center gap-3 text-sm text-slate-200"><CheckCircle2 size={17} className="text-cyan-300"/> {item}</div>)}
            </div>
          </section>
          <section className="rounded-[2rem] border border-white/70 bg-white/90 p-7 shadow-xl shadow-slate-300/35 backdrop-blur sm:p-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 ring-8 ring-blue-50/60">{student ? <GraduationCap size={25} /> : <Building2 size={24} />}</div>
            <p className="eyebrow mt-7">{student ? "Candidate workspace" : system ? "System administration" : teacher ? "Coordinator workspace" : "Institute workspace"}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{student ? "Student sign in" : system ? "Admin sign in" : teacher ? "Coordinator sign in" : "Institute sign in"}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{student ? "Use the email and password provided by your institute." : system ? "For authorized ExamGuard platform administrators." : teacher ? "For exam coordinators who conduct exams, manage classes, and review student work." : "For institute administrators, exam coordinators, and proctors."}</p>
            <form onSubmit={submit} className="mt-8 space-y-5">
              <label className="block text-sm font-semibold text-slate-800">Email<input className="input mt-2" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="name@example.edu" required /></label>
              <label className="block text-sm font-semibold text-slate-800">Password<span className="relative mt-2 block"><input className="input pr-12" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" required /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-3 text-slate-400 transition hover:text-slate-700">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">{error}</p>}
              <button disabled={loading} className="button w-full !rounded-xl !bg-blue-600 py-3 shadow-lg shadow-blue-600/20 hover:!bg-blue-700 disabled:opacity-60">{loading ? "Signing in…" : student ? "Open student workspace" : system ? "Open admin workspace" : teacher ? "Open coordinator workspace" : "Open institute workspace"}<ChevronRight size={17} className="ml-2"/></button>
            </form>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
              <button onClick={() => navigate("/forgot-password")} className="font-semibold text-blue-700 hover:underline">Forgot password?</button>
              <button onClick={() => navigate(`/${otherPortal}/login`)} className="font-semibold text-slate-600 hover:text-slate-950">Use {student ? "Institute" : "Student"} login</button>
            </div>
            {teacher && <p className="mt-5 border-t border-stone-200 pt-4 text-sm text-stone-600">New coordinator? <button type="button" onClick={() => navigate("/coordinator/register")} className="font-semibold text-blue-700 underline">Apply with university identity proof</button></p>}
            {student && <p className="mt-5 border-t border-stone-200 pt-4 text-sm text-stone-600">New student? <button type="button" onClick={() => navigate("/student/register")} className="font-semibold text-blue-700 underline">Sign up with identity proof</button></p>}
            {portal === "institute" && <p className="mt-5 border-t border-stone-200 pt-4 text-sm text-stone-600">New institution? <button type="button" onClick={() => navigate("/institute/register")} className="font-semibold text-blue-700 underline">Apply for a verified workspace</button></p>}
            <div className="mt-8 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-xs leading-5 text-slate-600"><LockKeyhole size={16} className="mt-0.5 shrink-0 text-blue-700"/><span><b className="text-slate-800">{student ? "Your privacy matters." : "Your workspace is protected."}</b> {student ? "ExamGuard uses visible, consent-based monitoring during assessments and keeps review decisions human-led." : "Organization data, evidence, and review actions stay scoped to authorized team members."}</span></div>
          </section>
        </div>
      </div>
    </main>
  );
}
function App() {
  const s = useSession();
  useEffect(() => {
    const handleSessionExpired = () => {
      s.clear();
      window.location.replace("/login?reason=session-expired");
    };
    window.addEventListener("examguard:session-expired", handleSessionExpired);
    return () => window.removeEventListener("examguard:session-expired", handleSessionExpired);
  }, [s.clear]);
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/student-entry" element={<StudentEntry />} />
      <Route path="/login" element={<LoginChoice onSave={s.save} />} />
      <Route path="/student/login" element={<PortalLogin portal="student" onSave={s.save} />} />
      <Route path="/institute/login" element={<PortalLogin portal="institute" onSave={s.save} />} />
      <Route path="/teacher/login" element={<PortalLogin portal="teacher" onSave={s.save} />} />
      <Route path="/system/login" element={<PortalLogin portal="system" onSave={s.save} />} />
      <Route path="/coordinator/register" element={<CoordinatorApplicationPage />} />
      <Route path="/student/register" element={<StudentApplicationPage />} />
      <Route path="/institute/register" element={<InstitutionApplicationPage />} />
      <Route path="/register" element={<InstitutionApplicationPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/student/invitation" element={<StudentInvitationPage onSave={s.save} />} />
      <Route
        path="/app/take/:examId"
        element={
          s.session ? (
            s.session.role === "student"
              ? <div className="eg-candidate-exam"><StudentExam session={s.session} /></div>
              : <Navigate to="/app" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/app/exam-builder"
        element={
          s.session ? (
            canAccessExamBuilder(s.session.role)
              ? <ExamBuilder session={s.session} />
              : <Navigate to="/app" replace />
          ) : (
            <Navigate to="/login" />
          )
        }
      />
      <Route
        path="/app/exam-builder/:examId"
        element={
          s.session ? (
            canAccessExamBuilder(s.session.role)
              ? <ExamBuilder session={s.session} />
              : <Navigate to="/app" replace />
          ) : (
            <Navigate to="/login" />
          )
        }
      />
      <Route
        path="/app/*"
        element={
          s.session ? (
            ["student", "platform_admin", "institute_admin", "teacher", "proctor"].includes(s.session.role)
              ? <Shell session={s.session} clear={s.clear} />
              : <UnsupportedWorkspace session={s.session} clear={s.clear} />
          ) : (
            <Navigate to="/login" />
          )
        }
      />
    </Routes>
  );
}
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
