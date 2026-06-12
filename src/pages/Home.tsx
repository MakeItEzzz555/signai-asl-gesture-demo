import { Link } from 'wouter';
import { useEffect, useRef, useState } from 'react';
import { Camera, Zap, Lock, Smartphone, ArrowRight, Hand, ScanFace } from 'lucide-react';
import gsap from 'gsap';

const STATS = [
  { prefix: '',    num: 30, suffix: '-frame gestures' },
  { prefix: '30–', num: 60, suffix: ' FPS'            },
  { prefix: '',    num: 5,  suffix: ' core signs'      },
  { prefix: '',    num: 0,  suffix: ' servers'         },
];

const HOW_IT_WORKS = [
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
];

interface StepCardProps {
  step: string;
  icon: React.ElementType;
  title: string;
  desc: string;
  href: string;
  cta: string;
  isLast: boolean;
}

function StepCard({ step, icon: Icon, title, desc, href, cta, isLast }: StepCardProps) {
  const stepNumRef = useRef<HTMLSpanElement>(null);

  const handleEnter = () => {
    gsap.to(stepNumRef.current, { color: '#00d9ff', duration: 0.2, ease: 'power2.out' });
  };
  const handleLeave = () => {
    gsap.to(stepNumRef.current, { color: 'rgba(0,217,255,0.2)', duration: 0.2, ease: 'power2.out' });
  };

  return (
    <div className="flex flex-col md:flex-row items-center gap-4 flex-1">
      <Link href={href} className="flex-1 w-full">
        <div
          className="card-hover step-gradient-border group bg-card rounded-xl p-6 h-full cursor-pointer hover:bg-primary/5 space-y-4"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <div className="flex items-center gap-3">
            <span
              ref={stepNumRef}
              className="text-4xl font-bold"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(0,217,255,0.2)' }}
            >
              {step}
            </span>
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center border border-primary/20">
              <Icon className="w-5 h-5 text-primary" />
            </div>
          </div>
          <div>
            <h4 className="text-base font-semibold text-foreground mb-1" style={{ fontFamily: 'Space Grotesk' }}>
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

      {!isLast && (
        <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0 hidden md:block" />
      )}
    </div>
  );
}

export default function Home() {
  const heroRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const statNumRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const revealRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [, forceRender] = useState(0);

  // GSAP hero entrance
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      gsap.from('[data-hero-word]', {
        y: 40,
        opacity: 0,
        stagger: 0.15,
        duration: 0.8,
        ease: 'power3.out',
      });
      gsap.from('[data-badge]', {
        scale: 0.7,
        opacity: 0,
        stagger: 0.1,
        delay: 0.5,
        duration: 0.6,
        ease: 'back.out(2)',
      });
      if (ctaRef.current) {
        gsap.to(ctaRef.current, {
          scale: 1.03,
          duration: 0.45,
          ease: 'power1.inOut',
          yoyo: true,
          repeat: -1,
          repeatDelay: 2.1,
          delay: 3,
        });
      }
      gsap.from('[data-stat]', {
        opacity: 0,
        y: 12,
        stagger: 0.09,
        delay: 0.7,
        duration: 0.5,
        ease: 'power2.out',
      });
    }, heroRef);

    const tweens = STATS.map((stat, i) => {
      if (stat.num === 0) return null;
      const el = statNumRefs.current[i];
      if (!el) return null;
      const counter = { val: 0 };
      return gsap.to(counter, {
        val: stat.num,
        duration: 1.6,
        delay: 0.8 + i * 0.1,
        ease: 'power2.out',
        onUpdate() { el.textContent = Math.round(counter.val).toString(); },
      });
    });

    return () => {
      ctx.revert();
      tweens.forEach(t => t?.kill());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IntersectionObserver scroll-reveal for below-fold sections
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );

    revealRefs.current.forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  const handleRipple = (e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('div');
    Object.assign(ripple.style, {
      position: 'absolute',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.4)',
      width: '12px',
      height: '12px',
      top:  `${e.clientY - rect.top  - 6}px`,
      left: `${e.clientX - rect.left - 6}px`,
      pointerEvents: 'none',
    });
    btn.appendChild(ripple);
    gsap.fromTo(
      ripple,
      { scale: 0, opacity: 1 },
      { scale: 22, opacity: 0, duration: 0.7, ease: 'power2.out', onComplete: () => ripple.remove() },
    );
    forceRender(n => n + 1);
  };

  return (
    <div className="min-h-screen flex flex-col" ref={heroRef}>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div className="hero-section -mx-6 -mt-6 lg:-mx-8 lg:-mt-8 xl:-mx-10 xl:-mt-10 2xl:-mx-12 2xl:-mt-12 flex-1 flex items-center justify-center px-6 pt-8 pb-20 relative overflow-hidden">

        {/* Aurora / nebula blobs — GPU layers via transform: translateZ(0) in CSS */}
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
        <div className="aurora-blob aurora-blob-4" />

        {/* Dot grid */}
        <div className="dot-grid" />

        {/* Floating particles */}
        <div className="particle" style={{ bottom: '10%', left: '8%',  width: '5px', height: '5px', '--float-delay': '0s',   '--float-duration': '6s'   } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '20%', left: '20%', width: '4px', height: '4px', '--float-delay': '1.2s', '--float-duration': '5s'   } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '15%', left: '50%', width: '6px', height: '6px', '--float-delay': '2.4s', '--float-duration': '7s'   } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '25%', left: '70%', width: '4px', height: '4px', '--float-delay': '0.6s', '--float-duration': '5.5s' } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '8%',  left: '85%', width: '5px', height: '5px', '--float-delay': '3.5s', '--float-duration': '6.5s' } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '30%', left: '38%', width: '4px', height: '4px', '--float-delay': '1.8s', '--float-duration': '4.5s' } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '18%', left: '60%', width: '7px', height: '7px', '--float-delay': '4s',   '--float-duration': '5.5s' } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '12%', left: '30%', width: '3px', height: '3px', '--float-delay': '2.8s', '--float-duration': '6s'   } as React.CSSProperties} />

        <div className="max-w-3xl xl:max-w-4xl 2xl:max-w-5xl text-center space-y-8 relative z-10">
          <div className="space-y-2">
            <h1
              className="font-black text-foreground leading-tight"
              style={{
                fontFamily: 'Space Grotesk',
                fontSize: 'clamp(3.5rem, 8vw, 6rem)',
                textShadow: '0 0 40px rgba(0,217,255,0.7), 0 0 80px rgba(0,217,255,0.3)',
              }}
            >
              <span data-hero-word className="inline-block mr-4">ASL</span>
              <span data-hero-word className="inline-block">Gesture</span>
            </h1>
            <h2
              className="text-gradient-animate font-black leading-tight"
              style={{
                fontFamily: 'Space Grotesk',
                fontSize: 'clamp(3.5rem, 8vw, 6rem)',
              }}
            >
              Recognition
            </h2>
          </div>

          <p data-hero-word className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Real-time American Sign Language gesture recognition using MediaPipe, ONNX Runtime, and face-touch detection.
            <span className="text-primary/80 font-medium"> Fully client-side — your data never leaves your device.</span>
          </p>

          {/* Badges */}
          <div className="flex flex-wrap justify-center gap-3">
            <span data-badge className="shimmer px-4 py-1.5 rounded-full text-xs font-mono font-bold bg-primary/15 text-primary border border-primary/30 tracking-widest">
              AI-POWERED
            </span>
            <span data-badge className="shimmer px-4 py-1.5 rounded-full text-xs font-mono font-bold bg-success/10 text-success border border-success/25 tracking-widest">
              OPEN SOURCE
            </span>
            <span data-badge className="shimmer px-4 py-1.5 rounded-full text-xs font-mono font-bold bg-warning/10 text-warning border border-warning/25 tracking-widest">
              BROWSER-NATIVE
            </span>
          </div>

          {/* CTA */}
          <Link href="/recognize">
            <button
              ref={ctaRef}
              className="btn-glow mt-4 flex items-center gap-3 px-12 py-5 rounded-xl text-xl font-bold mx-auto"
              onMouseDown={handleRipple}
            >
              <Camera className="w-6 h-6" />
              Start Recognition
            </button>
          </Link>

          {/* Stats with counters */}
          <div className="pt-2 flex flex-wrap justify-center gap-x-8 gap-y-2">
            {STATS.map((stat, i) => (
              <span
                key={i}
                data-stat
                className="text-xs font-mono text-muted-foreground"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {stat.prefix}
                <span ref={el => { statNumRefs.current[i] = el; }} className="text-primary font-bold">
                  {stat.num}
                </span>
                {stat.suffix}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── How it Works ───────────────────────────────────────────── */}
      <div
        className="scroll-reveal gradient-divider px-6 py-16"
        ref={el => { revealRefs.current[0] = el; }}
      >
        <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto">
          <div className="text-center mb-12 space-y-3">
            <p className="text-xs font-mono text-primary tracking-widest uppercase">Workflow</p>
            <h3
              className="text-3xl font-bold text-foreground"
              style={{ fontFamily: 'Space Grotesk', textShadow: '0 0 20px rgba(0,217,255,0.2)' }}
            >
              How it Works
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Three steps from raw camera feed to live sign recognition
            </p>
          </div>

          <div className="flex flex-col md:flex-row items-stretch gap-4">
            {HOW_IT_WORKS.map((item, i) => (
              <StepCard
                key={item.step}
                {...item}
                isLast={i === HOW_IT_WORKS.length - 1}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Why This Works ─────────────────────────────────────────── */}
      <div
        className="scroll-reveal gradient-divider bg-card/50 px-6 py-16"
        ref={el => { revealRefs.current[1] = el; }}
      >
        <div className="max-w-6xl xl:max-w-7xl 2xl:max-w-screen-xl mx-auto">
          <h3
            className="text-3xl font-bold text-foreground mb-12 text-center"
            style={{ fontFamily: 'Space Grotesk', textShadow: '0 0 20px rgba(0,217,255,0.2)' }}
          >
            Why This Works
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger-children"
            ref={el => { revealRefs.current[2] = el; }}
          >
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
              <div key={title} className="card-hover step-gradient-border bg-card rounded-xl p-6">
                <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-4 border border-primary/20">
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
      <div
        className="scroll-reveal gradient-divider px-6 py-12"
        ref={el => { revealRefs.current[3] = el; }}
      >
        <div className="max-w-6xl xl:max-w-7xl 2xl:max-w-screen-xl mx-auto">
          <h3 className="text-sm font-mono text-muted-foreground uppercase tracking-wide mb-6">
            Technology Stack
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children"
            ref={el => { revealRefs.current[4] = el; }}
          >
            {[
              { name: 'MediaPipe', desc: 'Hand + face landmarks' },
              { name: 'ONNX Runtime', desc: 'Primary inference engine' },
              { name: 'Face Touch', desc: 'Region interaction heuristic' },
              { name: 'React 19', desc: 'UI framework' },
              { name: 'Web Speech API', desc: 'Audio output' },
            ].map(({ name, desc }) => (
              <div key={name} className="bg-muted/50 rounded-lg p-4 border border-border hover:border-primary/30 transition-colors">
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
