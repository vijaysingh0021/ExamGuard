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
  FileText,
  FileSearch,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Monitor,
  Plus,
  Settings,
  UserCog,
  CircleUser,
  ScrollText,
  Gauge,
  ShieldCheck,
  MapPin,
  Search,
  RefreshCw,
  Users,
  Menu,
  X,
} from "lucide-react";
import { ForgotPasswordPage, ResetPasswordPage } from "./auth-pages";
import { Landing } from "./marketing";
import { CodingExamWorkspace } from "./coding-exam";
import { Badge, Button } from "./components/ui";
import { Checkbox, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui";
import { Dialog, DialogContent } from "./components/ui/dialog";
import { ReasonDialog } from "./components/shared";
import { api, publicApi } from "./lib/api";
import { dateTimeLocalValue, readPagination } from "./lib/pagination";
import { canAccessExamBuilder, canDecideIncidents, canEditOrganization, canExportReports, canManageCandidates, canManageExams, canReviewVerifications } from "./lib/permissions";
import "./index.css";
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
import { AuditPage } from "./audit";
import { CandidateDashboard } from "./candidate-dashboard";
// Kept exported from here: existing tests and callers import it from "./main".
export { CandidateDashboard };
import { AccountPage } from "./account";
import { StaffOverview } from "./staff-dashboard";
import { CompanionStatus } from "./companion-status";
import { ExamTimer, QuestionPalette, SubmitReviewDialog, SyncIndicator } from "./exam-ui";
import { AnswerSync, pendingStore, type SyncSnapshot } from "./lib/answer-sync";
import { createSubmitter } from "./lib/submit-flow";
import { clockOffsetMs, isAnswered, loadMarks, progress as examProgress, remainingMs, saveMarks } from "./lib/exam-state";
const queryClient = new QueryClient();

const nav = [
  { label: "Overview", icon: LayoutDashboard, path: "/app" },
  { label: "Examinations", icon: BookOpen, path: "/app/exams" },
  { label: "Candidates", icon: Users, path: "/app/candidates" },
  {
    label: "Verification center",
    icon: ShieldCheck,
    path: "/app/verification",
  },
  { label: "Live monitoring", icon: Monitor, path: "/app/monitoring" },
  { label: "Incident review", icon: AlertTriangle, path: "/app/incidents" },
  { label: "Evidence Center", icon: FileSearch, path: "/app/evidence" },
  { label: "Results & reports", icon: BarChart3, path: "/app/reports" },
  { label: "People & roles", icon: UserCog, path: "/app/people" },
  { label: "Audit log", icon: ScrollText, path: "/app/audit" },
  { label: "Operations", icon: Gauge, path: "/app/operations" },
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
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceNav = session.role === "student"
    ? [{ label: "My assessments", icon: BookOpen, path: "/app" }, { label: "Account", icon: UserCog, path: "/app/account" }]
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
    <div className={`eg-shell ${session.role === "student" ? "eg-shell-candidate" : ""}`}>
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
          <button ref={mobileMenuButtonRef} type="button" className="eg-mobile-menu" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>
            {mobileNavOpen ? <X size={20}/> : <Menu size={20}/>}
          </button>
          <div className="eg-breadcrumb"><span>Workspace</span><ChevronRight size={14}/><b>{pageTitle}</b></div>
          <div className="eg-topbar-actions">
            <span className="eg-environment"><i/> SECURE WORKSPACE</span>
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
            <Route index element={<Dashboard session={session} />} />
            <Route path="exams/:examId/submissions" element={["institute_admin", "teacher"].includes(session.role) ? <SubmissionsPage session={session} /> : <Navigate to="/app" replace />} />
            <Route path="exams" element={session.role === "student" ? <CandidateDashboard session={session} /> : <Exams session={session} />} />
            <Route path="candidates" element={<Candidates session={session} />} />
            <Route path="verification" element={<Verification session={session} />} />
            <Route path="monitoring" element={<Monitoring session={session} />} />
            <Route path="incidents" element={<Incidents session={session} />} />
            <Route path="evidence" element={(["institute_admin", "teacher", "proctor"].includes(session.role)) ? <EvidenceCenter session={session} /> : <Navigate to="/app" replace />} />
            <Route path="reports" element={<Reports session={session} />} />
            <Route path="account" element={<AccountPage session={session} onSignOut={() => { clear(); navigate("/login", { replace: true }); }} />} />
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
function ReadinessChecks({ onStart, error }: { onStart: () => void; error: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const meterFrame = useRef<number | null>(null);
  const [camera, setCamera] = useState("Not checked");
  const [microphone, setMicrophone] = useState("Not checked");
  const [level, setLevel] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [practiceCompleted, setPracticeCompleted] = useState(false);
  const [screen, setScreen] = useState("Not enabled");
  const screenStream = useRef<MediaStream | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [companionStatus, setCompanionStatus] = useState("Checking local Windows Companion…");
  const [companionReady, setCompanionReady] = useState(false);
  const [aiStatus, setAiStatus] = useState("Checking local AI service…");
  const [aiReady, setAiReady] = useState(false);
  const [monitoringConsent, setMonitoringConsent] = useState(false);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const online = typeof navigator !== "undefined" && navigator.onLine;
  const stopCamera = () => {
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    delete (window as any).__examguardCameraStream;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera("Not checked");
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
  };
  const stopScreen = () => {
    screenStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current = null;
    setScreen("Not enabled");
  };
  useEffect(() => () => { stopMicrophone(); stopScreen(); }, []);
  useEffect(() => { const update = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener("fullscreenchange", update); return () => document.removeEventListener("fullscreenchange", update); }, []);
  useEffect(() => {
    let active = true;
    const checkServices = async () => {
      try {
        const response = await fetch("http://127.0.0.1:43117/health", { cache: "no-store", signal: AbortSignal.timeout(1500) });
        const health = await response.json();
        if (!active) return;
        const ready = response.ok && health.status === "ready";
        setCompanionReady(ready);
        setCompanionStatus(ready ? "Connected locally and ready" : "Companion is running but not ready");
      } catch {
        if (!active) return;
        setCompanionReady(false);
        setCompanionStatus("Not running — open ExamGuard Device Monitor");
      }
      try {
        const response = await api.get("/api/student/monitoring-readiness", { timeout: 3500 });
        if (!active) return;
        setAiReady(response.data?.ready === true);
        setAiStatus(response.data?.ready ? "All local AI models ready" : "AI models are unavailable");
      } catch (serviceError) {
        if (!active) return;
        setAiReady(false);
        setAiStatus(axios.isAxiosError(serviceError) ? (serviceError.response?.data?.error ?? "Start the local AI service") : "Start the local AI service");
      }
    };
    void checkServices();
    const interval = window.setInterval(() => void checkServices(), 4000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  const checkCamera = async () => {
    if (!supported) return setCamera("Camera unavailable: this browser does not support device access.");
    stopCamera();
    setCamera("Permission required");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStream.current = stream;
      (window as any).__examguardCameraStream = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamera("Camera ready");
    } catch (e) {
      setCamera(e instanceof DOMException && e.name === "NotAllowedError" ? "Permission denied — allow camera access in your browser settings, then try again." : "Camera unavailable — check that no other application is using it.");
    }
  };
  const checkMicrophone = async () => {
    if (!supported) return setMicrophone("Microphone unavailable: this browser does not support device access.");
    stopMicrophone();
    setMicrophone("Permission required");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      microphoneStream.current = stream;
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
      const enableScreen = async () => {
        if (!navigator.mediaDevices?.getDisplayMedia) return setScreen("Screen sharing is not supported by this browser.");
        stopScreen();
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          screenStream.current = stream;
          (window as any).__examguardScreenStream = stream;
          stream.getVideoTracks()[0]?.addEventListener("ended", () => { screenStream.current = null; delete (window as any).__examguardScreenStream; setScreen("Screen sharing stopped — enable it again before starting."); });
          setScreen("Screen sharing ready");
        } catch (e) {
          setScreen(e instanceof DOMException && e.name === "NotAllowedError" ? "Screen sharing was not allowed." : "Screen sharing could not start.");
        }
      };
      updateLevel();
      setMicrophone("Microphone ready — audio is not recorded or sent.");
    } catch (e) {
      setMicrophone(e instanceof DOMException && e.name === "NotAllowedError" ? "Permission denied — allow microphone access in your browser settings, then try again." : "Microphone unavailable — check your device and browser settings.");
    }
  };
  return <div className="card max-w-2xl">
    <h2 className="text-xl font-semibold">Exam readiness check</h2>
    <p className="mt-2 text-sm text-slate-500">Camera and microphone permission must be granted before starting. The browser always asks for your consent; this readiness check does not record or upload media.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <section className="rounded-xl border border-slate-200 p-4"><b>Camera</b><p className="mt-1 text-sm text-slate-500">{camera}</p><video ref={videoRef} autoPlay muted playsInline className="mt-3 aspect-video w-full rounded-lg bg-slate-100 object-cover" aria-label="Camera preview" /> <div className="mt-3 flex gap-2"><button type="button" onClick={checkCamera} className="button">Check camera</button><button type="button" onClick={stopCamera} className="text-sm font-semibold text-slate-700">Stop camera</button></div></section>
      <section className="rounded-xl border border-slate-200 p-4"><b>Microphone</b><p className="mt-1 text-sm text-slate-500">{microphone}</p><div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-teal-600 transition-[width]" style={{ width: `${level}%` }} /></div><div className="mt-5 flex gap-2"><button type="button" onClick={checkMicrophone} className="button">Check microphone</button><button type="button" onClick={stopMicrophone} className="text-sm font-semibold text-slate-700">Stop test</button></div></section>
    </div>
    <dl className="mt-5 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Browser</dt><dd>{supported ? "Compatible" : "Limited device support"}</dd></div><div><dt className="text-slate-500">Network</dt><dd>{online ? "Connected" : "Offline — reconnect before starting"}</dd></div><div><dt className="text-slate-500">Instructions</dt><dd>{acknowledged ? "Acknowledged" : "Awaiting acknowledgement"}</dd></div><div><dt className="text-slate-500">Screen sharing</dt><dd className={screen === "Screen sharing ready" ? "text-emerald-700" : "text-red-700"}>{screen}</dd></div><div><dt className="text-slate-500">Windows Companion — required</dt><dd className={companionReady ? "text-emerald-700" : "text-red-700"}>{companionStatus}</dd></div><div className="sm:col-span-2"><dt className="text-slate-500">Local AI service — required</dt><dd className={aiReady ? "text-emerald-700" : "text-red-700"}>{aiStatus}</dd></div></dl>
    <button type="button" onClick={() => void enableScreen()} className="button mt-4">Enable screen sharing</button>
    <label className="mt-5 flex gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I have read the instructions and understand the examination rules.</label>
    <label className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6"><input type="checkbox" className="mt-1" checked={practiceCompleted} onChange={(event) => setPracticeCompleted(event.target.checked)} /><span><b>Practice check complete.</b> I have used the answer controls, checked my camera and microphone, and understand how to submit. This short readiness exercise does not submit exam answers.</span></label>
    <label className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><input type="checkbox" className="mt-1" checked={monitoringConsent} onChange={(event) => setMonitoringConsent(event.target.checked)} /><span><b>Required monitoring consent.</b> I consent to camera-frame AI analysis and to capturing still images when a repeated review signal is recorded. I also consent to Bluetooth and Wi-Fi access-point observations by the required Windows Companion. Images are stored in ExamGuard’s private evidence storage for authorized review. This local prototype does not automatically purge image files; my institution must publish and apply its retention schedule. Automated signals are review aids, not proof of misconduct; audio is not recorded or uploaded.</span></label>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    <button onClick={async () => { try { await document.documentElement.requestFullscreen?.(); } catch {} onStart(); }} disabled={!acknowledged || !practiceCompleted || !monitoringConsent || !online || !companionReady || !aiReady || camera !== "Camera ready" || !microphone.startsWith("Microphone ready") || screen !== "Screen sharing ready"} className="button mt-6 disabled:cursor-not-allowed disabled:opacity-50">Start secure exam</button>
  </div>;
}
function StudentExam({ session }: { session: Session }) {
  const { examId = "" } = useParams();
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
  const [aiStatus, setAiStatus] = useState("Starting local AI monitoring…");
  const [attentionWarning, setAttentionWarning] = useState("");
  const codingPersistence = useMemo(() => ({
    available: Boolean(payload?.attempt?.id),
    save: async ({ questionId, sourceCode }: { questionId: string; languageId: string; sourceCode: string }) => {
      if (!payload?.attempt?.id) throw new Error("The active attempt is unavailable.");
      await api.put(`/api/student/attempts/${payload.attempt.id}/answers/${questionId}`, { value: sourceCode });
    },
  }), [payload?.attempt?.id]);
  useEffect(() => () => {
    const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
    stream?.getTracks().forEach((track) => track.stop());
    delete (window as any).__examguardCameraStream;
  }, []);
  const captureFrameBlob = async () => {
    const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
    if (!stream?.active) return null;
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || 640;
    const scale = Math.min(1, 1280 / sourceWidth);
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 480) * scale));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause(); video.srcObject = null;
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  };
  const captureScreenBlob = async () => {
    const stream = (window as any).__examguardScreenStream as MediaStream | undefined;
    if (!stream?.active) return null;
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || 1280;
    const scale = Math.min(1, 1600 / sourceWidth);
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 900) * scale));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause(); video.srcObject = null;
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.65));
  };
  const captureEvidence = async () => {
    const blob = await captureFrameBlob();
    if (!blob) return undefined;
    const form = new FormData(); form.append("file", blob, "browser-signal.jpg");
    const { data } = await api.post(`/api/student/attempts/${payload.attempt.id}/evidence`, form);
    return data.evidenceKey as string;
  };
  const start = async () => {
    try {
      const startUrl = `/api/student/organizations/${session.organization.id}/exams/${examId}/start`;
      const startBody = { monitoringConsentAccepted: true, monitoringConsentVersion: "examguard-monitoring-v1" };
      let response = await api.post(startUrl, startBody);
      let data = response.data;
      // Always renew a fresh attempt-scoped credential and complete the local
      // handshake before asking the API to release any exam questions.
      const connected = await createCompanionPairing(data.attempt.id);
      if (!connected) throw new Error("The required Windows Companion could not connect. Open the Companion and retry; the exam questions remain locked until it reports successfully.");
      response = await api.post(startUrl, startBody);
      data = response.data;
      if (data.companionRequired || !Array.isArray(data.questions)) throw new Error("The Windows Companion has not confirmed its first heartbeat yet. Retry the automatic connection.");
      // Align the countdown with the server clock so a wrong device clock cannot add or remove time.
      clockOffset.current = clockOffsetMs(response.headers?.date as string | undefined, Date.now());
      setPayload(data);
      setAnswers(Object.fromEntries(data.answers.map((answer: any) => [String(answer.questionId), answer.value])));
      setMarked(loadMarks(typeof sessionStorage === "undefined" ? undefined : sessionStorage, data.attempt.id));
      setLeft(remainingMs(data.attempt.deadlineAt, Date.now(), clockOffset.current));
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? e.response?.data?.error ?? "Unable to start exam"
          : e instanceof Error ? e.message : "Unable to start exam",
      );
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
    const report = (type: "visibility_hidden" | "fullscreen_exit", message: string) => {
      setAttentionWarning(message);
      void (async () => { let evidenceKey: string | undefined; try { evidenceKey = await captureEvidence(); } catch { /* Evidence is optional; the signal is still recorded. */ } return api.post(`/api/organizations/${session.organization.id}/proctoring/events`, {
        examId: payload.attempt.examId,
        candidateId: payload.attempt.candidateId,
        attemptId: payload.attempt.id,
        type,
        occurredAt: new Date().toISOString(),
        source: "browser",
        evidenceKey,
        details: { clientWarning: true },
      }); })().catch(() => undefined);
    };
    const reportBrowserSignal = (type: "visibility_hidden" | "window_blur" | "focus_regain" | "multiple_window_hint", message: string, details: Record<string, unknown> = {}) => {
      setAttentionWarning(message);
      void api.post(`/api/organizations/${session.organization.id}/proctoring/events`, {
        examId: payload.attempt.examId, candidateId: payload.attempt.candidateId, attemptId: payload.attempt.id,
        type, occurredAt: new Date().toISOString(), source: "browser", details: { clientWarning: true, ...details },
      }).catch(() => undefined);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        reportBrowserSignal("visibility_hidden", "Warning: you left the examination tab. Return immediately and keep this exam in focus.");
      } else if (hiddenAt !== null) {
        const hiddenDurationMs = Date.now() - hiddenAt;
        hiddenAt = null;
        reportBrowserSignal("focus_regain", "You returned to the examination tab.", { hiddenDurationMs });
      }
    };
    const fullscreen = () => { if (!document.fullscreenElement) report("fullscreen_exit", "Warning: fullscreen was exited. Return to fullscreen and remain on the examination screen."); };
    const blur = () => { blurredAt = Date.now(); reportBrowserSignal("window_blur", "Warning: the examination window lost focus. Return immediately."); };
    const focus = () => {
      if (blurredAt !== null) {
        const blurDurationMs = Date.now() - blurredAt;
        blurredAt = null;
        reportBrowserSignal("focus_regain", "The examination window regained focus.", { blurDurationMs });
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
  }, [payload, session.organization.id]);
  const save = async (questionId: string, value: unknown) => {
    // Keep what the candidate typed on screen immediately; the engine saves it (latest value only, in order, with retries).
    setAnswers((existing) => ({ ...existing, [questionId]: value }));
    setError("");
    sync.current?.set(questionId, value, { immediate: typeof value !== "string" });
  };
  const submitter = useRef<ReturnType<typeof createSubmitter> | null>(null);
  const submit = async (automatic = false) => {
    if (!payload) return;
    submitter.current ??= createSubmitter({
      flush: async () => (await sync.current?.flush()) ?? true,
      post: async () => {
        const result = (await api.post(`/api/student/attempts/${payload.attempt.id}/submit`)).data;
        // Submission is authoritative on the server; stop local radio scanning
        // immediately afterwards. This bridge endpoint is loopback + origin restricted.
        void fetch("http://127.0.0.1:43117/stop", {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(1500),
        }).catch(() => undefined);
        return result;
      },
      interpretError: (e) => { const body = axios.isAxiosError(e) ? e.response?.data : undefined; return { receiptCode: body?.receiptCode, message: body?.error }; },
    });
    setError(""); setSubmitBusy(true);
    const outcome = await submitter.current.run(automatic);
    setSubmitBusy(false);
    if (outcome.kind === "submitted" || outcome.kind === "expired" || outcome.kind === "already_submitted") {
      sync.current?.clearPersisted();
      setCompletionStatus(outcome.kind === "expired" ? "expired" : "submitted"); setReceipt(outcome.receipt); setReviewing(false);
      const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
      stream?.getTracks().forEach((track) => track.stop());
      delete (window as any).__examguardCameraStream;
      const screenStream = (window as any).__examguardScreenStream as MediaStream | undefined;
      screenStream?.getTracks().forEach((track) => track.stop());
      delete (window as any).__examguardScreenStream;
    } else if (outcome.kind === "blocked_unsaved") setError("Some answers couldn't be saved yet. Check your connection and try again. Nothing has been lost.");
    else if (outcome.kind === "error") setError(outcome.message);
  };
  const createCompanionPairing = async (attemptId = payload?.attempt?.id): Promise<boolean> => {
    if (!attemptId) return false;
    setPairingError("");
    setPairingLoading(true);
    try {
      const { data } = await api.post(`/api/student/attempts/${attemptId}/companion-pairing`);
      const bridgeResponse = await fetch("http://127.0.0.1:43117/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ apiUrl: window.location.origin, pairingToken: data.pairingToken, consentGranted: true }),
      });
      const bridgeResult = await bridgeResponse.json().catch(() => ({}));
      if (!bridgeResponse.ok || bridgeResult.status !== "connected") throw new Error(bridgeResult.error ?? "The Windows Companion did not confirm the connection.");
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
    const analyzeFrame = async () => {
      if (stopped || sending || document.visibilityState !== "visible") return;
      sending = true;
      try {
        const blob = await captureFrameBlob();
        if (!blob || stopped) return;
        const form = new FormData();
        form.append("frame", blob, "camera-frame.jpg");
        await api.post(`/api/student/attempts/${activeAttemptId}/ai-frame`, form, { timeout: 16_000 });
        if (!stopped) setAiStatus("Active — local AI frame checks are running");
      } catch (analysisError) {
        if (!stopped) {
          const message = axios.isAxiosError(analysisError) ? analysisError.response?.data?.error : undefined;
          setAiStatus(message ?? "AI monitoring temporarily unavailable — check the local service");
        }
      } finally {
        sending = false;
      }
    };
    void analyzeFrame();
    const interval = window.setInterval(() => void analyzeFrame(), 6000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [payload?.attempt?.id, receipt]);
  useEffect(() => {
    const activeAttemptId = payload?.attempt?.id;
    if (!activeAttemptId || receipt) return;
    let stopped = false;
    const capture = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const blob = await captureScreenBlob();
        if (!blob || stopped) return;
        const form = new FormData();
        form.append("file", blob, "screen-frame.jpg");
        form.append("source", "screen");
        await api.post(`/api/student/attempts/${activeAttemptId}/evidence`, form, { timeout: 16_000 });
      } catch {
        // Screen capture is a consented technical signal; the exam remains usable if storage is unavailable.
      }
    };
    void capture();
    const interval = window.setInterval(() => void capture(), 15_000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [payload?.attempt?.id, receipt]);
  useEffect(() => {
    const hasCodingQuestions = Boolean(payload?.questions?.some((item: any) => item.type === "coding"));
    if (payload && left === 0 && !hasCodingQuestions) void submit(true);
  }, [left, payload]);
  if (!payload) return <ReadinessChecks onStart={start} error={error} />;
  if (receipt)
    return (
      <div className="card max-w-xl text-center py-14">
        <ShieldCheck className="mx-auto text-emerald-600" />
        <h2 className="mt-4 text-xl font-semibold">{completionStatus === "expired" ? "Time expired" : "Submission received"}</h2>
        <p className="mt-2 text-slate-500">
          {completionStatus === "expired" ? "Your attempt was closed when the server deadline was reached." : "Your receipt code is "}<b>{receipt}</b>{completionStatus === "expired" ? "" : "."}
        </p>
      </div>
    );
  if (payload.questions?.some((item: any) => item.type === "coding")) {
    const codingQuestions = payload.questions.filter((item: any) => item.type === "coding");
    const initialCodes = Object.fromEntries(
      (payload.answers ?? [])
        .filter((answer: any) => typeof answer.value === "string")
        .map((answer: any) => {
          const question = codingQuestions.find((item: any) => item.id === answer.questionId);
          return [answer.questionId, {
            languageId: question?.coding?.languageIds?.[0] ?? "",
            sourceCode: answer.value,
          }];
        }),
    );
    return <CodingExamWorkspace
      assessment={{ title: payload.exam.title, instructions: payload.exam.instructions, deadlineAt: payload.attempt.deadlineAt }}
      attemptId={payload.attempt.id}
      questions={codingQuestions.map((item: any) => ({
        id: item.id,
        title: item.coding?.title ?? "Coding problem",
        description: item.coding?.description ?? item.prompt,
        difficulty: item.coding?.difficulty ?? "medium",
        inputFormat: item.coding?.inputFormat,
        outputFormat: item.coding?.outputFormat,
        constraints: item.coding?.constraints,
        explanation: item.coding?.explanation,
        marks: item.marks,
        languageIds: item.coding?.languageIds ?? [],
        starterCode: item.coding?.starterCode ?? {},
        samples: item.coding?.samples ?? []
      }))}
      initialCodes={initialCodes}
      persistence={codingPersistence}
      submissionError={error}
      clockOffsetMs={clockOffset.current}
      onFinishAssessment={(automatic = false) => submit(automatic)}
    />;
  }
  const question = payload.questions[current];
  const answered = (id: string) => isAnswered(answers[id]);
  return (
    <div className="mx-auto max-w-6xl">
      <div className="card mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">{payload.exam.title}</h2>
          <p className="text-sm text-slate-500">{payload.exam.instructions}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4"><span className="text-xs font-semibold text-slate-600">{pairingLoading ? "Connecting Companion…" : "Companion required"}</span><CompanionStatus attemptId={payload.attempt.id} /><span className="max-w-48 text-right text-xs text-slate-500">{aiStatus}</span><div className="flex flex-col items-end gap-1"><ExamTimer ms={left} /><SyncIndicator online={online} sync={syncSnap} /></div></div>
      </div>
      {error && !reviewing && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {attentionWarning && <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span><b>Attention required.</b> {attentionWarning}</span><button type="button" onClick={() => setAttentionWarning("")} className="font-semibold">Dismiss</button></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_250px]">
        <section className="card">
          <div className="flex items-center justify-between gap-3"><p className="font-medium">Question {current + 1} of {payload.questions.length}</p><button type="button" onClick={() => setMarked((items) => ({ ...items, [question.id]: !items[question.id] }))} aria-pressed={Boolean(marked[question.id])} className="text-sm font-semibold text-blue-700">{marked[question.id] ? "Remove review mark" : "Mark for review"}</button></div>
          <p className="mt-5 text-lg font-medium">{question.prompt}</p>
          {question.options?.length ? <div className="mt-5 space-y-3">{question.options.map((option: any) => {
            const selected = question.type === "multiple_select" ? Array.isArray(answers[question.id]) && answers[question.id].includes(option.id) : answers[question.id] === option.id;
            return <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 hover:border-blue-300" key={option.id}><input type={question.type === "multiple_select" ? "checkbox" : "radio"} name={question.id} checked={selected} onChange={(event) => { const previous = Array.isArray(answers[question.id]) ? answers[question.id] : []; const value = question.type === "multiple_select" ? (event.target.checked ? [...previous, option.id] : previous.filter((item: string) => item !== option.id)) : option.id; void save(question.id, value); }} /><span>{option.text}</span></label>;
          })}</div> : <textarea className="input mt-5 min-h-40" value={String(answers[question.id] ?? "")} onChange={(event) => void save(question.id, event.target.value)} onBlur={() => void sync.current?.flush()} placeholder="Write your answer" aria-label={`Answer for question ${current + 1}`} />}
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
                }) => (
                  <tr className="border-b last:border-0" key={e.id}>
                    <td className="py-4 font-medium">{e.title}</td>
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
          <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Assessment delivery</p><h3 className="mt-1 text-lg font-semibold">Assign candidates</h3><p className="mt-1 text-sm text-slate-500">{assignmentExam.title} · {assignmentExam.durationMinutes} minutes</p></div><button type="button" onClick={() => setAssignmentExam(null)} className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100">Close</button></div>
          <div className="mt-5 space-y-2">{candidatesLoading ? <p className="py-6 text-center text-sm text-slate-500">Loading candidates…</p> : candidatesError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Candidate records could not be loaded. <button type="button" className="ml-1 underline" onClick={() => refetchCandidates()}>Retry</button></div> : candidates.length ? candidates.map((candidate: any) => <label key={candidate.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/40"><Checkbox checked={selectedCandidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} aria-label={`Select ${candidate.name}`} /><span><span className="block text-sm font-semibold">{candidate.name}</span><span className="block text-xs text-slate-500">{candidate.email}</span></span></label>) : <p className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">Create a student account before assigning this assessment.</p>}</div>
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
                <th className="pb-2">Candidate</th>
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
                      <td className="py-3">{g.candidateId}</td>
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
  const [verificationRejectOpen, setVerificationRejectOpen] = useState(false);
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
  const reviewVerification = async (approved: boolean, reason: string): Promise<boolean> => {
    const verificationId = candidateDetails?.verification?.id;
    if (!verificationId) return false;
    setError("");
    try {
      await api.post(`/api/organizations/${session.organization.id}/verifications/${verificationId}/review`, { action: approved ? "approve" : "reject", reason });
      setNotice(approved ? "Identity verification approved." : "Identity verification rejected with the supplied reason.");
      await refetchCandidateDetails();
      return true;
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? (requestError.response?.data?.error ?? "Could not review identity verification.") : "Could not review identity verification.");
      return false;
    }
  };
  const requestVerificationReview = (approved: boolean) => {
    if (approved) void reviewVerification(true, "Approved by institute review");
    else setVerificationRejectOpen(true);
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      {canManage ? <CandidateCreateForm onCreate={add} error={error} notice={notice} /> : <section className="card h-fit"><p className="eyebrow">Candidate directory</p><h2 className="mt-1 font-semibold">Read-only access</h2><p className="mt-2 text-sm leading-6 text-slate-500">Your role can inspect candidate records but cannot create accounts or assign assessments.</p></section>}
      <div className="card min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold">Candidates</h2><p className="mt-1 text-sm text-slate-500">Select a candidate to see assignments, verification and result status.</p></div>
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
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Email status</TableHead><TableHead>Account</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {candidatesLoading ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-stone-500">Loading candidates…</TableCell></TableRow>
              : candidatesError ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-red-700">Candidate records could not be loaded. <button type="button" className="ml-2 underline" onClick={() => refetch()}>Retry</button></TableCell></TableRow>
              : data.length ? data.map((candidate: { id: string; name: string; email: string; emailVerifiedAt?: string; userId?: string }) => (
                <TableRow key={candidate.id}>
                  <TableCell className="font-semibold text-stone-900">{candidate.name}</TableCell>
                  <TableCell>{candidate.email}</TableCell>
                  <TableCell><Badge variant={candidate.emailVerifiedAt ? "success" : "muted"}>{candidate.emailVerifiedAt ? "Verified" : "Not verified"}</Badge></TableCell>
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
        {!selectedCandidateId ? <div className="py-10 text-center"><Users className="mx-auto text-blue-600" size={28}/><h2 className="mt-3 font-semibold">Candidate details</h2><p className="mt-2 text-sm leading-6 text-slate-500">Choose a candidate to inspect their real account, assessment and result details.</p></div> : detailsLoading ? <div className="h-72 animate-pulse rounded-xl bg-slate-100" /> : candidateDetails ? <CandidateDetails details={candidateDetails} exams={availableExams} onAssign={assignAssessment} onReview={requestVerificationReview} canReview={canReviewVerifications(session.role)} canAssign={canManage} onClose={() => setSelectedCandidateId("")} /> : <p className="text-sm text-red-600">Candidate details could not be loaded.</p>}
      </aside>
      <ReasonDialog
        open={verificationRejectOpen}
        title="Reject identity verification"
        maxLength={1000}
        description="Explain what needs correction so the candidate can respond. The decision is recorded for authorized reviewers."
        submitLabel="Reject verification"
        onCancel={() => setVerificationRejectOpen(false)}
        onSubmit={async (reason) => {
          const saved = await reviewVerification(false, reason);
          if (saved) setVerificationRejectOpen(false);
          return saved;
        }}
      />
    </div>
  );
}
function CandidateDetails({ details, exams, onAssign, onReview, canReview, canAssign, onClose }: { details: any; exams: any[]; onAssign: (examId: string) => void; onReview: (approved: boolean) => void; canReview: boolean; canAssign: boolean; onClose: () => void }) {
  const c = details.candidate;
  const assignedIds = new Set(details.assessments.map((item: any) => String(item.exam?.id)));
  const assignable = exams.filter((exam) => ["published", "scheduled", "live"].includes(exam.status) && !assignedIds.has(String(exam.id)));
  return <div><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Candidate profile</p><h2 className="mt-1 text-lg font-semibold">{c.name}</h2></div><button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-900">Close</button></div><dl className="mt-5 space-y-3 text-sm"><div><dt className="text-slate-500">Email</dt><dd className="mt-1 break-all font-medium">{c.email}</dd></div><div className="grid grid-cols-2 gap-3"><div><dt className="text-slate-500">Email status</dt><dd className="mt-1 font-medium">{c.emailVerifiedAt ? "Verified" : "Not verified"}</dd></div><div><dt className="text-slate-500">Exam account</dt><dd className="mt-1 font-medium">{c.accountLinked ? "Linked" : "Not linked"}</dd></div></div><div><dt className="text-slate-500">Identity verification</dt><dd className="mt-1 font-medium capitalize">{String(details.verification.status).replaceAll("_", " ")}</dd>{canReview && ["submitted", "resubmission_required"].includes(details.verification.status) && <div className="mt-3 flex gap-3"><button type="button" onClick={() => onReview(true)} className="text-sm font-semibold text-emerald-700">Approve identity</button><button type="button" onClick={() => onReview(false)} className="text-sm font-semibold text-red-700">Reject</button></div>}</div>{c.externalId && <div><dt className="text-slate-500">Candidate ID</dt><dd className="mt-1 font-medium">{c.externalId}</dd></div>}</dl><div className="mt-6 border-t pt-5"><h3 className="font-semibold">Assign an assessment</h3>{!canAssign ? <p className="mt-2 text-sm text-slate-500">Assessment assignment is restricted to institute administrators and teachers.</p> : assignable.length ? <div className="mt-3 space-y-2">{assignable.map((exam) => <button type="button" key={exam.id} onClick={() => onAssign(exam.id)} className="flex w-full items-center justify-between rounded-xl border border-blue-100 bg-blue-50 p-3 text-left text-sm hover:border-blue-300"><span><b className="block text-slate-900">{exam.title}</b><span className="text-slate-600">{exam.durationMinutes} minutes · {exam.status}</span></span><span className="font-semibold text-blue-700">Assign</span></button>)}</div> : <p className="mt-2 text-sm text-slate-500">No unassigned published assessments are available.</p>}<h3 className="mt-6 font-semibold">Assigned assessments</h3><div className="mt-3 space-y-3">{details.assessments.length ? details.assessments.map((item: any, index: number) => <article key={index} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-medium">{item.exam?.title ?? "Assessment unavailable"}</p><p className="mt-1 capitalize text-slate-500">{item.attempt?.status?.replaceAll("_", " ") ?? "Assigned — not started"}</p>{item.attempt?.receiptCode && <p className="mt-1 text-xs text-slate-500">Receipt: {item.attempt.receiptCode}</p>}{item.grade && <p className="mt-2 font-semibold text-emerald-700">Score: {item.grade.totalMarks}/{item.grade.maxMarks} · {item.grade.status}</p>}</article>) : <p className="text-sm text-slate-500">No assessments assigned yet.</p>}</div></div></div>;
}
function Verification({ session }: { session: Session }) {
  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["verification", session.organization.id],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/verifications`)
        .then((r) => r.data),
  });
  const canReview = canReviewVerifications(session.role);
  const [reviewError, setReviewError] = useState("");
  const [reviewingId, setReviewingId] = useState("");
  const [rejectionTarget, setRejectionTarget] = useState<string | null>(null);
  const review = async (id: string, action: "approve" | "reject" | "request_more_information", reason: string): Promise<boolean> => {
    if (!canReview) return false;
    setReviewError("");
    setReviewingId(id);
    try {
      await api.post(
        `/api/organizations/${session.organization.id}/verifications/${id}/review`,
        { action, reason },
      );
      await refetch();
      return true;
    } catch (error) {
      setReviewError(axios.isAxiosError(error) ? (error.response?.data?.error ?? "The verification decision could not be saved.") : "The verification decision could not be saved.");
      return false;
    } finally {
      setReviewingId("");
    }
  };
  if (isLoading)
    return <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />;
  if (isError)
    return <div className="card"><p role="alert" className="text-sm text-red-700">Verification requests could not be loaded.</p><button type="button" className="button mt-4" onClick={() => refetch()}>Retry</button></div>;
  return (
    <div className="card overflow-x-auto">
      <h2 className="font-semibold">Verification center</h2>
      <p className="mt-1 text-sm text-slate-500">
        {canReview ? "Review submitted identity evidence. Documents remain private." : "Read-only review queue. Your role can inspect verification status but cannot approve or reject requests."}
      </p>
      {reviewError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{reviewError}</p>}
      <table className="mt-5 w-full text-left text-sm">
        <thead className="border-b text-slate-500">
          <tr>
            <th className="pb-2">Candidate</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Decision</th>
          </tr>
        </thead>
        <tbody>
          {data.length ? (
            data.map((v: any) => (
              <tr className="border-b" key={v.id}>
                <td className="py-3">
                  {v.candidateId?.name ?? "Candidate"}
                  <span className="block text-xs text-slate-500">
                    {v.candidateId?.email}
                  </span>
                </td>
                <td>{v.status}</td>
                <td className="space-x-2">
                  {(v.profilePhoto || v.idDocument) && <span className="mr-2 inline-flex gap-2">
                    {v.profilePhoto && <button type="button" className="text-blue-700 underline" onClick={async () => { const response = await api.get(`/api/organizations/${session.organization.id}/verifications/${v.id}/document/photo`, { responseType: "blob" }); const url = URL.createObjectURL(response.data); window.open(url, "_blank", "noopener,noreferrer"); }}>View selfie</button>}
                    {v.idDocument && <button type="button" className="text-blue-700 underline" onClick={async () => { const response = await api.get(`/api/organizations/${session.organization.id}/verifications/${v.id}/document/idDocument`, { responseType: "blob" }); const url = URL.createObjectURL(response.data); window.open(url, "_blank", "noopener,noreferrer"); }}>View document</button>}
                  </span>}
                  {canReview && ["submitted", "resubmission_required"].includes(
                    v.status,
                  ) && (
                    <>
                      <button
                        type="button"
                        disabled={reviewingId === v.id}
                        onClick={() => void review(v.id, "approve", "Approved after review")}
                        className="text-emerald-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={reviewingId === v.id}
                        onClick={() => setRejectionTarget(v.id)}
                        className="text-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button type="button" disabled={reviewingId === v.id} onClick={() => void review(v.id, "request_more_information", "Please upload clearer or additional identity evidence.")} className="text-amber-700 disabled:opacity-50">Request more information</button>
                    </>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="py-10 text-center text-slate-500">
                No verification requests.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <ReasonDialog
        open={Boolean(rejectionTarget)}
        title="Reject identity verification"
        maxLength={1000}
        description="Provide a clear reason so the candidate understands what must be corrected. This decision is recorded for authorized reviewers."
        submitLabel="Reject verification"
        onCancel={() => setRejectionTarget(null)}
        onSubmit={async (reason) => {
          if (!rejectionTarget) return false;
          const saved = await review(rejectionTarget, false, reason);
          if (saved) setRejectionTarget(null);
          return saved;
        }}
      />
    </div>
  );
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

function Monitoring({ session }: { session: Session }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["monitoring", session.organization.id],
    queryFn: () =>
      Promise.all([
        api.get("/api/system/status"),
        api.get(
          `/api/organizations/${session.organization.id}/radio-observations`,
        ),
      ]).then(([status, radio]) => ({
        status: status.data,
        radio: radio.data,
      })),
    refetchInterval: 30000,
  });
  if (isLoading)
    return <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />;
  if (isError) return <div className="card text-center"><AlertTriangle className="mx-auto text-amber-600" size={28}/><h2 className="mt-3 font-semibold">Monitoring data is temporarily unavailable</h2><p className="mt-1 text-sm text-slate-500">The application could not load the current service or companion review status.</p><button type="button" onClick={() => refetch()} className="button mt-5">Retry</button></div>;
  const observations = data.radio.observations ?? [];
  const signals = data.radio.signals ?? [];
  const statusHelp: Record<string, string> = { healthy: "The ExamGuard API is responding.", configured_not_verified: "Credentials exist; verify the service before using it in an exam.", unconfigured: "No credentials are configured in this environment.", unavailable_no_adapter: "Email delivery adapter is not configured." };
  const statusLabel: Record<string, string> = { healthy: "Operational", configured_not_verified: "Configuration pending verification", unconfigured: "Setup required", unavailable_no_adapter: "Setup required" };
  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Operations</p><h2 className="mt-1 font-semibold">Monitoring readiness</h2><p className="mt-1 text-sm text-slate-500">Service configuration is not a claim that hardware scanning is active.</p></div><button type="button" onClick={() => refetch()} disabled={isFetching} className="text-sm font-semibold text-blue-700 disabled:text-slate-400">{isFetching ? "Refreshing…" : "Refresh status"}</button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {Object.entries(data.status).map(([name, status]) => (
            <div key={name} className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
              <p className="text-sm capitalize text-slate-500">
                {name.replace(/([A-Z])/g, " $1")}
              </p>
              <p className={`mt-1 font-medium ${status === "healthy" ? "text-emerald-700" : status === "unconfigured" || String(status).startsWith("unavailable") ? "text-amber-700" : "text-slate-800"}`}>{statusLabel[String(status)] ?? String(status).replaceAll("_", " ")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{statusHelp[String(status)] ?? "Current service status reported by the server."}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Consent-based signals</p><h2 className="mt-1 font-semibold">Radio observation review</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{observations.length} observations · {signals.length} indicators</span></div>
        <p className="mt-1 text-sm text-slate-500">
          BLE and Wi-Fi observations are evidence for human review only; they do
          not identify a phone or determine misconduct.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">
              Recent observations ({observations.length})
            </h3>
            <div className="mt-2 space-y-2">
              {observations.length ? (
                observations.slice(0, 8).map((o: any) => (
                  <div className="rounded-lg border p-3 text-sm" key={o.id}>
                    <b>{o.source.replace("_", " ")}</b> ·{" "}
                    {o.kind.replace("_", " ")}{" "}
                    {typeof o.rssi === "number" && ` · ${o.rssi} dBm`}
                    <span className="mt-1 block text-xs text-slate-500">
                      {new Date(o.observedAt).toLocaleString()} ·{" "}
                      {o.scannerStatus}
                    </span>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed p-5 text-sm text-slate-500">
                  No observations have been received from a consented companion
                  session.
                </p>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold">
              Review indicators ({signals.length})
            </h3>
            <div className="mt-2 space-y-2">
              {signals.length ? (
                signals.map((s: any) => (
                  <div className="rounded-lg border p-3 text-sm" key={s.id}>
                    <b>{s.label}</b>
                    <span className="mt-1 block text-xs text-slate-500">
                      {s.status.replaceAll("_", " ")} · {s.rule}
                    </span>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed p-5 text-sm text-slate-500">
                  No repeated-observation indicators require review.
                </p>
              )}
            </div>
          </div>
        </div>
        {!observations.length && <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-600"><b className="text-slate-800">How to activate companion monitoring:</b> the student starts an assessment after the locally installed Windows Companion is running. ExamGuard authenticates the active attempt and connects the Companion automatically after the student accepts monitoring consent. No manual token entry is required.</div>}
      </div>
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
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-4xl">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 font-bold">
          <span className="rounded-lg bg-blue-600 p-2 text-white"><ShieldCheck size={18} /></span>
          ExamGuard
        </button>
        <section className="mt-12 rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/60 md:p-10">
          <p className="eyebrow">Secure access</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Choose your workspace</h1>
          <p className="mt-3 max-w-2xl text-slate-600">Students take assigned assessments in a focused workspace. Institute teams manage candidates, assessments and results separately.</p>
          {sessionExpired && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Your session expired. Sign in again to continue.</p>}
          {oauthError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{oauthError}</p>}
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <button onClick={() => navigate("/student/login")} className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-left transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md">
              <GraduationCap className="text-blue-700" size={30} />
              <h2 className="mt-4 text-lg font-semibold">Student login</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">See your assigned exams, take an assessment, and view released results.</p>
              <span className="mt-5 inline-block text-sm font-semibold text-blue-700">Open student workspace →</span>
            </button>
            <button onClick={() => navigate("/institute/login")} className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-left transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md">
              <Building2 className="text-slate-800" size={30} />
              <h2 className="mt-4 text-lg font-semibold">Institute login</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">For administrators, teachers and proctors who create and manage assessments.</p>
              <span className="mt-5 inline-block text-sm font-semibold text-slate-800">Open institute workspace →</span>
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
function PortalLogin({ portal, onSave }: { portal: "student" | "institute"; onSave: (session: Session) => void }) {
  const navigate = useNavigate();
  const student = portal === "student";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
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
      const correctWorkspace = student ? data.role === "student" : data.role !== "student";
      if (!correctWorkspace) {
        setError(student ? "This is an institute account. Please use Institute login." : "This is a student account. Please use Student login.");
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
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-md">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 font-bold">
          <span className="rounded-lg bg-blue-600 p-2 text-white"><ShieldCheck size={18} /></span>
          ExamGuard
        </button>
        <section className="mt-10 rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/60">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">{student ? <GraduationCap size={23} /> : <Building2 size={22} />}</div>
          <p className="eyebrow mt-5">{student ? "Candidate workspace" : "Institute workspace"}</p>
          <h1 className="mt-2 text-2xl font-bold">{student ? "Student sign in" : "Institute sign in"}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{student ? "Use the email and password provided by your institute." : "For institute administrators, teachers and proctors."}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-medium">Email<input className="input mt-1" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="name@example.edu" required /></label>
            <label className="block text-sm font-medium">Password<input className="input mt-1" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button disabled={loading} className="button w-full disabled:opacity-60">{loading ? "Signing in…" : student ? "Open student workspace" : "Open institute workspace"}</button>
          </form>
          <div className="mt-5 flex items-center justify-between text-sm">
            <button onClick={() => navigate("/forgot-password")} className="font-medium text-blue-700 hover:underline">Forgot password?</button>
            <button onClick={() => navigate(`/${otherPortal}/login`)} className="font-medium text-blue-700 hover:underline">Use {student ? "Institute" : "Student"} login</button>
          </div>
        </section>
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
      <Route path="/register" element={<Auth register onSave={s.save} />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
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
            ["student", "institute_admin", "teacher", "proctor"].includes(s.session.role)
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
