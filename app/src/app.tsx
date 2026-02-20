import { lazy } from "solid-js";
import { Router, Route } from "@solidjs/router";

import "./styles.css";

// Lazy load route component
const Home = lazy(() => import("./routes/index"));

export default function App() {
  return (
    <Router root={(props) => <>{props.children}</>}>
      <Route path="/" component={Home} />
    </Router>
  );
}
