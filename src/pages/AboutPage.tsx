/**
 * AboutPage.tsx — Technical information and system details
 */

import { Info, Zap, Lock, Code, Cpu, Shield, GitBranch, Activity } from 'lucide-react';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-center">
      <p className="text-xl font-bold text-primary" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function ArchRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground font-mono">{label}</span>
      <span className="text-xs text-foreground font-mono font-semibold">{value}</span>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="max-w-4xl space-y-10">

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-xs font-mono text-primary tracking-widest uppercase">Technical Reference</p>
        <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
          About Gesto
        </h1>
        <p className="text-muted-foreground mt-1 max-w-xl">
          A focused ASL gesture demo with local camera processing and optional online speech output.
        </p>
      </div>

      {/* ── Key Stats ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Inference Time" value="< 10ms" />
        <StatCard label="Camera FPS" value="30–60" />
        <StatCard label="Model Size" value="~2.2MB" />
        <StatCard label="Demo Signs" value="5+" />
      </div>

      {/* ── System Architecture ─────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <h2 className="text-base font-semibold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
            System Architecture
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Three layers working in concert for real-time inference
          </p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                step: '01',
                icon: Activity,
                title: 'MediaPipe Hands + Face',
                detail: 'Detects one primary hand plus key face landmarks for region-touch interactions.',
              },
              {
                step: '02',
                icon: Cpu,
                title: 'ONNX Runtime',
                detail: 'Runs a 30-frame gesture sequence model using hand coordinates and motion deltas.',
              },
              {
                step: '03',
                icon: Info,
                title: 'Speech + Sentence Output',
                detail: 'Speaks and appends confirmed core gestures and face-touch labels.',
              },
            ].map(({ step, icon: Icon, title, detail }) => (
              <div key={step} className="relative bg-muted/40 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <span
                    className="text-2xl font-bold text-primary/20"
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    {step}
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <p className="text-sm font-semibold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
                  {title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Model Details ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-widest">
              Model Architecture
            </h3>
          </div>
          <div className="px-5 py-4">
            <ArchRow label="Input Shape" value="30 x 126" />
            <ArchRow label="Frame Features" value="63 coords + 63 deltas" />
            <ArchRow label="Sequence Model" value="Attention BiGRU" />
            <ArchRow label="Demo ML Output" value="5 signs + blank" />
            <ArchRow label="Face Touch" value="Heuristic region gate" />
            <ArchRow label="Runtime" value="ONNX WASM" />
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-widest">
              Performance Specs
            </h3>
          </div>
          <div className="px-5 py-4">
            <ArchRow label="Inference Time" value="< 10 ms/frame" />
            <ArchRow label="Model Size" value="~2.2 MB" />
            <ArchRow label="MediaPipe FPS" value="30–60 FPS" />
            <ArchRow label="Sequence Window" value="30 frames" />
            <ArchRow label="Confidence Threshold" value="90%" />
            <ArchRow label="Confirmation Frames" value="8" />
            <ArchRow label="Demo Gestures" value="hello, yes, no, please, help" />
          </div>
        </div>
      </div>

      {/* ── Key Features ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
          Key Features
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: Zap,
              title: 'Zero Setup',
              desc: 'Pre-trained model loads automatically. No training required for the demo gestures.',
            },
            {
              icon: Lock,
              title: 'Local Vision Processing',
              desc: 'Camera frames, landmarks, datasets, and recognition stay in your browser. Online speech sends generated text only when enabled.',
            },
            {
              icon: Code,
              title: 'Open Source',
              desc: 'Built entirely on open-source libraries. Fully transparent and auditable.',
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
                  {title}
                </h4>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stability Safeguards ─────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-semibold text-primary uppercase tracking-widest">
            Stability Safeguards
          </h3>
        </div>
        <ul className="divide-y divide-border">
          {[
            {
              title: 'Prediction Smoothing',
              detail: 'Requires stable high-confidence sequence predictions before confirming a gesture.',
            },
            {
              title: 'Confidence Threshold',
              detail: 'Only emits core gestures after the ONNX model passes the demo threshold.',
            },
            {
              title: 'Hand Detection Check',
              detail: 'Waits for MediaPipe to confirm a hand is visible before attempting inference.',
            },
            {
              title: 'Error Boundaries',
              detail: 'Gracefully handles camera permission errors and model loading failures.',
            },
            {
              title: 'Memory Management',
              detail: 'Uses one ONNX inference pipeline to reduce demo-time contention and false outputs.',
            },
          ].map(({ title, detail }) => (
            <li key={title} className="flex items-start gap-3 px-6 py-3.5">
              <span className="text-primary mt-0.5 flex-shrink-0 text-sm">✓</span>
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground font-semibold">{title}:</strong>{' '}
                {detail}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Browser Compatibility ────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
            Browser Compatibility
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: 'Chrome', support: 'Full' },
              { name: 'Safari', support: 'Full' },
              { name: 'Firefox', support: 'Full' },
              { name: 'Edge', support: 'Full' },
              { name: 'Mobile Chrome', support: 'Full' },
              { name: 'Mobile Safari', support: 'Full' },
              { name: 'Tablets', support: 'Full' },
              { name: 'Webcam Required', support: 'Yes' },
            ].map(({ name, support }) => (
              <div
                key={name}
                className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2.5"
              >
                <span className="text-xs text-muted-foreground">{name}</span>
                <span className="text-xs text-success font-mono font-semibold">✓ {support}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Technology Stack ─────────────────────────────────────────── */}
      <div className="bg-muted/30 border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
            Technology Stack
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">Open-source browser recognition with optional speech service</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { name: 'React 19', category: 'UI' },
              { name: 'TypeScript 5.6', category: 'Language' },
              { name: 'TailwindCSS 4', category: 'Styling' },
              { name: 'ONNX Runtime 1.24', category: 'Inference' },
              { name: 'MediaPipe 0.4', category: 'Vision' },
              { name: 'FaceMesh', category: 'Vision' },
              { name: 'Web Speech API', category: 'Audio' },
              { name: 'Vite 7', category: 'Build' },
              { name: 'Wouter 3', category: 'Router' },
            ].map(({ name, category }) => (
              <div
                key={name}
                className="bg-card border border-border rounded-lg px-3 py-2.5 flex items-center justify-between"
              >
                <span className="text-xs font-mono font-semibold text-foreground">{name}</span>
                <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                  {category}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="text-center text-xs text-muted-foreground border-t border-border pt-6 space-y-1">
        <p className="font-mono">Gesto v1.0 · Built with MediaPipe + ONNX Runtime</p>
        <p className="text-muted-foreground/60">Local camera recognition · Optional online speech text</p>
      </div>
    </div>
  );
}
