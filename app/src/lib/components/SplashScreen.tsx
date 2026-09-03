import { For, createMemo } from "solid-js";
import { Radio, Shield, Zap } from "lucide-solid";
import { i18n } from "@sendme/shared";

const t = i18n.t;

type SplashStage = "auth" | "shell";

interface SplashScreenProps {
  stage: SplashStage;
}

const stepIcons = [Shield, Zap, Radio];

export function SplashScreen(props: SplashScreenProps) {
  const activeStep = createMemo(() => (props.stage === "auth" ? 1 : 2));
  const status = createMemo(() =>
    props.stage === "auth" ? t("splash.loadingAuth") : t("splash.loadingShell"),
  );
  const steps = createMemo(() => [
    t("splash.stepNetwork"),
    t("splash.stepPreferences"),
    t("splash.stepWorkspace"),
  ]);

  return (
    <div class="app-shell splash-screen">
      <div class="splash-card">
        <div class="splash-card__brand">
          <div class="splash-card__logo">
            <Radio class="size-6" />
          </div>
          <div class="space-y-1">
            <p class="section-label">{t("splash.eyebrow")}</p>
            <h1 class="text-base-content text-3xl font-semibold tracking-tight">
              {t("splash.title")}
            </h1>
          </div>
        </div>

        <p class="text-base-content/65 max-w-sm text-sm leading-6">
          {t("splash.subtitle")}
        </p>

        <div class="splash-card__status">
          <div class="splash-card__status-row">
            <span class="splash-card__pulse" />
            <span class="text-base-content text-sm font-medium">
              {status()}
            </span>
          </div>
          <div class="splash-card__progress">
            <div class="splash-card__progress-bar" />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <For each={steps()}>
            {(step, index) => {
              const Icon = stepIcons[index()];
              const isComplete = () => index() < activeStep();
              const isCurrent = () => index() === activeStep();

              return (
                <div
                  class={`splash-step ${
                    isComplete()
                      ? "splash-step--complete"
                      : isCurrent()
                        ? "splash-step--current"
                        : ""
                  }`}
                >
                  <div class="splash-step__icon">
                    <Icon class="size-4" />
                  </div>
                  <span>{step}</span>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
