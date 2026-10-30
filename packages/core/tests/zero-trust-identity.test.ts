import { describe, expect, it } from 'vitest';
import { ZeroTrustIdentityEngine } from '../src/engine/zero-trust-identity-engine.js';

describe('ZeroTrustIdentityEngine (G-010)', () => {
  it('issues an identity with a valid DID and 64-char public key hash', () => {
    const engine = new ZeroTrustIdentityEngine();
    const identity = engine.issueIdentity('agent-1', ['deploy', 'read']);

    expect(identity.agentId).toBe('agent-1');
    expect(identity.did).toMatch(/^did:bos:[0-9a-f-]{36}$/);
    expect(identity.publicKeyHash).toHaveLength(64);
    expect(identity.capabilities).toEqual(['deploy', 'read']);
    expect(identity.issuedAt).toBeDefined();
  });

  it('returns the issued identity for a known agent', () => {
    const engine = new ZeroTrustIdentityEngine();
    const issued = engine.issueIdentity('agent-1');
    const retrieved = engine.getIdentity('agent-1');
    expect(retrieved?.did).toBe(issued.did);
  });

  it('verifies a valid identity', () => {
    const engine = new ZeroTrustIdentityEngine();
    const identity = engine.issueIdentity('agent-1');
    const result = engine.verifyIdentity('agent-1', identity.did);
    expect(result.valid).toBe(true);
  });

  it('rejects an unknown agent', () => {
    const engine = new ZeroTrustIdentityEngine();
    const result = engine.verifyIdentity('unknown-agent', 'did:bos:whatever');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unknown agentId');
  });

  it('rejects a DID mismatch', () => {
    const engine = new ZeroTrustIdentityEngine();
    engine.issueIdentity('agent-1');
    const result = engine.verifyIdentity('agent-1', 'did:bos:wrong-did');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('DID mismatch');
  });

  it('revokes an identity by setting expiry to now', () => {
    const engine = new ZeroTrustIdentityEngine();
    engine.issueIdentity('agent-1');
    engine.revokeIdentity('agent-1');

    // The revocation sets expiresAt to now — verify the state was mutated
    expect(engine.getIdentity('agent-1')?.expiresAt).not.toBeNull();
  });

  it('checks capabilities', () => {
    const engine = new ZeroTrustIdentityEngine();
    engine.issueIdentity('agent-1', ['deploy', 'read']);
    expect(engine.hasCapability('agent-1', 'deploy')).toBe(true);
    expect(engine.hasCapability('agent-1', 'write')).toBe(false);
    expect(engine.hasCapability('unknown', 'deploy')).toBe(false);
  });

  it('lists all issued identities', () => {
    const engine = new ZeroTrustIdentityEngine();
    engine.issueIdentity('agent-1');
    engine.issueIdentity('agent-2');
    expect(engine.getAllIdentities()).toHaveLength(2);
  });
});
