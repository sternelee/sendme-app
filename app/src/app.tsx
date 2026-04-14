import { Router, Route } from "@solidjs/router";
import { AuthProvider } from "./lib/auth";
import { GlobalStoreProvider } from "./lib/store";
import Home from "./routes/index";
import "./styles.css";

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
