/**
 * Auth Modal Component
 * Combines login and register forms in a tabbed interface
 */

import { createSignal, Show } from "solid-js";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";
import { Motion, Presence } from "solid-motionone";
import { TbOutlineSparkles } from "solid-icons/tb";

export default function AuthModal() {
  const [activeTab, setActiveTab] = createSignal<"login" | "register">("login");

  return (
    <div class="min-h-screen flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-animate text-white selection:bg-purple-500/30 overflow-hidden relative">
      {/* Background blobs */}
      <div class="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[120px] animate-float" />
      <div class="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/10 rounded-full blur-[120px] animate-pulse" />

      <div class="max-w-md w-full space-y-10 relative z-10">
        {/* Header */}
        <Motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          class="text-center"
        >
          <div class="inline-flex items-center justify-center p-3 rounded-2xl bg-linear-to-br from-purple-500 to-indigo-600 mb-6 shadow-xl shadow-purple-500/20">
            <TbOutlineSparkles size={32} class="text-white" />
          </div>
          <h2 class="text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-white to-white/60">
            Sendme
          </h2>
          <p class="mt-4 text-white/40 font-medium">
            <Show when={activeTab() === "login"}>
              Sign in to access your secure P2P transfers
            </Show>
            <Show when={activeTab() === "register"}>
              Create an identity for decentralized sharing
            </Show>
          </p>
        </Motion.div>

        {/* Card */}
        <Motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          class="glass rounded-[2.5rem] p-1 shadow-2xl overflow-hidden"
        >
          <div class="p-8">
            {/* Tabs */}
            <div class="flex space-x-1 mb-8 bg-white/5 border border-white/5 p-1 rounded-2xl relative overflow-hidden">
              <div 
                class="absolute transition-all duration-300 ease-out bg-white/10 rounded-xl"
                style={{
                  left: "4px",
                  top: "4px",
                  bottom: "4px",
                  width: "calc(50% - 4px)",
                  transform: activeTab() === "register" ? "translateX(100%)" : "translateX(0)",
                }}
              />
              <button
                type="button"
                onClick={() => setActiveTab("login")}
                class={`flex-1 relative z-10 py-2.5 px-4 rounded-xl font-semibold transition-all ${
                  activeTab() === "login" ? "text-white" : "text-white/40 hover:text-white/60"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("register")}
                class={`flex-1 relative z-10 py-2.5 px-4 rounded-xl font-semibold transition-all ${
                  activeTab() === "register" ? "text-white" : "text-white/40 hover:text-white/60"
                }`}
              >
                Sign Up
              </button>
            </div>

            {/* Forms with Presence for smooth transition */}
            <Presence exitBeforeEnter>
              <Motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                <Show when={activeTab() === "login"} fallback={<RegisterForm />}>
                  <LoginForm />
                </Show>
              </Motion.div>
            </Presence>
          </div>
        </Motion.div>

        {/* Footer */}
        <Motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          class="text-center text-sm"
        >
          <p class="text-white/30">
            Secure • Decentralized • End-to-End Encrypted
          </p>
        </Motion.div>
      </div>
    </div>
  );
}
