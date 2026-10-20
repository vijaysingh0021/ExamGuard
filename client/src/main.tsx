// @ts-nocheck -- this legacy single-file workspace is incrementally typed; component routes are verified in production build.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import axios from "axios";
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
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Monitor,
  Plus,
  Settings,
  ShieldCheck,
  MapPin,
  Search,
  RefreshCw,
  Users,
} from "lucide-react";
import { ForgotPasswordPage, ResetPasswordPage } from "./auth-pages";
import { Landing } from "./marketing";
import "./index.css";
type Session = {
  token: string;
  user: { name: string; email: string };
  organization: { id: string; name: string };
  role: string;
};
import { ExamBuilder } from "./exam-builder";
const api = axios.create();
api.interceptors.request.use((c) => {
  const raw = localStorage.getItem("sentinel-session");
  if (raw) c.headers.Authorization = `Bearer ${JSON.parse(raw).token}`;
  return c;
});
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
  { label: "Results & reports", icon: BarChart3, path: "/app/reports" },
  { label: "Organization settings", icon: Settings, path: "/app/settings" },
];
function useSession() {
  const [session, setSession] = useState<Session | null>(() => {
    const x = localStorage.getItem("sentinel-session");
    return x ? JSON.parse(x) : null;
  });
  const save = (s: Session) => {
    localStorage.setItem("sentinel-session", JSON.stringify(s));
    setSession(s);
  };
  return {
    session,
    save,
    clear: () => {
      localStorage.removeItem("sentinel-session");
      setSession(null);
    },
  };
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
function StudentEntry() {
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
      const { data } = await api.get(
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
      const { data } = await api.get("/api/public/institutions/search", {
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
      const { data } = await api.post("/api/public/institution-requests", {
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
      const { data } = await api.post(
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
  const workspaceNav = session.role === "student"
    ? [{ label: "My assessments", icon: BookOpen, path: "/app" }]
    : nav;
  return (
    <div className="app-surface min-h-screen overflow-x-hidden bg-slate-50 md:flex">
      <aside className="workspace-sidebar w-full shrink-0 p-4 text-white md:min-h-screen md:w-72">
        <div className="mb-8 flex items-center gap-3 px-2 pt-1 font-bold">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-lg shadow-blue-950/30"><ShieldCheck size={20} /></span>
          <span><span className="block text-[15px] tracking-tight">ExamGuard</span><span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[.18em] text-blue-300">Assessment cloud</span></span>
        </div>
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">Workspace</p>
        <nav className="space-y-1">
          {workspaceNav.map((n) => {
            const Icon = n.icon;
            const active = n.path === "/app" ? location.pathname === "/app" || location.pathname === "/app/" : location.pathname.startsWith(n.path);
            return (
              <button
                key={n.path}
                onClick={() => navigate(n.path)}
                className={`workspace-nav-item w-full ${active ? "workspace-nav-item-active" : ""}`}
              >
                <Icon size={17} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <button
          onClick={() => {
            clear();
            navigate("/login");
          }}
          className="workspace-nav-item mt-10 w-full"
        >
          <LogOut size={17} />
          Sign out
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-5 md:p-8 lg:p-10">
        <div className="workspace-topbar mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[.14em] text-slate-500">
              {session.organization.name}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
              Good to see you, {session.user.name.split(" ")[0]}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />{" "}
            {session.role.replace("_", " ")}
          </div>
        </div>
        <Routes>
          <Route index element={<Dashboard session={session} />} />
          <Route path="exams" element={session.role === "student" ? <CandidateDashboard session={session} /> : <Exams session={session} />} />
          <Route path="candidates" element={<Candidates session={session} />} />
          <Route
            path="verification"
            element={<Verification session={session} />}
          />
          <Route path="monitoring" element={<Monitoring session={session} />} />
          <Route path="incidents" element={<Incidents session={session} />} />
          <Route
            path="take/:examId"
            element={<StudentExam session={session} />}
          />
          <Route path="reports" element={<Reports session={session} />} />
          {nav
            .slice(2)
            .filter(
              (n) =>
                ![
                  "/app/candidates",
                  "/app/verification",
                  "/app/monitoring",
                  "/app/incidents",
                  "/app/reports",
                ].includes(n.path),
            )
            .map((n) => (
              <Route
                key={n.path}
                path={n.path.replace("/app/", "")}
                element={<Placeholder title={n.label} icon={n.icon} />}
              />
            ))}
          <Route path="*" element={<Navigate to="/app" />} />
        </Routes>
      </main>
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
  const [fullscreen, setFullscreen] = useState(false);
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
  useEffect(() => () => { stopMicrophone(); }, []);
  useEffect(() => { const update = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener("fullscreenchange", update); return () => document.removeEventListener("fullscreenchange", update); }, []);
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
    <dl className="mt-5 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Browser</dt><dd>{supported ? "Compatible" : "Limited device support"}</dd></div><div><dt className="text-slate-500">Network</dt><dd>{online ? "Connected" : "Offline — reconnect before starting"}</dd></div><div><dt className="text-slate-500">Instructions</dt><dd>{acknowledged ? "Acknowledged" : "Awaiting acknowledgement"}</dd></div><div><dt className="text-slate-500">Windows companion</dt><dd>Optional — pair after starting</dd></div></dl>
    <label className="mt-5 flex gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I have read the instructions and understand the examination rules.</label>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    <button onClick={async () => { try { await document.documentElement.requestFullscreen?.(); } catch {} onStart(); }} disabled={!acknowledged || !online || camera !== "Camera ready" || !microphone.startsWith("Microphone ready")} className="button mt-6 disabled:cursor-not-allowed disabled:opacity-50">Start secure exam</button>
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
  const [saveState, setSaveState] = useState("All changes saved");
  const [reviewing, setReviewing] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingToken, setPairingToken] = useState("");
  const [pairingError, setPairingError] = useState("");
  const [pairingLoading, setPairingLoading] = useState(false);
  const [attentionWarning, setAttentionWarning] = useState("");
  const submitting = useRef(false);
  useEffect(() => () => {
    const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
    stream?.getTracks().forEach((track) => track.stop());
    delete (window as any).__examguardCameraStream;
  }, []);
  const captureEvidence = async () => {
    const stream = (window as any).__examguardCameraStream as MediaStream | undefined;
    if (!stream?.active) return undefined;
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause(); video.srcObject = null;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) return undefined;
    const form = new FormData(); form.append("file", blob, "browser-signal.jpg");
    const { data } = await api.post(`/api/student/attempts/${payload.attempt.id}/evidence`, form);
    return data.evidenceKey as string;
  };
  const start = async () => {
    try {
      const { data } = await api.post(
        `/api/student/organizations/${session.organization.id}/exams/${examId}/start`,
        {},
      );
      setPayload(data);
      setAnswers(Object.fromEntries(data.answers.map((answer: any) => [String(answer.questionId), answer.value])));
      setLeft(
        Math.max(0, new Date(data.attempt.deadlineAt).getTime() - Date.now()),
      );
      void createCompanionPairing(data.attempt.id);
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? e.response?.data?.error
          : "Unable to start exam",
      );
    }
  };
  useEffect(() => {
    if (!payload) return;
    const id = setInterval(
      () =>
        setLeft(
          Math.max(
            0,
            new Date(payload.attempt.deadlineAt).getTime() - Date.now(),
          ),
        ),
      1000,
    );
    return () => clearInterval(id);
  }, [payload]);
  useEffect(() => {
    if (!payload) return;
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
    const visibility = () => { if (document.visibilityState === "hidden") report("visibility_hidden", "Warning: you left the examination tab. Return immediately and keep this exam in focus."); };
    const fullscreen = () => { if (!document.fullscreenElement) report("fullscreen_exit", "Warning: fullscreen was exited. Return to fullscreen and remain on the examination screen."); };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "Your examination is still in progress."; };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", fullscreen);
    window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("visibilitychange", visibility); document.removeEventListener("fullscreenchange", fullscreen); window.removeEventListener("beforeunload", unload); };
  }, [payload, session.organization.id]);
  const save = async (questionId: string, value: unknown) => {
    setAnswers((existing) => ({ ...existing, [questionId]: value }));
    setSaveState("Saving…");
    setError("");
    try {
      await api.put(`/api/student/attempts/${payload.attempt.id}/answers/${questionId}`, { value });
      setSaveState("All changes saved");
    } catch (e) {
      setSaveState("Save failed");
      setError(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Autosave paused. Reconnect to continue.") : "Autosave paused. Reconnect to continue.");
    }
  };
  const submit = async (automatic = false) => {
    if (submitting.current) return;
    if (!automatic && !window.confirm("Submit this examination? You will not be able to change answers afterwards.")) return;
    submitting.current = true;
    setError("");
    try {
      const { data } = await api.post(`/api/student/attempts/${payload.attempt.id}/submit`);
      setCompletionStatus(data.status === "expired" ? "expired" : "submitted");
      setReceipt(data.receiptCode ?? "Submission processed");
    } catch (e) {
      const response = axios.isAxiosError(e) ? e.response?.data : undefined;
      if (response?.receiptCode) {
        setCompletionStatus("submitted");
        setReceipt(response.receiptCode);
      }
      else setError(response?.error ?? "Submission could not be confirmed. Please try again.");
      submitting.current = false;
    }
  };
  const createCompanionPairing = async (attemptId = payload?.attempt?.id) => {
    if (!attemptId) return;
    setPairingError("");
    setPairingLoading(true);
    try {
      const { data } = await api.post(`/api/student/attempts/${attemptId}/companion-pairing`);
      setPairingToken(data.pairingToken);
      setPairingOpen(true);
    } catch (requestError) {
      setPairingError(axios.isAxiosError(requestError) ? (requestError.response?.data?.error ?? "Could not create a companion pairing token.") : "Could not create a companion pairing token.");
    } finally {
      setPairingLoading(false);
    }
  };
  useEffect(() => {
    if (payload && left === 0) void submit(true);
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
  const question = payload.questions[current];
  const answered = (id: string) => {
    const value = answers[id];
    return Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : value != null;
  };
  return (
    <div className="mx-auto max-w-6xl">
      <div className="card mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">{payload.exam.title}</h2>
          <p className="text-sm text-slate-500">{payload.exam.instructions}</p>
        </div>
        <div className="flex items-center gap-4"><button type="button" onClick={() => void createCompanionPairing()} disabled={pairingLoading} className="text-sm font-semibold text-blue-700 disabled:text-slate-400">{pairingLoading ? "Creating pairing…" : "Pair Windows companion"}</button><div className="text-right"><b className="text-blue-700">{Math.ceil(left / 60000)} min left</b><p className="text-xs text-slate-500">{saveState}</p></div></div>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {attentionWarning && <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span><b>Attention required.</b> {attentionWarning}</span><button type="button" onClick={() => setAttentionWarning("")} className="font-semibold">Dismiss</button></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_250px]">
        <section className="card">
          <div className="flex items-center justify-between gap-3"><p className="font-medium">Question {current + 1} of {payload.questions.length}</p><button type="button" onClick={() => setMarked((items) => ({ ...items, [question._id]: !items[question._id] }))} className="text-sm font-semibold text-blue-700">{marked[question._id] ? "Remove review mark" : "Mark for review"}</button></div>
          <p className="mt-5 text-lg font-medium">{question.prompt}</p>
          {question.options?.length ? <div className="mt-5 space-y-3">{question.options.map((option: any) => {
            const selected = question.type === "multiple_select" ? Array.isArray(answers[question._id]) && answers[question._id].includes(option.id) : answers[question._id] === option.id;
            return <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 hover:border-blue-300" key={option.id}><input type={question.type === "multiple_select" ? "checkbox" : "radio"} name={question._id} checked={selected} onChange={(event) => { const previous = Array.isArray(answers[question._id]) ? answers[question._id] : []; const value = question.type === "multiple_select" ? (event.target.checked ? [...previous, option.id] : previous.filter((item: string) => item !== option.id)) : option.id; void save(question._id, value); }} /><span>{option.text}</span></label>;
          })}</div> : <textarea className="input mt-5 min-h-40" value={String(answers[question._id] ?? "")} onChange={(event) => setAnswers((items) => ({ ...items, [question._id]: event.target.value }))} onBlur={(event) => void save(question._id, event.target.value)} placeholder="Write your answer" />}
          <div className="mt-7 flex justify-between"><button type="button" disabled={current === 0} onClick={() => setCurrent((value) => value - 1)} className="button disabled:opacity-50">Previous</button><button type="button" disabled={current === payload.questions.length - 1} onClick={() => setCurrent((value) => value + 1)} className="button disabled:opacity-50">Next</button></div>
        </section>
        <aside className="card h-fit"><div className="flex items-center justify-between"><h3 className="font-semibold">Question palette</h3><button type="button" onClick={() => setReviewing(true)} className="text-sm font-semibold text-blue-700">Review</button></div><div className="mt-4 grid grid-cols-5 gap-2">{payload.questions.map((item: any, index: number) => <button type="button" key={item._id} onClick={() => setCurrent(index)} aria-label={`Question ${index + 1}`} className={`rounded-lg p-2 text-sm font-semibold ${index === current ? "bg-blue-600 text-white" : marked[item._id] ? "bg-amber-100 text-amber-800" : answered(item._id) ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{index + 1}</button>)}</div><p className="mt-4 text-xs text-slate-500">Blue: current · green: answered · amber: marked for review</p><button type="button" onClick={() => void submit()} className="button mt-5 w-full">Submit exam</button></aside>
      </div>
      {reviewing && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4"><div className="card w-full max-w-lg"><h3 className="font-semibold">Submission review</h3><p className="mt-2 text-sm text-slate-500">{payload.questions.filter((item: any) => answered(item._id)).length} of {payload.questions.length} questions answered. {Object.values(marked).filter(Boolean).length} marked for review.</p><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setReviewing(false)} className="text-sm font-semibold text-slate-700">Continue editing</button><button type="button" onClick={() => { setReviewing(false); void submit(); }} className="button">Confirm submission</button></div></div></div>}
      {pairingError && <p role="alert" className="mt-3 text-sm text-red-600">{pairingError}</p>}
      {pairingOpen && <div role="dialog" aria-modal="true" aria-label="Windows companion pairing" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"><div className="card w-full max-w-xl"><p className="eyebrow">Optional device monitor</p><h3 className="mt-1 text-lg font-semibold">Pair Windows companion</h3><p className="mt-2 text-sm leading-6 text-slate-600">Open ExamGuard Device Monitor on this Windows laptop, set its API URL to this ExamGuard API, paste this short-lived token, and select <b>Verify pairing</b>. It expires in 10 minutes and works only for this active attempt.</p><label className="mt-5 block text-sm font-medium">Short-lived pairing token<textarea readOnly value={pairingToken} className="input mt-1 min-h-24 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} /></label><p className="mt-3 text-xs leading-5 text-slate-500">The companion asks for consent before Bluetooth/Wi-Fi scanning. It sends session-pseudonymized observations for human review; it cannot automatically grade or penalize this attempt.</p><div className="mt-5 flex justify-end"><button type="button" onClick={() => { setPairingOpen(false); setPairingToken(""); }} className="button">Done</button></div></div></div>}
    </div>
  );
}
function Dashboard({ session }: { session: Session }) {
  const navigate = useNavigate();
  if (session.role === "student") return <CandidateDashboard session={session} />;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/dashboard`)
        .then((r) => r.data),
  });
  if (isLoading)
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((x) => (
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
        <h2 className="mt-3 font-semibold">We couldn’t load the workspace</h2>
        <p className="mt-1 text-sm text-slate-500">
          Check your connection, then refresh.
        </p>
      </div>
    );
  const cards = [
    ["Examinations", data.stats.exams, BookOpen],
    ["Candidates", data.stats.candidates, Users],
    ["Pending verification", data.stats.verificationPending, ClipboardCheck],
    ["Open incidents", data.stats.openIncidents, AlertTriangle],
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, Icon]) => {
          const I = Icon as typeof Activity;
          return (
            <button type="button" onClick={() => navigate(label === "Examinations" ? "/app/exams" : label === "Candidates" ? "/app/candidates" : label === "Pending verification" ? "/app/verification" : "/app/incidents")} className="dashboard-stat card text-left" key={String(label)}>
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">{String(label)}</span>
                <I size={18} className="text-blue-600" />
              </div>
              <p className="mt-4 text-3xl font-semibold">{String(value)}</p>
              <span className="mt-2 block text-xs font-semibold text-blue-700">Open workspace →</span>
            </button>
          );
        })}
      </div>
      <div className="card mt-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Priority review queue</h2>
            <p className="text-sm text-slate-500">
              Recent integrity events requiring attention.
            </p>
          </div>
          <button type="button" onClick={() => navigate("/app/incidents")} className="text-sm font-medium text-blue-600 hover:text-blue-800">
            View all
          </button>
        </div>
        {data.incidents.length ? (
          <div className="space-y-2">
            {data.incidents.map(
              (i: {
                _id: string;
                type: string;
                severity: string;
                createdAt: string;
              }) => (
                <div
                  className="flex items-center justify-between rounded-lg bg-slate-50 p-3"
                  key={i._id}
                >
                  <span className="font-medium">{i.type}</span>
                  <span className="text-xs text-slate-500">
                    {i.severity} priority
                  </span>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <ShieldCheck className="mx-auto text-emerald-500" />
            <p className="mt-3 font-medium">Nothing needs review</p>
            <p className="text-sm text-slate-500">
              New integrity events will appear here.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
function CandidateDashboard({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["candidate-dashboard"],
    queryFn: () => api.get("/api/student/dashboard").then((response) => response.data),
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />;
  if (isError) return <div className="card text-center"><AlertTriangle className="mx-auto text-red-500" /><h2 className="mt-3 font-semibold">Your assessments could not be loaded</h2><p className="mt-1 text-sm text-slate-500">Contact your examination administrator.</p></div>;

  const assignments = data.assignments ?? [];
  const verification = data.verification ?? { status: "not_submitted" };
  const verificationRequired = assignments.some((item: any) => item.exam?.requireVerification);
  const submitVerification = async () => {
    setSubmitting(true); setError(""); setNotice("");
    try {
      await api.post(`/api/organizations/${session.organization.id}/candidates/${data.candidate.id}/verification`);
      setNotice("Identity verification submitted. Your institute must approve it before you can start this assessment.");
      await refetch();
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? (requestError.response?.data?.error ?? "Could not submit identity verification.") : "Could not submit identity verification.");
    } finally { setSubmitting(false); }
  };

  return <div className="mx-auto max-w-5xl space-y-5">
    <div className="card bg-gradient-to-br from-white to-blue-50"><p className="eyebrow">Candidate workspace</p><h2 className="mt-1 text-2xl font-semibold">Your assessments</h2><p className="mt-2 text-sm text-slate-500">Start only during the published assessment window.</p></div>
    {verificationRequired && <section className="card border-amber-200 bg-amber-50/60"><h3 className="font-semibold">Identity verification</h3><p className="mt-1 text-sm text-slate-600">Status: <b className="capitalize">{String(verification.status).replaceAll("_", " ")}</b>{verification.rejectionReason ? ` — ${verification.rejectionReason}` : ""}</p>{verification.status === "approved" ? <p className="mt-3 text-sm text-emerald-700">Approved. You can start protected assessments during their availability window.</p> : verification.status === "submitted" ? <p className="mt-3 text-sm text-amber-800">Your request is awaiting review by your institute.</p> : <button type="button" onClick={() => void submitVerification()} disabled={submitting} className="button mt-4 disabled:opacity-60">{submitting ? "Submitting…" : verification.status === "resubmission_required" ? "Resubmit identity verification" : "Submit identity verification"}</button>}{notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</section>}
    <section className="card"><h3 className="font-semibold">Assigned assessments</h3><div className="mt-4 space-y-3">{assignments.length ? assignments.map((item: any) => { const exam = item.exam; const attempt = item.attempt; const now = Date.now(); const startsAt = exam?.startsAt ? new Date(exam.startsAt).getTime() : 0; const endsAt = exam?.endsAt ? new Date(exam.endsAt).getTime() : Number.MAX_SAFE_INTEGER; const available = ["published", "scheduled", "live"].includes(exam?.status) && now >= startsAt && now < endsAt && !["submitted", "expired", "terminated"].includes(attempt?.status); return <article key={item.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{exam?.title ?? "Assessment unavailable"}</p><p className="mt-1 text-sm text-slate-500">{exam?.durationMinutes ?? "—"} minutes · {attempt?.status?.replaceAll("_", " ") ?? (available ? "Available" : "Scheduled")}</p></div>{available ? <button type="button" onClick={() => navigate(`/app/take/${exam._id}`)} className="button">{attempt ? "Resume assessment" : "Start readiness"}</button> : <span className="text-sm text-slate-500">{attempt?.receiptCode ? `Receipt: ${attempt.receiptCode}` : "Not currently available"}</span>}</article>; }) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No assessments have been assigned to you yet.</p>}</div></section>
  </div>;
}
/* Legacy dashboard retained temporarily below for reference while the candidate
   verification workflow is migrated to the implementation above.
function LegacyCandidateDashboard({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["candidate-dashboard"],
    queryFn: () => api.get("/api/student/dashboard").then((response) => response.data),
  });
  if (isLoading) return <div className="grid gap-4 sm:grid-cols-2"><div className="h-40 animate-pulse rounded-2xl bg-slate-200" /><div className="h-40 animate-pulse rounded-2xl bg-slate-200" /></div>;
  if (isError) return <div className="card text-center"><AlertTriangle className="mx-auto text-red-500" /><h2 className="mt-3 font-semibold">Your assessments could not be loaded</h2><p className="mt-1 text-sm text-slate-500">Your account needs an assigned candidate record. Contact your examination administrator.</p></div>;
  const now = Date.now();
  const assigned = data.assignments ?? [];
  return <div className="mx-auto max-w-5xl space-y-5"><div className="card bg-gradient-to-br from-white to-blue-50"><p className="eyebrow">Candidate workspace</p><h2 className="mt-1 text-2xl font-semibold">Your assessments</h2><p className="mt-2 text-sm text-slate-500">Start only during the published assessment window. Your saved progress is restored when you return to an open attempt.</p></div><section className="card"><h3 className="font-semibold">Assigned assessments</h3><div className="mt-4 space-y-3">{assigned.length ? assigned.map((item: any) => { const exam = item.exam; const attempt = item.attempt; const startsAt = exam?.startsAt ? new Date(exam.startsAt).getTime() : 0; const endsAt = exam?.endsAt ? new Date(exam.endsAt).getTime() : Number.MAX_SAFE_INTEGER; const available = ["published", "scheduled", "live"].includes(exam?.status) && now >= startsAt && now < endsAt && !["submitted", "expired", "terminated"].includes(attempt?.status); return <article key={item.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{exam?.title ?? "Assessment unavailable"}</p><p className="mt-1 text-sm text-slate-500">{exam?.durationMinutes ?? "—"} minutes · {attempt?.status?.replaceAll("_", " ") ?? (available ? "Available" : "Scheduled")}</p>{exam?.startsAt && <p className="mt-1 text-xs text-slate-500">Starts {new Date(exam.startsAt).toLocaleString()}</p>}</div>{available ? <button type="button" onClick={() => navigate(`/app/take/${exam._id}`)} className="button">{attempt ? "Resume assessment" : "Start readiness"}</button> : <span className="text-sm text-slate-500">{attempt?.receiptCode ? `Receipt: ${attempt.receiptCode}` : "Not currently available"}</span>}</article>; }) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No assessments have been assigned to you yet.</p>}</div></section><section className="card"><h3 className="font-semibold">Released results</h3><div className="mt-4 space-y-2">{assigned.filter((item: any) => item.grade).length ? assigned.filter((item: any) => item.grade).map((item: any) => <div key={item.id} className="flex justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>{item.exam?.title}</span><span className="font-semibold">{item.grade.totalMarks}/{item.grade.maxMarks}</span></div>) : <p className="text-sm text-slate-500">Results appear here only after your organization releases them.</p>}</div></section></div>;
}
}
*/
function Exams({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery({
    queryKey: ["exams"],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/exams`)
        .then((r) => r.data),
  });
  const { data: candidates = [] } = useQuery({
    queryKey: ["exam-assignment-candidates", session.organization.id],
    queryFn: () => api.get(`/api/organizations/${session.organization.id}/candidates`).then((response) => response.data),
  });
  const [assignmentExam, setAssignmentExam] = useState<any>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const [assigning, setAssigning] = useState(false);
  const openAssignment = (exam: any) => {
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
      await Promise.all(selectedCandidateIds.map((candidateId) => api.post(`/api/organizations/${session.organization.id}/exams/${assignmentExam._id}/assignments`, { candidateId })));
      setAssignmentNotice(`${selectedCandidateIds.length} student${selectedCandidateIds.length === 1 ? "" : "s"} assigned successfully.`);
      setSelectedCandidateIds([]);
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
        <button onClick={() => navigate("/app/exam-builder")} className="button">
          <Plus size={16} /> New examination
        </button>
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
              <tr>
                <td className="py-8 text-slate-500" colSpan={3}>
                  Loading assessments…
                </td>
              </tr>
            ) : data.length ? (
              data.map(
                (e: {
                  _id: string;
                  title: string;
                  status: string;
                  durationMinutes: number;
                }) => (
                  <tr className="border-b last:border-0" key={e._id}>
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
                        <button
                          type="button"
                          disabled={e.status !== "draft"}
                          onClick={() => navigate(`/app/exam-builder/${e._id}`)}
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
                      </div>
                    </td>
                  </tr>
                ),
              )
            ) : (
              <tr>
                <td className="py-12 text-center text-slate-500" colSpan={4}>
                  No examinations yet. Create your first assessment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {assignmentExam && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Assign assessment">
        <section className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Assessment delivery</p><h3 className="mt-1 text-lg font-semibold">Assign candidates</h3><p className="mt-1 text-sm text-slate-500">{assignmentExam.title} · {assignmentExam.durationMinutes} minutes</p></div><button type="button" onClick={() => setAssignmentExam(null)} className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100">Close</button></div>
          <div className="mt-5 space-y-2">{candidates.length ? candidates.map((candidate: any) => <label key={candidate._id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/40"><input type="checkbox" checked={selectedCandidateIds.includes(candidate._id)} onChange={() => toggleCandidate(candidate._id)} className="h-4 w-4 rounded border-slate-300 text-blue-600" /><span><span className="block text-sm font-semibold">{candidate.name}</span><span className="block text-xs text-slate-500">{candidate.email}</span></span></label>) : <p className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">Create a student account before assigning this assessment.</p>}</div>
          {assignmentError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{assignmentError}</p>}
          {assignmentNotice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{assignmentNotice}</p>}
          <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setAssignmentExam(null)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" disabled={assigning || !candidates.length} onClick={assignSelected} className="button">{assigning ? "Assigning…" : `Assign selected (${selectedCandidateIds.length})`}</button></div>
        </section>
      </div>}
    </div>
  );
}
function Reports({ session }: { session: Session }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["reports"],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/reports/summary`)
        .then((r) => r.data),
  });
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
        <a
          className="button"
          href={`/api/organizations/${session.organization.id}/reports/export.csv`}
        >
          Export CSV
        </a>
      </div>
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
function Candidates({ session }: { session: Session }) {
  const { data = [], refetch } = useQuery({
    queryKey: ["candidates"],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/candidates`)
        .then((r) => r.data),
  });
  const { data: availableExams = [] } = useQuery({
    queryKey: ["assignable-exams", session.organization.id],
    queryFn: () => api.get(`/api/organizations/${session.organization.id}/exams`).then((response) => response.data),
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const { data: candidateDetails, isLoading: detailsLoading, refetch: refetchCandidateDetails } = useQuery({
    queryKey: ["candidate-details", selectedCandidateId],
    enabled: Boolean(selectedCandidateId),
    queryFn: () => api.get(`/api/organizations/${session.organization.id}/candidates/${selectedCandidateId}`).then((response) => response.data),
  });
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (initialPassword !== confirmPassword) {
      setError("The two password entries do not match.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await api.post(
        `/api/organizations/${session.organization.id}/candidates`,
        { name, email, initialPassword },
      );
      setName("");
      setEmail("");
      setInitialPassword("");
      setConfirmPassword("");
      setNotice("Student account created. Share the initial password with the student through a secure channel.");
      refetch();
    } catch (e) {
      setError(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Could not create the student account.") : "Could not create the student account.");
    }
  };
  const assignAssessment = async (examId: string) => {
    if (!selectedCandidateId) return;
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
  const reviewVerification = async (approved: boolean) => {
    const verificationId = candidateDetails?.verification?._id;
    if (!verificationId) return;
    const reason = approved ? "Approved by institute review" : window.prompt("Enter the rejection reason for the candidate");
    if (!reason) return;
    setError("");
    try {
      await api.post(`/api/organizations/${session.organization.id}/verifications/${verificationId}/review`, { approved, reason });
      setNotice(approved ? "Identity verification approved." : "Identity verification rejected with the supplied reason.");
      refetchCandidateDetails();
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? (requestError.response?.data?.error ?? "Could not review identity verification.") : "Could not review identity verification.");
    }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      <form onSubmit={add} className="card h-fit">
        <p className="eyebrow">Student onboarding</p>
        <h2 className="mt-1 font-semibold">Create student account</h2>
        <p className="mt-2 text-sm leading-5 text-slate-500">This creates the candidate profile and a student login in your organization. The password is never shown again.</p>
        <label className="mt-4 block text-sm">
          Full name
          <input
            className="input mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="mt-3 block text-sm">
          Email
          <input
            className="input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="mt-3 block text-sm">
          Initial password
          <input
            className="input mt-1"
            type="password"
            autoComplete="new-password"
            value={initialPassword}
            onChange={(e) => setInitialPassword(e.target.value)}
            minLength={10}
            required
          />
        </label>
        <label className="mt-3 block text-sm">
          Confirm initial password
          <input
            className="input mt-1"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={10}
            required
          />
        </label>
        <p className="mt-2 text-xs leading-5 text-slate-500">Use 10+ characters with uppercase, lowercase and a number. Share it securely; students can use password recovery later.</p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <button className="button mt-4 w-full">Create student account</button>
      </form>
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Candidates</h2><p className="mt-1 text-sm text-slate-500">Select a candidate to see assignments, verification and result status.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{data.length} total</span></div>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="border-b text-slate-500">
            <tr>
              <th className="pb-2">Name</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Email status</th>
              <th className="pb-2">Account</th>
              <th className="pb-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.length ? (
              data.map(
                (c: {
                  _id: string;
                  name: string;
                  email: string;
                  emailVerifiedAt?: string;
                   userId?: string;
                }) => (
                  <tr className="border-b" key={c._id}>
                    <td className="py-3 font-medium">{c.name}</td>
                    <td>{c.email}</td>
                    <td>{c.emailVerifiedAt ? "Verified" : "Not verified"}</td>
                    <td>{c.userId ? "Linked" : "Not linked"}</td>
                    <td><button type="button" onClick={() => setSelectedCandidateId(c._id)} className="font-semibold text-blue-700 hover:text-blue-800">View details</button></td>
                  </tr>
                ),
              )
            ) : (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-500">
                  No candidates yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <aside className="card h-fit xl:sticky xl:top-6">
        {!selectedCandidateId ? <div className="py-10 text-center"><Users className="mx-auto text-blue-600" size={28}/><h2 className="mt-3 font-semibold">Candidate details</h2><p className="mt-2 text-sm leading-6 text-slate-500">Choose a candidate to inspect their real account, assessment and result details.</p></div> : detailsLoading ? <div className="h-72 animate-pulse rounded-xl bg-slate-100" /> : candidateDetails ? <CandidateDetails details={candidateDetails} exams={availableExams} onAssign={assignAssessment} onReview={reviewVerification} canReview={["institute_admin", "proctor"].includes(session.role)} onClose={() => setSelectedCandidateId("")} /> : <p className="text-sm text-red-600">Candidate details could not be loaded.</p>}
      </aside>
    </div>
  );
}
function CandidateDetails({ details, exams, onAssign, onReview, canReview, onClose }: { details: any; exams: any[]; onAssign: (examId: string) => void; onReview: (approved: boolean) => void; canReview: boolean; onClose: () => void }) {
  const c = details.candidate;
  const assignedIds = new Set(details.assessments.map((item: any) => String(item.exam?._id)));
  const assignable = exams.filter((exam) => ["published", "scheduled", "live"].includes(exam.status) && !assignedIds.has(String(exam._id)));
  return <div><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Candidate profile</p><h2 className="mt-1 text-lg font-semibold">{c.name}</h2></div><button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-900">Close</button></div><dl className="mt-5 space-y-3 text-sm"><div><dt className="text-slate-500">Email</dt><dd className="mt-1 break-all font-medium">{c.email}</dd></div><div className="grid grid-cols-2 gap-3"><div><dt className="text-slate-500">Email status</dt><dd className="mt-1 font-medium">{c.emailVerifiedAt ? "Verified" : "Not verified"}</dd></div><div><dt className="text-slate-500">Exam account</dt><dd className="mt-1 font-medium">{c.accountLinked ? "Linked" : "Not linked"}</dd></div></div><div><dt className="text-slate-500">Identity verification</dt><dd className="mt-1 font-medium capitalize">{String(details.verification.status).replaceAll("_", " ")}</dd>{canReview && ["submitted", "resubmission_required"].includes(details.verification.status) && <div className="mt-3 flex gap-3"><button type="button" onClick={() => onReview(true)} className="text-sm font-semibold text-emerald-700">Approve identity</button><button type="button" onClick={() => onReview(false)} className="text-sm font-semibold text-red-700">Reject</button></div>}</div>{c.externalId && <div><dt className="text-slate-500">Candidate ID</dt><dd className="mt-1 font-medium">{c.externalId}</dd></div>}</dl><div className="mt-6 border-t pt-5"><h3 className="font-semibold">Assign an assessment</h3>{assignable.length ? <div className="mt-3 space-y-2">{assignable.map((exam) => <button type="button" key={exam._id} onClick={() => onAssign(exam._id)} className="flex w-full items-center justify-between rounded-xl border border-blue-100 bg-blue-50 p-3 text-left text-sm hover:border-blue-300"><span><b className="block text-slate-900">{exam.title}</b><span className="text-slate-600">{exam.durationMinutes} minutes · {exam.status}</span></span><span className="font-semibold text-blue-700">Assign</span></button>)}</div> : <p className="mt-2 text-sm text-slate-500">No unassigned published assessments are available.</p>}<h3 className="mt-6 font-semibold">Assigned assessments</h3><div className="mt-3 space-y-3">{details.assessments.length ? details.assessments.map((item: any, index: number) => <article key={index} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-medium">{item.exam?.title ?? "Assessment unavailable"}</p><p className="mt-1 capitalize text-slate-500">{item.attempt?.status?.replaceAll("_", " ") ?? "Assigned — not started"}</p>{item.attempt?.receiptCode && <p className="mt-1 text-xs text-slate-500">Receipt: {item.attempt.receiptCode}</p>}{item.grade && <p className="mt-2 font-semibold text-emerald-700">Score: {item.grade.totalMarks}/{item.grade.maxMarks} · {item.grade.status}</p>}</article>) : <p className="text-sm text-slate-500">No assessments assigned yet.</p>}</div></div></div>;
}
function Verification({ session }: { session: Session }) {
  const {
    data = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["verification"],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/verifications`)
        .then((r) => r.data),
  });
  const review = async (id: string, approved: boolean) => {
    const reason = approved
      ? "Approved after review"
      : window.prompt("Required reason for this decision");
    if (!reason) return;
    await api.post(
      `/api/organizations/${session.organization.id}/verifications/${id}/review`,
      { approved, reason },
    );
    refetch();
  };
  if (isLoading)
    return <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />;
  return (
    <div className="card overflow-x-auto">
      <h2 className="font-semibold">Verification center</h2>
      <p className="mt-1 text-sm text-slate-500">
        Review submitted identity evidence. Documents remain private.
      </p>
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
              <tr className="border-b" key={v._id}>
                <td className="py-3">
                  {v.candidateId?.name ?? "Candidate"}
                  <span className="block text-xs text-slate-500">
                    {v.candidateId?.email}
                  </span>
                </td>
                <td>{v.status}</td>
                <td className="space-x-2">
                  {["submitted", "resubmission_required"].includes(
                    v.status,
                  ) && (
                    <>
                      <button
                        onClick={() => review(v._id, true)}
                        className="text-emerald-700"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => review(v._id, false)}
                        className="text-red-700"
                      >
                        Reject
                      </button>
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
    </div>
  );
}
function Incidents({ session }: { session: Session }) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const {
    data = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["incidents"],
    queryFn: () =>
      api
        .get(`/api/organizations/${session.organization.id}/incidents`)
        .then((r) => r.data),
  });
  const decide = async (id: string, action: string) => {
    const prompt = action === "awaiting_student" ? "Message/reason for the student explanation request" : "Required reviewer decision reason";
    const reason = window.prompt(prompt);
    if (!reason) return;
    await api.post(
      `/api/organizations/${session.organization.id}/incidents/${id}/decision`,
      { action, reason },
    );
    refetch();
  };
  if (isLoading)
    return <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />;
  const visible = filter === "all" ? data : data.filter((incident: any) => incident.status === filter);
  const awaitingStudent = data.filter((incident: any) => incident.status === "awaiting_student").length;
  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Human review queue</p><h2 className="mt-1 font-semibold">Incident timeline</h2><p className="mt-1 text-sm text-slate-500">Signals are review priorities, not findings of wrongdoing.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${data.length ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{data.length ? `${data.length} review items` : "No open incidents"}</span></div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-y border-slate-100 py-3"><span className="mr-1 text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Filter</span>{[["all", `All (${data.length})`], ["open", "Open"], ["awaiting_student", `Student response (${awaitingStudent})`], ["resolved", "Resolved"], ["dismissed", "Dismissed"]].map(([value, label]) => <button type="button" key={value} onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>)}</div>
      <div className="mt-5 space-y-3">
        {visible.length ? (
          visible.map((i: any) => (
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={i._id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b>{i.type.replaceAll("_", " ")}</b>
                <span className="text-sm text-slate-500">
                  Priority {i.riskPriority} · {i.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{i.details}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]"><div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{i.eventIds?.some((event: any) => event?.details?.demo) ? <img src={`/demo-evidence/${i.type.replaceAll("_", "-")}.svg`} alt={`Simulated training evidence for ${i.type.replaceAll("_", " ")}`} className="aspect-video h-full w-full object-cover" /> : <div className="flex min-h-24 items-center justify-center p-3 text-center text-xs leading-5 text-slate-500"><span><ShieldCheck className="mx-auto mb-1 text-slate-400" size={20}/>No image evidence attached</span></div>}<p className="border-t border-slate-200 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">Simulated training visual</p></div><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Review flags</p><div className="mt-2 flex flex-wrap gap-2">{(i.contributingSignals ?? []).map((signal: any, index: number) => <span key={index} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{signal.type.replaceAll("_", " ")} · weight {signal.weight}</span>)}</div><p className="mt-3 text-xs text-slate-500">Created {new Date(i.createdAt).toLocaleString()} · authorized reviewers only.</p></div></div>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm"><button type="button" onClick={() => setSelected(i)} className="font-semibold text-blue-700">View case details</button>
                <button
                  onClick={() => decide(i._id, "dismissed")}
                  className="text-slate-700"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => decide(i._id, "resolved")}
                  className="text-emerald-700"
                >
                  Resolve
                </button>
                {i.status === "awaiting_student" ? <span className="font-medium text-amber-700">Student explanation requested</span> : <button onClick={() => decide(i._id, "awaiting_student")} className="text-blue-700">Ask student for context</button>}
              </div>
            </article>
          ))
        ) : <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 px-6 py-10 text-center"><ShieldCheck className="mx-auto text-emerald-600" size={28}/><p className="mt-3 font-medium text-slate-800">No incidents in this view</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">Choose another filter to inspect completed cases or return to the active review queue.</p></div>}
      </div>
      {selected && <div role="dialog" aria-modal="true" aria-label="Incident case details" className="fixed inset-0 z-50 flex justify-end bg-slate-950/35"><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Review case</p><h3 className="mt-1 text-xl font-semibold capitalize">{selected.type.replaceAll("_", " ")}</h3><p className="mt-1 text-sm text-slate-500">{selected.candidateId?.name ?? "Candidate"} · {selected.examId?.title ?? "Assessment"}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Close</button></div><img src={`/demo-evidence/${selected.type.replaceAll("_", "-")}.svg`} alt="Simulated training evidence" className="mt-6 aspect-video w-full rounded-xl border border-slate-200 object-cover"/><div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"><b>Training data notice.</b> This image is a simulated visual for UI testing, not real student evidence. Real evidence needs consented capture, private storage, retention controls, and authorized review.</div><dl className="mt-6 space-y-4 text-sm"><div><dt className="text-slate-500">Current status</dt><dd className="mt-1 font-semibold capitalize">{selected.status.replaceAll("_", " ")}</dd></div><div><dt className="text-slate-500">Reviewer guidance</dt><dd className="mt-1 leading-6 text-slate-700">Use “Ask student for context” only when the signal is ambiguous and a response can help your review. It creates a response deadline; it is not a penalty.</dd></div><div><dt className="text-slate-500">Decision record</dt><dd className="mt-1 leading-6 text-slate-700">{selected.decisionReason ?? "No reviewer decision recorded yet."}</dd></div></dl></aside></div>}
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
                  <div className="rounded-lg border p-3 text-sm" key={o._id}>
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
                  <div className="rounded-lg border p-3 text-sm" key={s._id}>
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
        {!observations.length && <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-600"><b className="text-slate-800">How to activate companion monitoring:</b> a student starts an assessment, chooses <span className="font-medium">Pair Windows companion</span>, verifies the short-lived token in the Windows app, explicitly accepts its consent notice, and starts a scan. No observation is created without that student-controlled flow.</div>}
      </div>
    </div>
  );
}
function Placeholder({
  title,
  icon: Icon,
}: {
  title: string;
  icon: typeof Eye;
}) {
  return (
    <div className="card py-16 text-center">
      <Icon className="mx-auto text-blue-600" size={30} />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
        This workspace is ready for the next delivery phase. Its data remains
        organization-scoped and access-controlled.
      </p>
    </div>
  );
}
function LoginChoice() {
  const navigate = useNavigate();
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
      const { data } = await api.post("/api/auth/login", { email: normalizedEmail, password });
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
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/student-entry" element={<StudentEntry />} />
      <Route path="/login" element={<LoginChoice />} />
      <Route path="/student/login" element={<PortalLogin portal="student" onSave={s.save} />} />
      <Route path="/institute/login" element={<PortalLogin portal="institute" onSave={s.save} />} />
      <Route path="/register" element={<Auth register onSave={s.save} />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/app/exam-builder"
        element={
          s.session ? (
            <ExamBuilder session={s.session} />
          ) : (
            <Navigate to="/login" />
          )
        }
      />
      <Route
        path="/app/exam-builder/:examId"
        element={
          s.session ? (
            <ExamBuilder session={s.session} />
          ) : (
            <Navigate to="/login" />
          )
        }
      />
      <Route
        path="/app/*"
        element={
          s.session ? (
            <Shell session={s.session} clear={s.clear} />
          ) : (
            <Navigate to="/login" />
          )
        }
      />
    </Routes>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
