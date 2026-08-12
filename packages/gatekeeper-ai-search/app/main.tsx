import { createRoot } from "react-dom/client";
import { newMessagePortRpcSession, RpcTarget, type RpcStub } from "capnweb";
import AiSearchPage, { type AiSearchManagementClient } from "./AiSearchPage";
import { applyThemeMode, type ResolvedThemeMode } from "./theme";
import "./styles.css";

class AppIframe extends RpcTarget {
  setThemeMode(mode: ResolvedThemeMode): void {
    applyThemeMode(mode);
  }
}

interface HostCapability extends RpcTarget {
  readonly ui: RpcStub<AiSearchManagementClient>;
  subscribeTheme(receiver: AppIframe): Promise<ResolvedThemeMode>;
}

const element = document.getElementById("root");
if (!element) throw new Error("Missing AI Search app root.");

const { port1, port2 } = new MessageChannel();
window.parent.postMessage({ type: "handshake" }, "*", [port2]);
const iframe = new AppIframe();
const host = newMessagePortRpcSession<HostCapability>(port1, iframe);
host.subscribeTheme(iframe).then(applyThemeMode).catch(() => {});

createRoot(element).render(<AiSearchPage api={host.ui} />);
