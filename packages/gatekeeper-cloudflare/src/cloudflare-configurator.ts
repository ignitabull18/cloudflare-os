import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import { listAccounts } from "./cloudflare-api.js";
import type { CloudflareAccountConfiguratorRpc } from "./configurator/cloudflare-account-configurator-types";

type ConfiguratorOption = { value: string; title: string; subtitle?: string; meta?: string };

const tokenGetters = new WeakMap<object, () => Promise<string>>();
const accountCaches = new WeakMap<object, ReturnType<typeof listAccounts>>();

@validateRpc()
export class CloudflareAccountConfiguratorUI extends RpcTarget implements CloudflareAccountConfiguratorRpc {
  constructor(getToken: () => Promise<string>) {
    super();
    tokenGetters.set(this, getToken);
  }

  async listAccounts(query: string): Promise<ConfiguratorOption[]> {
    const getToken = tokenGetters.get(this);
    if (!getToken) throw new Error("Cloudflare configurator is not initialized.");
    let accounts = accountCaches.get(this);
    if (!accounts) {
      accounts = getToken().then(token => listAccounts(token));
      accountCaches.set(this, accounts);
      accounts.catch(() => accountCaches.delete(this));
    }
    const search = query.trim().toLowerCase();
    return (await accounts)
      .filter(account => !search || `${account.accountName} ${account.accountId}`.toLowerCase().includes(search))
      .slice(0, 100)
      .map(account => ({
        value: account.accountId,
        title: account.accountName,
        subtitle: account.accountId,
      }));
  }
}
