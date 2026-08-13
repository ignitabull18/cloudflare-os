import { Field, h, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  SupermemoryOrganizationConfiguratorRpc,
  SupermemoryOrganizationConfiguratorValues,
} from "./organization-configurator-types";

export default {
  initial: {},
  isReady() { return true; },
  resourceUrl() { return "https://console.supermemory.ai/"; },
  render() {
    return <Section>
      <Field
        label="Supermemory organization"
        description="Grants explicit administrative access to spaces, scoped keys, and source connectors."
      />
    </Section>;
  },
} satisfies ConfiguratorUISpec<SupermemoryOrganizationConfiguratorRpc, SupermemoryOrganizationConfiguratorValues>;
