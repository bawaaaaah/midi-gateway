import type { Transform } from "../context.js";
import type { TransformConfig } from "../types.js";
import { createChannelRemap } from "./channelRemap.js";
import { createTranspose } from "./transpose.js";
import { createVelocity } from "./velocity.js";
import { createFilter } from "./filter.js";
import { createCcRemap } from "./ccRemap.js";
import { createKeyboardMapper } from "./keyboardMapper.js";
import { createCombo } from "./combo.js";
import { createLearnTap } from "./learnTap.js";

export { createChannelRemap } from "./channelRemap.js";
export { createTranspose } from "./transpose.js";
export { createVelocity } from "./velocity.js";
export { createFilter } from "./filter.js";
export { createCcRemap } from "./ccRemap.js";
export { createKeyboardMapper, bucketOf } from "./keyboardMapper.js";
export { createCombo } from "./combo.js";
export { createLearnTap } from "./learnTap.js";

/** Build a live {@link Transform} from its serialisable config. */
export function createTransform(cfg: TransformConfig): Transform {
  switch (cfg.type) {
    case "channelRemap":
      return createChannelRemap(cfg);
    case "transpose":
      return createTranspose(cfg);
    case "velocity":
      return createVelocity(cfg);
    case "filter":
      return createFilter(cfg);
    case "ccRemap":
      return createCcRemap(cfg);
    case "keyboardMapper":
      return createKeyboardMapper(cfg);
    case "combo":
      return createCombo(cfg);
    case "learnTap":
      return createLearnTap(cfg);
  }
}
