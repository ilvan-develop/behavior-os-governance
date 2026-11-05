import { describe, expect, it } from 'vitest';
import {
  AgentIdentitySchema,
  BehaviorProfileSchema,
  ExternalPolicySchema,
  RiskAssessmentSchema,
} from '../src/index.js';

describe('schema surface (must resolve the current TypeScript source)', () => {
  it('exposes the newer runtime schema constants defined only in index.ts', () => {
    for (const schema of [
      AgentIdentitySchema,
      BehaviorProfileSchema,
      ExternalPolicySchema,
      RiskAssessmentSchema,
    ]) {
      expect(schema).toBeDefined();
      expect(typeof (schema as unknown as { safeParse?: unknown }).safeParse).toBe('function');
    }
  });
});
