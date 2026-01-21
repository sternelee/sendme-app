import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { Toaster } from "solid-toast";
import { AuthProvider } from "./lib/contexts/user-better-auth";
import "./app.css";

export default function App() {
  return (
    <AuthProvider>
      <Router
        root={(props) => (
          <>
            <Suspense fallback={<div>Loading...</div>}>
              {props.children}
            </Suspense>
            <Toaster position="bottom-center" />
          </>
        )}
      >
        <FileRoutes />
      </Router>
    </AuthProvider>
  );
}
