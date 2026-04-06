import { lazy } from "solid-js";
import { Router, Route } from "@solidjs/router";
import { AuthProvider } from "./lib/auth";
import { GlobalStoreProvider } from "./lib/store";
import "./styles.css";

const Home = lazy(() => import("./routes/index"));

export default function App() {
  return (
    <AuthProvider>
      <GlobalStoreProvider>
        <Router root={(props) => <>{props.children}</>}>
          <Route path="/" component={Home} />
        </Router>
      </GlobalStoreProvider>
    </AuthProvider>
  );
}
