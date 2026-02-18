import { Router, Route } from "@solidjs/router";

import "./styles.css";

// Explicit routes for better control
import Home from "./routes/home";
import Desktop from "./routes/desktop";
import Mobile from "./routes/mobile";

export default function App() {
  return (
    <Router
      root={(props) => props.children}
    >
      <Route path="/" component={Home} />
      <Route path="/desktop" component={Desktop} />
      <Route path="/mobile" component={Mobile} />
    </Router>
  );
}
