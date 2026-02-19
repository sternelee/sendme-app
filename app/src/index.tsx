import { render } from "solid-js/web";
import App from "./app";
import "./styles.css";

// Mobile debugging with vconsole (detect via userAgent)
if (/android|ios/i.test(navigator.userAgent)) {
  import("vconsole").then(({ default: VConsole }) => {
    new VConsole();
  });
}

render(() => <App />, document.getElementById("app") as HTMLElement);
