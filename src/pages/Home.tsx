/**
 * Home.tsx — Landing page with quick start
 */

import { Link } from 'wouter';
import { Camera, Zap, Lock, Smartphone, ArrowRight, Hand, ScanFace } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-2xl text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-5xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
              ASL Gesture
            </h1>
            <h2 className="text-5xl font-bold text-primary glow-cyan-text" style={{ fontFamily: 'Space Grotesk' }}>
              Recognition
            </h2>
          </div>

          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Real-time American Sign Language gesture recognition using MediaPipe, ONNX Runtime, and face-touch detection.
            Fully client-side — your data never leaves your device.
          </p>

          {/* Badges */}
          <div className="flex flex-wrap justify-center gap-3 pt-4">
            <span className="px-3 py-1 rounded-full text-xs font-mono bg-primary/10 text-primary border border-primary/20">
              AI-POWERED
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-mono bg-success/10 text-success border border-success/20">
              OPEN SOURCE
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-mono bg-warning/10 text-warning border border-warning/20">
              BROWSER-NATIVE
            </span>
          </div>

          {/* CTA */}
          <Link href="/recognize">
            <button className="mt-8 flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-primary-foreground text-lg font-semibold hover:opacity-90 transition-opacity glow-cyan mx-auto">
              <Camera className="w-5 h-5" />
              Start Recognition
            </button>
          </Link>

          {/* Performance stats row */}
          <div className="pt-4 flex flex-wrap justify-center gap-x-6 gap-y-2">
            {['30-frame gestures', '30–60 FPS', '5 core signs', '0 servers'].map((stat) => (
              <span
                key={stat}
                className="text-xs font-mono text-muted-foreground"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {stat}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── How it Works ───────────────────────────────────────────── */}
      <div className="px-6 py-16 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12 space-y-2">
            <p className="text-xs font-mono text-primary tracking-widest uppercase">Workflow</p>
            <h3 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
              How it Works
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Three steps from raw camera feed to live sign recognition
            </p>
          </div>

          <div className="flex flex-col md:flex-row items-stretch gap-4">
            {[
              {
                step: '01',
                icon: Camera,
                title: 'Start Camera',
                desc: 'Grant webcam access and the app extracts one primary hand plus face landmarks locally.',
                href: '/recognize',
                cta: 'Open Demo',
              },
              {
                step: '02',
                icon: Hand,
                title: 'Sign Core Gestures',
                desc: 'Use hello, yes, no, please, and help for the most reliable hackathon demo path.',
                href: '/recognize',
                cta: 'Try Gestures',
              },
              {
                step: '03',
                icon: ScanFace,
                title: 'Face Region Gestures',
                desc: 'Move an index or middle fingertip near mouth, eye, nose, forehead, or ear to trigger combined gesture labels.',
                href: '/recognize',
                cta: 'Try Face Touch',
              },
            ].map(({ step, icon: Icon, title, desc, href, cta }, i, arr) => (
              <div key={step} className="flex flex-col md:flex-row items-center gap-4 flex-1">
                <Link href={href} className="flex-1 w-full">
                  <div className="group bg-card border border-border hover:border-primary/40 rounded-xl p-6 h-full transition-all cursor-pointer hover:bg-primary/5 space-y-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="text-3xl font-bold text-primary/20 group-hover:text-primary/40 transition-colors"
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      >
                        {step}
                      </span>
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                    </div>
                    <div>
                      <h4
                        className="text-base font-semibold text-foreground mb-1"
                        style={{ fontFamily: 'Space Grotesk' }}
                      >
                        {title}
                      </h4>
                      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-semibold text-primary group-hover:gap-2 transition-all">
                      {cta}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </Link>

                {/* Arrow divider between steps */}
                {i < arr.length - 1 && (
                  <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0 hidden md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Why This Works ─────────────────────────────────────────── */}
      <div className="bg-card/50 border-t border-border px-6 py-16">
        <div className="max-w-6xl mx-auto">
          <h3
            className="text-2xl font-bold text-foreground mb-12 text-center"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            Why This Works
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Zap,
                title: 'Instant Recognition',
                desc: 'Pre-trained ONNX model focuses on five reliable one-hand gestures.',
              },
              {
                icon: Lock,
                title: '100% Private',
                desc: 'No cloud, no servers, no data collection. Everything runs in your browser.',
              },
              {
                icon: Smartphone,
                title: 'Works Everywhere',
                desc: 'Desktop, tablet, or mobile. Any modern browser with a webcam.',
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-card border border-border rounded-xl p-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h4
                  className="text-lg font-semibold text-foreground mb-2"
                  style={{ fontFamily: 'Space Grotesk' }}
                >
                  {title}
                </h4>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Technology Stack ───────────────────────────────────────── */}
      <div className="px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <h3 className="text-sm font-mono text-muted-foreground uppercase tracking-wide mb-6">
            Technology Stack
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { name: 'MediaPipe', desc: 'Hand + face landmarks' },
              { name: 'ONNX Runtime', desc: 'Primary inference engine' },
              { name: 'Face Touch', desc: 'Region interaction heuristic' },
              { name: 'React 19', desc: 'UI framework' },
              { name: 'Web Speech API', desc: 'Audio output' },
            ].map(({ name, desc }) => (
              <div key={name} className="bg-muted/50 rounded-lg p-4">
                <p className="font-mono text-xs font-semibold text-primary mb-1">{name}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
