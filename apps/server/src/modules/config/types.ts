import type { ConfigSection, SectionCapability } from "./shared/sections.js";
import type { ProviderId } from "@taskpilot/shared";

/** What each config section of a CLI supports (GET /api/config/capabilities). */
export interface ConfigCapabilitiesView {
  cli: ProviderId;
  clis: readonly ProviderId[];
  sections: Record<ConfigSection, SectionCapability>;
}
