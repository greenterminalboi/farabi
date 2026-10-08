// Feature 014 server API (contracts/engine-api.md § Server).
export { generateScene, checkReply, validateInput, VizGenerationError, MAX_SOURCE_CHARS, VIZ_FAMILIES, type GenerateInput, type GenerateOptions } from "./generate";
export { installVizFakes, fakeScene, VIZ_TAG } from "./fake";
export { VIZ_SYSTEM, SCENE_GUIDE, vizPrompt, type VizFamilyHint } from "./prompt";
