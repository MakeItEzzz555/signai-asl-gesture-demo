/**
 * Layout.tsx — Main layout with sidebar navigation
 *
 * Production demo version:
 * - Minimal navigation (Home, Recognize, About)
 * - Status bar showing model and camera state
 * - Accessibility controls
 */

import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import {
  Home, Camera, Info, Settings, Database, Brain, BarChart3,
  ChevronLeft, ChevronRight, Sun, Moon, Contrast,
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

  return (
    <div className={cn(
      "min-h-screen flex bg-background text-foreground",
      "transition-colors duration-300"
    )}>
      {/* Sidebar */}
      <aside className={cn(
        "border-r border-border flex flex-col transition-all duration-300",
        expanded ? "w-56" : "w-20"
      )}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border">
          {expanded && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <span className="text-xs font-bold text-primary">ASL</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
                  SignAI
                </span>
                <span className="text-[10px] text-muted-foreground">v1.0</span>
              </div>
            </div>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors"
          >
            {expanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-2">
          {NAV_ITEMS.map(({ path, icon: Icon, label, description }) => (
            <Link key={path} href={path}>
              <button className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium",
                location === path
                  ? "bg-primary/15 text-primary border border-primary/30 glow-cyan"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
          ))}
        </nav>

        {/* Accessibility Controls */}
        <div className="border-t border-border p-3 space-y-2">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            {expanded && <span className="text-xs text-muted-foreground">{theme === 'dark' ? 'Dark' : 'Light'}</span>}
          </button>

          {/* High contrast */}
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

          {/* Text size */}
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

          {/* Audio */}
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
        <div className="border-t border-border p-3 space-y-2 text-xs">
          {/* ONNX / base model status */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full flex-shrink-0",
              modelReady ? "bg-success animate-pulse" : modelLoading ? "bg-warning animate-spin" : "bg-destructive"
            )} />
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
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
