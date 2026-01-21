// @refresh reload
import { mount, StartClient } from "@solidjs/start/client";
import Vconsole from "vconsole";

new Vconsole();

mount(() => <StartClient />, document.getElementById("app")!);
