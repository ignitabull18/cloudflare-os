import { Autocomplete, Field, h, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  SupermemoryContainerConfiguratorRpc,
  SupermemoryContainerConfiguratorValues,
} from "./container-configurator-types";

export default {
  initial: {},

  isReady({ values }) {
    return typeof values.containerTag === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(values.containerTag);
  },

  resourceUrl({ values }) {
    return `https://api.supermemory.ai/v3/container-tags/${encodeURIComponent(values.containerTag!)}`;
  },

  render({ values, setValues, ui }) {
    return <Section>
      <Field label="Memory space" description="Choose an isolated container for this workspace or agent.">
        <Autocomplete
          name="containerTag"
          value={values.containerTag}
          placeholder="Search Supermemory spaces..."
          loadOptions={query => ui.listContainers(query)}
          onChange={containerTag => setValues({ containerTag })}
        />
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<SupermemoryContainerConfiguratorRpc, SupermemoryContainerConfiguratorValues>;
