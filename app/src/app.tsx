import { lazy } from "solid-js";
import { Router, Route } from "@solidjs/router";

import "./styles.css";

// Lazy load route components
const Home = lazy(() => import("./routes/index"));
const Desktop = lazy(() => import("./routes/desktop"));
const Mobile = lazy(() => import("./routes/mobile"));

export default function App() {
  return (
    <Router root={(props) => <>{props.children}</>}>
      <Route path="/" component={Home} />
      <Route path="/desktop" component={Desktop} />
      <Route path="/mobile" component={Mobile} />
    </Router>
  );
}
