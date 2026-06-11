import { Link } from 'wouter';
import { Camera, Home, Hand } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6">
      <div className="text-center space-y-8 max-w-md">

        {/* Animated hand icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center animate-pulse">
            <Hand className="w-10 h-10 text-primary/60" />
          </div>
        </div>

        {/* 404 */}
        <div className="space-y-3">
          <p
            className="text-7xl font-bold text-primary glow-cyan-text leading-none"
            style={{ fontFamily: 'JetBrains Mono, monospace' }}
          >
            404
          </p>
          <h1
            className="text-2xl font-bold text-foreground"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            Page not found
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The page you requested does not exist. It may have been moved, deleted,
            or you may have followed a broken link.
          </p>
        </div>

        {/* Divider */}
        <div className="h-px bg-border" />

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/">
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity glow-cyan w-full sm:w-auto justify-center">
              <Home className="w-4 h-4" />
              Go Home
            </button>
          </Link>
          <Link href="/recognize">
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-card border border-border text-foreground text-sm font-semibold hover:bg-muted transition-colors w-full sm:w-auto justify-center">
              <Camera className="w-4 h-4" />
              Try Recognition
            </button>
          </Link>
        </div>

        {/* Status hint */}
        <p className="text-[11px] font-mono text-muted-foreground/60">
          SignAI v1.0 · All processing is client-side
        </p>
      </div>
    </div>
  );
}
