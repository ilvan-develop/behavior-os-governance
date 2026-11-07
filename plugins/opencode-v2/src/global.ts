import { Plugin } from '@opencode/plugin';
import type { Context } from '@opencode/plugin/promise/plugin';
import basePlugin, { hasProjectLoader } from './index.js';

/**
 * User-level (global) OpenCode host.
 *
 * It has a distinct plugin id and entry point so it can coexist with the
 * project loader without colliding at the plugin registry. It also yields when
 * the project ships its own loader: `setup()` would otherwise register the same
 * 102 `bos_*` tools twice. The shared engine is the module singleton exported
 * by `./index.js`, so only one host ever activates per location.
 *
 * Outside this repository, the global host keeps the opt-in gate of the base
 * plugin: without `.behavioros/config.json` it only registers `/bos-init`.
 */
export default Plugin.define({
  id: 'behavior-os-global',
  async setup(ctx: Context): Promise<(() => Promise<void> | void) | void> {
    if (hasProjectLoader(ctx.location.directory)) {
      console.log(
        `[Behavior-OS] Global host dormant in ${ctx.location.directory}: ` +
          'the project loader owns the 102 bos_* tools.',
      );
      return;
    }
    return basePlugin.setup(ctx);
  },
});
