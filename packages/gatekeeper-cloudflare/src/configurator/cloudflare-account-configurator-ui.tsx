import { Autocomplete, Field, h, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  CloudflareAccountConfiguratorRpc,
  CloudflareAccountConfiguratorValues,
} from "./cloudflare-account-configurator-types";

export default {
  initial: {},

  isReady({ values }) {
    return typeof values.accountId === "string" && values.accountId.length === 32;
  },

  resourceUrl({ values }) {
    return `https://dash.cloudflare.com/${values.accountId}`;
  },

  render({ values, setValues, ui }) {
    return <Section>
      <Field label="Cloudflare account" description="Choose the account whose inventory this workspace may read.">
        <Autocomplete
          name="accountId"
          value={values.accountId}
          placeholder="Search Cloudflare accounts..."
          loadOptions={query => ui.listAccounts(query)}
          onChange={accountId => setValues({ accountId })}
        />
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<CloudflareAccountConfiguratorRpc, CloudflareAccountConfiguratorValues>;
