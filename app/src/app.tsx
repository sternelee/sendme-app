import {
  Show,
  Suspense,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from "solid-js";
import { Router, Route } from "@solidjs/router";
import { AuthProvider } from "./lib/auth";
import { useAuth } from "./lib/auth";
import { SplashScreen } from "./lib/components/SplashScreen";
import { GlobalStoreProvider } from "./lib/store";
import "./styles.css";

const Home = lazy(() => import("./routes/index"));

function AppRouter() {
  const auth = useAuth();
  const [minimumElapsed, setMinimumElapsed] = createSignal(false);

  onMount(() => {
    const timer = window.setTimeout(() => setMinimumElapsed(true), 900);
    onCleanup(() => window.clearTimeout(timer));
  });

  const appReady = createMemo(() => auth.isLoaded() && minimumElapsed());

  return (
    <Show
      when={appReady()}
      fallback={<SplashScreen stage={auth.isLoaded() ? "shell" : "auth"} />}
    >
      <Suspense fallback={<SplashScreen stage="shell" />}>
        <Router root={(props) => <>{props.children}</>}>
          <Route path="/" component={Home} />
        </Router>
      </Suspense>
    </Show>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <GlobalStoreProvider>
        <AppRouter />
      </GlobalStoreProvider>
    </AuthProvider>
  );
}
