/**
 * Tool-surface parity between the MCP server and the OpenCode plugin.
 *
 * Both hosts register the same `bos_*` catalogue from two hand-written
 * surfaces. Until now nothing proved they agreed: names could drift, and an
 * input property could exist in one host only, so the same tool would accept a
 * different contract depending on how it was called.
 *
 * This module measures both surfaces *at runtime* (MCP `tools/list` over an
 * in-memory transport, plugin `setup()` with a capturing editor) and compares:
 *
 *   - names: every MCP tool must be served by the plugin;
 *   - inputs: the JSON Schema property names and required lists must match;
 *   - descriptions: reported, not enforced (the plugin may be richer).
 *
 * Differences that are deliberate must be declared in `INTENTIONAL` with a
 * reason, so "parity" never means "identical by accident".
 *
 * Usage: node scripts/tool-parity.mjs   (prints the drift, exits 1 on failure)
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Declared, reviewed differences between the two surfaces. */
export const INTENTIONAL = {
  // The plugin always has these: autonomous loops run inside the host only.
  bos_start_loop: { pluginOnly: true, reason: 'loop orchestration is host-specific' },
  bos_resume_loop: { pluginOnly: true, reason: 'loop orchestration is host-specific' },
  bos_loop_status: { pluginOnly: true, reason: 'loop orchestration is host-specific' },
  bos_approve_loop: { pluginOnly: true, reason: 'loop orchestration is host-specific' },
};

const asStringArray = (value) =>
  Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];

/** Normalized shape of one tool, independent of the host's schema library. */
export function normalizeTool({ name, description, inputSchema }) {
  const properties = inputSchema?.properties ?? {};
  return {
    name,
    description: typeof description === 'string' ? description : '',
    properties: Object.keys(properties).sort(),
    required: asStringArray(inputSchema?.required).slice().sort(),
  };
}

/**
 * Compare the two normalized surfaces.
 *
 * Returns `{ failures: string[], intentional: string[], shared: number }`.
 * Only violations are failures; declared plugin-only tools and declared input
 * differences are reported as intentional.
 */
export function compareSurfaces(mcpTools, pluginTools) {
  const mcp = new Map(mcpTools.map((tool) => [tool.name, tool]));
  const plugin = new Map(pluginTools.map((tool) => [tool.name, tool]));
  const failures = [];
  const intentional = [];

  for (const name of [...mcp.keys()].sort()) {
    if (!plugin.has(name)) {
      failures.push(`missing in plugin: ${name}`);
    }
  }

  for (const name of [...plugin.keys()].sort()) {
    if (mcp.has(name)) continue;
    const declared = INTENTIONAL[name];
    if (declared?.pluginOnly) {
      intentional.push(`${name} (plugin-only: ${declared.reason})`);
    } else {
      failures.push(`missing in MCP: ${name}`);
    }
  }

  for (const [name, mcpTool] of [...mcp.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pluginTool = plugin.get(name);
    if (!pluginTool) continue;

    const declared = INTENTIONAL[name] ?? {};
    const mcpOnly = mcpTool.properties.filter(
      (property) =>
        !pluginTool.properties.includes(property) && !declared.mcpOnly?.includes(property),
    );
    const pluginOnly = pluginTool.properties.filter(
      (property) =>
        !mcpTool.properties.includes(property) &&
        !declared.pluginOnlyProperties?.includes(property),
    );
    const requiredDrift = mcpTool.required.filter(
      (property) => !pluginTool.required.includes(property),
    );
    const requiredExtra = pluginTool.required.filter(
      (property) => !mcpTool.required.includes(property),
    );

    if (mcpOnly.length > 0) {
      failures.push(`${name}: input property only in MCP -> ${mcpOnly.join(', ')}`);
    }
    if (pluginOnly.length > 0) {
      failures.push(`${name}: input property only in plugin -> ${pluginOnly.join(', ')}`);
    }
    if (requiredDrift.length > 0) {
      failures.push(`${name}: required only in MCP -> ${requiredDrift.join(', ')}`);
    }
    if (requiredExtra.length > 0) {
      failures.push(`${name}: required only in plugin -> ${requiredExtra.join(', ')}`);
    }
  }

  return {
    failures,
    intentional,
    shared: [...mcp.keys()].filter((name) => plugin.has(name)).length,
  };
}

/** Minimal context the plugin `setup()` needs; captures every registered tool. */
function createCapturingContext(directory, addedTools) {
  const noopHook = async () => ({ dispose: async () => {} });
  const storage = new Map();
  const agents = [
    { id: 'build', name: 'Build', system: 'You are the build agent.' },
    { id: 'review', name: 'Review' },
  ];

  return {
    location: { directory },
    agent: {
      transform: async (callback) => {
        await callback({
          list: () => agents,
          get: (id) => agents.find((agent) => agent.id === id),
          update: () => {},
          remove: () => {},
          default: () => {},
        });
      },
    },
    tool: {
      transform: async (callback) => {
        await callback({
          add: (tool) => addedTools.push(tool),
          namespace: () => {},
          update: () => {},
          remove: () => {},
        });
      },
      hook: noopHook,
    },
    session: { hook: noopHook, synthetic: async () => {} },
    permission: { hook: noopHook },
    event: {
      subscribe: async function* (options) {
        if (options?.signal) {
          await new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('AbortError')), {
              once: true,
            });
          });
        }
      },
    },
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => {
        storage.set(key, value);
      },
      remove: async (key) => {
        storage.delete(key);
      },
      scan: async () => ({ entries: [] }),
    },
  };
}

/** Runtime MCP surface: connect the real server over an in-memory transport. */
export async function collectMcpTools(repoRoot) {
  // pnpm links the SDK into the MCP package only, so resolve from that
  // manifest instead of assuming a hoisted root node_modules.
  const requireFromMcp = createRequire(resolve(repoRoot, 'packages/mcp-server/package.json'));
  const sdkPath = (specifier) => pathToFileURL(requireFromMcp.resolve(specifier)).href;
  const { Client } = await import(sdkPath('@modelcontextprotocol/sdk/client/index.js'));
  const { InMemoryTransport } = await import(sdkPath('@modelcontextprotocol/sdk/inMemory.js'));
  const { server } = await import(
    pathToFileURL(resolve(repoRoot, 'packages/mcp-server/dist/server.js')).href
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tool-parity', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.map(normalizeTool);
  } finally {
    await client.close();
    await server.close();
  }
}

/** Runtime plugin surface: boot the real plugin and capture editor.add calls. */
export async function collectPluginTools(repoRoot) {
  // Booting the plugin must never touch a real workspace DB or the durable
  // audit sink; the repository's isolation guard enforces this pin before setup.
  process.env.BEHAVIOROS_DB_PATH = ':memory:';
  process.env.BEHAVIOR_OS_AUDIT_LOG = '';
  const pluginModule = await import(
    pathToFileURL(resolve(repoRoot, 'plugins/opencode-v2/dist/index.js')).href
  );
  const plugin = pluginModule.default;
  const addedTools = [];
  await plugin.setup(createCapturingContext(repoRoot, addedTools));
  return addedTools.map((tool) =>
    normalizeTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input,
    }),
  );
}
