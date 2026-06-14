import { Link, useLocation } from 'wouter';
import { useState, useEffect, useRef } from 'react';
import {
  Home, Camera, Info, Settings, Database, Brain, BarChart3,
  ChevronLeft, Sun, Moon, Contrast,
  Type, Volume2, VolumeX
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { path: '/', icon: Home, label: 'Home', description: 'Overview' },
  { path: '/recognize', icon: Camera, label: 'Recognize', description: 'Live Recognition' },
  { path: '/dataset', icon: Database, label: 'Dataset', description: 'Record Samples' },
  { path: '/train', icon: Brain, label: 'Train', description: 'Custom Model' },
  { path: '/evaluate', icon: BarChart3, label: 'Evaluate', description: 'Model Metrics' },
  { path: '/settings', icon: Settings, label: 'Settings', description: 'Accessibility' },
  { path: '/about', icon: Info, label: 'About', description: 'Technical Info' },
];

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [expanded, setExpanded] = useState(true);
  const { accessibility, setAccessibility, modelReady, modelLoading } = useApp();
  const { theme, toggleTheme } = useTheme();

  const mainRef = useRef<HTMLElement>(null);
  const scrollProgressRef = useRef<HTMLDivElement>(null);

  // Scroll progress bar — scaleX transform (GPU composited)
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = main;
        const progress = scrollHeight <= clientHeight
          ? 0
          : scrollTop / (scrollHeight - clientHeight);
        if (scrollProgressRef.current) {
          scrollProgressRef.current.style.transform = `scaleX(${progress})`;
        }
      });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className={cn(
      "h-screen overflow-hidden flex bg-background text-foreground",
      "transition-colors duration-300"
    )}>
      {/* Scroll progress bar */}
      <div ref={scrollProgressRef} className="scroll-progress" />

      {/* Sidebar */}
      <aside className={cn(
        "border-r border-border flex flex-col transition-all duration-300 sidebar-depth relative overflow-hidden",
        expanded ? "w-56" : "w-20"
      )}>

        {/* Ambient particles */}
        <div className="particle" style={{ bottom: '8%',  left: '15%', width: '4px', height: '4px', '--float-delay': '0s',   '--float-duration': '6s'   } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '20%', left: '58%', width: '5px', height: '5px', '--float-delay': '1.5s', '--float-duration': '5s'   } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '12%', left: '38%', width: '4px', height: '4px', '--float-delay': '3s',   '--float-duration': '7s'   } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '28%', left: '72%', width: '6px', height: '6px', '--float-delay': '0.8s', '--float-duration': '5.5s' } as React.CSSProperties} />
        <div className="particle" style={{ bottom: '16%', left: '45%', width: '8px', height: '8px', '--float-delay': '4s',   '--float-duration': '4.5s' } as React.CSSProperties} />

        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border relative z-10">
          {expanded && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center glow-pulse">
                <span className="text-xs font-bold text-primary">ASL</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-primary" style={{ fontFamily: 'Space Grotesk' }}>
                  Gesto
                </span>
                <span className="text-[10px] text-muted-foreground">v1.0</span>
              </div>
            </div>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors"
          >
            <ChevronLeft className={cn(
              'w-4 h-4 transition-transform duration-300',
              !expanded && 'rotate-180',
            )} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-2 relative z-10">
          {NAV_ITEMS.map(({ path, icon: Icon, label, description }) => {
            const isActive = location === path;
            return (
              <Link key={path} href={path}>
                <button className={cn(
                  "nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium",
                  isActive
                    ? "nav-active bg-primary/25 text-primary border border-primary/50 shadow-[0_0_24px_rgba(0,217,255,0.28),inset_0_0_14px_rgba(0,217,255,0.08)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/80 hover:border-primary/20 border border-transparent"
                )}>
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {expanded && (
                    <div className="flex-1 text-left">
                      <p className="text-xs font-semibold">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{description}</p>
                    </div>
                  )}
                </button>
              </Link>
            );
          })}
        </nav>

        {/* Accessibility Controls */}
        <div className="border-t border-border p-3 space-y-2 relative z-10">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            {expanded && <span className="text-xs text-muted-foreground">{theme === 'dark' ? 'Dark' : 'Light'}</span>}
          </button>

          <button
            onClick={() => setAccessibility({ highContrast: !accessibility.highContrast })}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
              accessibility.highContrast
                ? "bg-primary/15 text-primary"
                : "hover:bg-muted text-muted-foreground"
            )}
            title="High contrast mode"
          >
            <Contrast className="w-4 h-4" />
            {expanded && <span className="text-xs">{accessibility.highContrast ? 'HC ON' : 'HC OFF'}</span>}
          </button>

          <button
            onClick={() => {
              const sizes: ('normal' | 'large' | 'xl')[] = ['normal', 'large', 'xl'];
              const current = sizes.indexOf(accessibility.textSize);
              setAccessibility({ textSize: sizes[(current + 1) % sizes.length] });
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm"
            title="Adjust text size"
          >
            <Type className="w-4 h-4" />
            {expanded && <span className="text-xs text-muted-foreground">{accessibility.textSize}</span>}
          </button>

          <button
            onClick={() => setAccessibility({ audioEnabled: !accessibility.audioEnabled })}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
              accessibility.audioEnabled
                ? "hover:bg-muted text-muted-foreground"
                : "bg-destructive/15 text-destructive"
            )}
            title="Toggle audio"
          >
            {accessibility.audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {expanded && <span className="text-xs">{accessibility.audioEnabled ? 'Audio ON' : 'Audio OFF'}</span>}
          </button>
        </div>

        {/* Status Bar */}
        <div className="border-t border-border p-3 space-y-2 text-xs relative z-10">
          <div className="flex items-center gap-2">
            {modelReady ? (
              <div className="ring-ping flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-success" />
              </div>
            ) : (
              <div className={cn(
                "w-2 h-2 rounded-full flex-shrink-0",
                modelLoading ? "bg-warning animate-pulse" : "bg-destructive"
              )} />
            )}
            <span className="text-muted-foreground truncate">
              {modelReady ? 'ONNX: Ready' : modelLoading ? 'ONNX: Loading…' : 'ONNX: Error'}
            </span>
          </div>

          {expanded && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              {modelReady ? 'Ready for recognition' : modelLoading ? 'Initializing model…' : 'Model failed to load'}
            </p>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          transform: 'translateZ(0)',
        } as React.CSSProperties}
      >
        <div className="page-enter w-full p-6 lg:p-8 xl:p-10 2xl:p-12">
          {children}
        </div>
      </main>
    </div>
  );
}
