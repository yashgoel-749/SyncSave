import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SyncSpace — Collaborative Documents & Whiteboards, Offline-First",
};

/* ── Feature data ── */
const FEATURES = [
  {
    id: "realtime",
    icon: <ZapIcon />,
    title: "Real-Time Collaboration",
    description:
      "See every keystroke as it happens. Presence cursors with colored names let you know exactly who's editing what.",
    gradient: "from-brand-500 to-brand-700",
    glow: "hover:shadow-[0_0_30px_hsl(246_68%_56%/0.3)]",
  },
  {
    id: "whiteboard",
    icon: <PenIcon />,
    title: "Shared Whiteboard",
    description:
      "Every document ships with an infinite canvas. Sketch, drop shapes and notes, and watch teammates draw live.",
    gradient: "from-accent-500 to-brand-500",
    glow: "hover:shadow-[0_0_30px_hsl(160_74%_48%/0.25)]",
  },
  {
    id: "offline",
    icon: <WifiOffIcon />,
    title: "Offline-First",
    description:
      "No internet? No problem. Keep editing — SyncSpace queues your changes on-device and syncs them the moment you're back online.",
    gradient: "from-brand-700 to-brand-500",
    glow: "hover:shadow-[0_0_30px_hsl(246_62%_39%/0.3)]",
  },
  {
    id: "crdt",
    icon: <MergeIcon />,
    title: "Conflict-Free Merging",
    description:
      "Built on Yjs CRDTs. No merge conflicts, no data loss. Multiple editors can work simultaneously without stepping on each other.",
    gradient: "from-brand-400 to-accent-500",
    glow: "hover:shadow-[0_0_30px_hsl(246_76%_65%/0.25)]",
  },
  {
    id: "rich",
    icon: <TextIcon />,
    title: "Rich Text Editing",
    description:
      "Powered by TipTap — headings, lists, quotes, code blocks and links with keyboard shortcuts. A proper writing experience, not a textarea.",
    gradient: "from-brand-600 to-brand-400",
    glow: "hover:shadow-[0_0_30px_hsl(246_64%_47%/0.25)]",
  },
  {
    id: "secure",
    icon: <ShieldIcon />,
    title: "Secure by Default",
    description:
      "Signed collaboration tokens, role-based access control with instant revocation, and rate-limited APIs. Your documents belong to you.",
    gradient: "from-accent-400 to-brand-600",
    glow: "hover:shadow-[0_0_30px_hsl(160_80%_60%/0.2)]",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Create a document",
    description:
      "Hit New Document, give it a title, and you're in the editor in under two seconds.",
  },
  {
    step: "02",
    title: "Invite your team",
    description:
      "Share a link or invite by email. Set permissions — owner, editor, or viewer.",
  },
  {
    step: "03",
    title: "Write and sketch together",
    description:
      "Real-time cursors in the text and on the whiteboard, offline editing, instant sync.",
  },
];

const WHITEBOARD_POINTS = [
  { title: "Pen, shapes, arrows and text", body: "Freehand ink with smoothing, rectangles, ellipses, lines and sticky text." },
  { title: "Live cursors and strokes", body: "See collaborators' pointers and in-progress strokes before they lift the pen." },
  { title: "Infinite, zoomable canvas", body: "Pan with space-drag, pinch or Ctrl+scroll to zoom, fit to content in one key." },
  { title: "Undo, export, persist", body: "Per-user undo history, one-click PNG export, and the same offline-first sync as the document." },
];

/* ── Page ── */
export default function LandingPage() {
  return (
    <>
      <Navbar />

      <main id="main-content" className="flex-1">
        {/* ════ HERO ════ */}
        <section
          aria-labelledby="hero-heading"
          className="relative min-h-dvh flex items-center mesh-bg overflow-hidden pt-16"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full bg-brand-600/10 blur-[120px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-accent-500/8 blur-[100px]"
          />

          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-28 sm:py-36 text-center">
            <div className="animate-fade-up inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-sm text-text-secondary mb-8 border border-brand-700/40">
              <span className="inline-block w-2 h-2 rounded-full bg-accent-500 animate-pulse-ring" />
              New: a shared whiteboard in every document
            </div>

            <h1
              id="hero-heading"
              className="animate-fade-up-delay-1 text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-extrabold tracking-tight leading-none mb-6"
            >
              Documents that{" "}
              <span className="gradient-text block sm:inline">
                think together
              </span>
            </h1>

            <p className="animate-fade-up-delay-2 text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto mb-12 leading-relaxed">
              SyncSpace is the offline-first collaborative editor built for
              modern teams. Write, sketch and sync in real time — conflict-free, and fast
              even without Wi-Fi.
            </p>

            <div className="animate-fade-up-delay-3 flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                href="/register"
                id="hero-cta-primary"
                className="btn btn-primary text-base px-8 py-4 animate-pulse-ring"
              >
                Start writing for free
                <ArrowRightIcon className="w-5 h-5" />
              </Link>
              <a
                href="#how-it-works"
                id="hero-cta-secondary"
                className="btn btn-secondary text-base px-8 py-4"
              >
                See how it works
              </a>
            </div>

            <p className="animate-fade-up-delay-4 mt-10 text-sm text-text-muted">
              No credit card required · Works offline · Free during beta
            </p>

            {/* Editor preview card */}
            <div className="animate-fade-up-delay-4 mt-20 relative mx-auto max-w-4xl">
              <div className="gradient-border rounded-2xl p-px">
                <div className="rounded-2xl overflow-hidden bg-surface-2 shadow-2xl">
                  <EditorMockup />
                </div>
              </div>
              <div
                aria-hidden="true"
                className="absolute -top-4 -right-4 sm:-right-8 glass rounded-full px-3 py-1.5 text-xs text-text-secondary flex items-center gap-2 border border-border-subtle animate-float"
              >
                <span className="flex gap-1">
                  <AvatarDot color="#6d5ae6" />
                  <AvatarDot color="#34d399" />
                  <AvatarDot color="#f59e0b" />
                </span>
                3 people editing
              </div>
            </div>
          </div>
        </section>

        {/* ════ FEATURES ════ */}
        <section
          id="features"
          aria-labelledby="features-heading"
          className="py-28 sm:py-36 bg-surface-1 scroll-mt-16"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-20">
              <p className="text-sm font-semibold text-brand-400 uppercase tracking-widest mb-3">
                Features
              </p>
              <h2
                id="features-heading"
                className="text-4xl sm:text-5xl font-bold tracking-tight mb-5"
              >
                Everything you need to{" "}
                <span className="gradient-text">work together</span>
              </h2>
              <p className="text-text-secondary text-lg max-w-2xl mx-auto">
                A thoughtfully designed set of primitives that gets out of your
                way and lets your team focus on the ideas.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((f) => (
                <article
                  key={f.id}
                  className={`glass rounded-2xl p-8 transition-all duration-300 hover:-translate-y-1 group ${f.glow}`}
                >
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-5 text-white group-hover:scale-110 transition-transform duration-300`}
                  >
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-lg text-text-primary mb-2">
                    {f.title}
                  </h3>
                  <p className="text-text-secondary text-sm leading-relaxed">
                    {f.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ════ WHITEBOARD ════ */}
        <section
          id="whiteboard"
          aria-labelledby="whiteboard-heading"
          className="py-28 sm:py-36 relative overflow-hidden scroll-mt-16"
        >
          <div aria-hidden="true" className="absolute inset-0 dot-grid opacity-60" />
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-surface-0 via-transparent to-surface-0" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-sm font-semibold text-accent-500 uppercase tracking-widest mb-3">
                Whiteboard
              </p>
              <h2 id="whiteboard-heading" className="text-4xl sm:text-5xl font-bold tracking-tight mb-5">
                Think out loud,{" "}
                <span className="gradient-text">in the same room</span>
              </h2>
              <p className="text-text-secondary text-lg leading-relaxed mb-10">
                Flip any document into a shared canvas. It lives in the same CRDT as your
                text, so it syncs, persists and works offline exactly the same way.
              </p>
              <ul className="space-y-5">
                {WHITEBOARD_POINTS.map((p) => (
                  <li key={p.title} className="flex gap-4">
                    <span className="mt-1 w-6 h-6 rounded-full bg-accent-500/15 text-accent-400 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-semibold text-text-primary">{p.title}</h3>
                      <p className="text-sm text-text-secondary">{p.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="gradient-border rounded-2xl p-px">
                <div className="rounded-2xl overflow-hidden bg-surface-1 shadow-2xl">
                  <WhiteboardMockup />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ════ HOW IT WORKS ════ */}
        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          className="py-28 sm:py-36 mesh-bg relative overflow-hidden scroll-mt-16"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_50%,hsl(246_68%_56%/0.07)_0%,transparent_70%)]"
          />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-20">
              <p className="text-sm font-semibold text-accent-500 uppercase tracking-widest mb-3">
                How it works
              </p>
              <h2
                id="how-heading"
                className="text-4xl sm:text-5xl font-bold tracking-tight"
              >
                Up and running in{" "}
                <span className="gradient-text">minutes</span>
              </h2>
            </div>

            <div className="relative grid md:grid-cols-3 gap-10">
              <div
                aria-hidden="true"
                className="hidden md:block absolute top-10 left-[calc(33.33%+1rem)] right-[calc(33.33%+1rem)] h-0.5 bg-gradient-to-r from-brand-600 via-brand-400 to-accent-500"
              />

              {HOW_IT_WORKS.map(({ step, title, description }) => (
                <div key={step} className="flex flex-col items-center text-center">
                  <div className="relative w-20 h-20 mb-8">
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 opacity-20 animate-pulse" />
                    <div className="relative w-full h-full rounded-2xl glass flex items-center justify-center border border-brand-700/50">
                      <span className="text-2xl font-bold gradient-text">
                        {step}
                      </span>
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold text-text-primary mb-3">
                    {title}
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ════ CTA BANNER ════ */}
        <section
          aria-labelledby="cta-heading"
          className="py-28 bg-surface-1"
        >
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
            <div className="gradient-border p-px rounded-3xl">
              <div className="rounded-3xl bg-surface-1 px-8 py-16 sm:px-16">
                <h2
                  id="cta-heading"
                  className="text-4xl sm:text-5xl font-bold tracking-tight mb-5"
                >
                  Ready to{" "}
                  <span className="gradient-text">sync up?</span>
                </h2>
                <p className="text-text-secondary text-lg mb-10">
                  Join teams already collaborating with SyncSpace. Free to
                  start, no credit card required.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link
                    href="/register"
                    id="cta-section-primary"
                    className="btn btn-primary text-base px-10 py-4"
                  >
                    Get started — it&apos;s free
                    <ArrowRightIcon className="w-5 h-5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}

/* ── SVG icon helpers ── */
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

function WifiOffIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

function MergeIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function AvatarDot({ color }: { color: string }) {
  return (
    <span
      style={{ backgroundColor: color }}
      className="w-5 h-5 rounded-full border-2 border-surface-2 -ml-1 first:ml-0"
    />
  );
}

/* ── Editor mockup (pure CSS simulation) ── */
function EditorMockup() {
  return (
    <div className="bg-surface-2 text-left p-0">
      <div className="flex items-center gap-2 px-4 py-3 bg-surface-3 border-b border-border-subtle">
        <span className="w-3 h-3 rounded-full bg-red-500/70" />
        <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
        <span className="w-3 h-3 rounded-full bg-green-500/70" />
        <span className="mx-auto text-xs text-text-muted font-mono">
          Q3 Strategy — SyncSpace
        </span>
        <div className="flex gap-1 ml-auto">
          <AvatarDot color="#6d5ae6" />
          <AvatarDot color="#34d399" />
          <AvatarDot color="#f59e0b" />
        </div>
      </div>

      <div className="flex items-center gap-1 px-4 py-2 border-b border-border-subtle text-text-muted text-xs">
        {["B", "I", "U", "|", "H1", "H2", "|", "≡", "⋮"].map((t, i) => (
          <span
            key={i}
            className={`px-2 py-1 rounded ${
              t === "|" ? "opacity-20" : ""
            } ${t === "B" ? "font-bold text-brand-400 bg-surface-3" : ""}`}
            aria-hidden="true"
          >
            {t}
          </span>
        ))}
        <span className="ml-auto segmented text-[10px]" aria-hidden="true">
          <span className="px-2 py-0.5 rounded-md bg-surface-4 text-text-primary">Document</span>
          <span className="px-2 py-0.5 text-text-muted">Whiteboard</span>
        </span>
      </div>

      <div className="px-8 py-8 min-h-[240px] sm:min-h-[320px] font-sans">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="text-2xl font-bold text-text-primary">
            Q3 Strategy &amp; Roadmap
          </div>
          <div className="flex gap-2 items-start">
            <div className="h-5 w-1 rounded-full bg-brand-500 mt-0.5 flex-shrink-0" />
            <p className="text-text-secondary text-sm leading-relaxed">
              Our primary goal this quarter is to expand into the{" "}
              <span className="text-brand-400 font-medium">enterprise segment</span>{" "}
              while maintaining our velocity on the core product.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <span
              className="inline-block w-0.5 h-5 bg-brand-500 animate-pulse rounded-full"
              aria-hidden="true"
            />
            <span className="text-[10px] bg-brand-600/80 text-white px-1 rounded -mt-5 -ml-1 whitespace-nowrap">
              Alex
            </span>
            <span className="text-text-primary text-sm">
              We should also revisit pricing tiers—
            </span>
          </div>
          <div className="text-sm text-text-secondary">
            Key initiatives:{" "}
            <span className="text-accent-500 font-medium">Auth revamp</span>,{" "}
            <span className="text-brand-400 font-medium">Offline sync</span>,{" "}
            <span className="text-text-muted">API rate limits</span>
            <span
              className="inline-block w-0.5 h-4 bg-accent-500 animate-pulse rounded-full ml-1 align-middle"
              aria-hidden="true"
            />
            <span className="text-[10px] bg-accent-500/80 text-white px-1 rounded -mt-4 ml-0.5 whitespace-nowrap">
              Sam
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Whiteboard mockup (static SVG) ── */
function WhiteboardMockup() {
  return (
    <div className="relative bg-surface-0 dot-grid aspect-[4/3]" aria-hidden="true">
      <svg viewBox="0 0 480 360" className="absolute inset-0 w-full h-full" fill="none">
        {/* sticky note */}
        <rect x="52" y="60" width="140" height="92" rx="10" fill="hsl(43 96% 56% / 0.16)" stroke="#fbbf24" strokeWidth="3" />
        <text x="70" y="94" fill="#fde68a" fontSize="14" fontWeight="600" fontFamily="Inter, system-ui, sans-serif">Launch plan</text>
        <text x="70" y="116" fill="#fde68a" fontSize="12" fontFamily="Inter, system-ui, sans-serif">beta → GA</text>
        {/* arrow */}
        <path d="M196 106 C 250 106, 260 200, 300 200" stroke="#8b7cf6" strokeWidth="4" strokeLinecap="round" />
        <path d="M288 190 L300 200 L288 210" stroke="#8b7cf6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {/* ellipse */}
        <ellipse cx="360" cy="200" rx="64" ry="40" stroke="#34d399" strokeWidth="4" fill="hsl(160 74% 48% / 0.12)" />
        <text x="330" y="205" fill="#a7f3d0" fontSize="13" fontWeight="600" fontFamily="Inter, system-ui, sans-serif">Users</text>
        {/* freehand stroke */}
        <path d="M70 250 Q 110 210 150 250 T 230 250 T 310 300" stroke="#f4f4f5" strokeWidth="4" strokeLinecap="round" />
        {/* remote cursors */}
        <g transform="translate(300 120)">
          <path d="M 0 0 L 0 16 L 4.5 12.5 L 8 19 L 10.5 18 L 7 11.5 L 12.5 11.5 Z" fill="#34d399" stroke="#0b0d14" />
          <rect x="14" y="14" width="38" height="18" rx="4" fill="#34d399" />
          <text x="20" y="26.5" fontSize="11" fontWeight="600" fill="#fff" fontFamily="Inter, system-ui, sans-serif">Sam</text>
        </g>
        <g transform="translate(150 290)">
          <path d="M 0 0 L 0 16 L 4.5 12.5 L 8 19 L 10.5 18 L 7 11.5 L 12.5 11.5 Z" fill="#f59e0b" stroke="#0b0d14" />
          <rect x="14" y="14" width="40" height="18" rx="4" fill="#f59e0b" />
          <text x="20" y="26.5" fontSize="11" fontWeight="600" fill="#fff" fontFamily="Inter, system-ui, sans-serif">Alex</text>
        </g>
      </svg>
      {/* tool rail */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 p-1.5 rounded-xl glass">
        {["V", "P", "R", "O", "T"].map((k, i) => (
          <span
            key={k}
            className={`w-7 h-7 rounded-lg text-[10px] font-bold flex items-center justify-center ${
              i === 1 ? "bg-brand-500 text-white" : "text-text-muted"
            }`}
          >
            {k}
          </span>
        ))}
      </div>
      <div className="absolute right-3 top-3 px-2 py-1 rounded-lg glass text-[10px] font-mono text-text-secondary">100%</div>
      <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-1.5 px-3 py-2 rounded-xl glass">
        {["#f4f4f5", "#8b7cf6", "#34d399", "#60a5fa", "#fbbf24", "#f472b6"].map((c, i) => (
          <span
            key={c}
            className={`w-4 h-4 rounded-full ${i === 1 ? "ring-2 ring-white" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}
