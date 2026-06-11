/**
 * App.tsx — Root application component (production demo)
 * Routes: Home, Recognize, Dataset, Train, Evaluate, Settings, About
 * Providers: AppContext, ThemeProvider, TooltipProvider
 */

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppProvider, useApp } from "./contexts/AppContext";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import RecognizePage from "./pages/RecognizePage";
import AboutPage from "./pages/AboutPage";
import DatasetPage from "./pages/DatasetPage";
import TrainPage from "./pages/TrainPage";
import EvaluatePage from "./pages/EvaluatePage";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";
import { useEffect } from "react";
import { loadModel, getLoadingState } from "./ml/inferenceModel";

/**
 * ModelLoader — Loads the pre-trained model on app startup
 */
function ModelLoader() {
  const { setModelLoading, setModelReady, setModelError } = useApp();

  useEffect(() => {
    const loadModelAsync = async () => {
      setModelLoading(true);
      const success = await loadModel();
      if (success) {
        setModelReady(true);
        setModelError(null);
      } else {
        const { loadError } = getLoadingState();
        setModelError(loadError || 'Failed to load model');
        setModelReady(false);
      }
      setModelLoading(false);
    };

    loadModelAsync();
  }, [setModelLoading, setModelReady, setModelError]);

  return null;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/recognize" component={RecognizePage} />
        <Route path="/dataset" component={DatasetPage} />
        <Route path="/train" component={TrainPage} />
        <Route path="/evaluate" component={EvaluatePage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/about" component={AboutPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AppInner() {
  return (
    <>
      <ModelLoader />
      <Router />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <AppProvider>
          <TooltipProvider>
            <Toaster position="bottom-right" theme="dark" />
            <AppInner />
          </TooltipProvider>
        </AppProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
