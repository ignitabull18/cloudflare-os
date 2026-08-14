import { createRoot } from "react-dom/client";
import { RpcTarget, newMessagePortRpcSession, type RpcStub } from "capnweb";
import App, { type OpenCliManagementClient } from "./App";
import "./styles.css";

type ThemeMode = "light" | "dark";

class AppIframe extends RpcTarget {
  setThemeMode(mode: ThemeMode): void { document.documentElement.dataset.mode = mode; }
}

interface HostCapability extends RpcTarget {
  readonly ui: RpcStub<OpenCliManagementClient>;
  subscribeTheme(receiver: AppIframe): Promise<ThemeMode>;
  openExternalUrl(url: string): Promise<void>;
}

const element = document.getElementById("root");
if (!element) throw new Error("Missing OpenCLI app root.");
const { port1, port2 } = new MessageChannel();
window.parent.postMessage({ type: "handshake" }, "*", [port2]);
const iframe = new AppIframe();
const host = newMessagePortRpcSession<HostCapability>(port1, iframe);
host.subscribeTheme(iframe).then(mode => iframe.setThemeMode(mode)).catch(() => {});
createRoot(element).render(<App api={host.ui} openExternalUrl={url => host.openExternalUrl(url)} />);
