import { ProtocolStepSchema } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_STEP_COUNT, PROTOCOL_STEPS } from '../src/engine/behavior-os.js';

// The 7-step protocol is declared once, in `PROTOCOL_STEPS`, and consumed by the
// MCP resource and the OpenCode plugin. These checks keep that single definition
// valid and self-consistent (docs/CLAIMS.md and docs/PROTOCOL.md quote it).
describe('PROTOCOL_STEPS', () => {
  it('has the declared number of steps', () => {
    expect(PROTOCOL_STEPS).toHaveLength(PROTOCOL_STEP_COUNT);
    expect(PROTOCOL_STEP_COUNT).toBe(7);
  });

  it('parses every step with ProtocolStepSchema', () => {
    for (const step of PROTOCOL_STEPS) {
      expect(() => ProtocolStepSchema.parse(step), step.name).not.toThrow();
    }
  });

  it('numbers the steps 1..7 in order', () => {
    expect(PROTOCOL_STEPS.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('names a distinct bos_* tool per step', () => {
    const tools = PROTOCOL_STEPS.map((step) => step.tool);
    expect(new Set(tools).size).toBe(tools.length);
    for (const tool of tools) expect(tool.startsWith('bos_')).toBe(true);
  });

  it('gives every step a non-empty name and description', () => {
    for (const step of PROTOCOL_STEPS) {
      expect(step.name.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
    }
  });
});
