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

  it('revokes an identity by recording an explicit revocation', () => {
    const engine = new ZeroTrustIdentityEngine();
    engine.issueIdentity('agent-1');
    engine.revokeIdentity('agent-1');

    const identity = engine.getIdentity('agent-1');
    expect(identity?.revokedAt).toBeTruthy();
    // Revocation is state, not an expiry trick.
    expect(identity?.expiresAt).toBeNull();
  });

  // S-01 regression: revocation must be immediate, monotonic and enforced by
  // the capability gate, not only by a timestamp comparison.
  it('verification rejects a revoked identity immediately', () => {
    const engine = new ZeroTrustIdentityEngine();
    const issued = engine.issueIdentity('agent-1');
    engine.revokeIdentity('agent-1');

    const result = engine.verifyIdentity('agent-1', issued.did);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('revoked');
  });

  it('removes capabilities immediately on revocation', () => {
    const engine = new ZeroTrustIdentityEngine();
    engine.issueIdentity('agent-1', ['deploy', 'read']);
    expect(engine.hasCapability('agent-1', 'deploy')).toBe(true);

    engine.revokeIdentity('agent-1');
    expect(engine.hasCapability('agent-1', 'deploy')).toBe(false);
    expect(engine.hasCapability('agent-1', 'read')).toBe(false);
  });

  it('cannot be un-revoked by moving the expiry into the future', () => {
    const engine = new ZeroTrustIdentityEngine();
    const issued = engine.issueIdentity('agent-1', ['deploy']);
    engine.revokeIdentity('agent-1');
    const identity = engine.getIdentity('agent-1');
    if (identity) identity.expiresAt = new Date(Date.now() + 60_000).toISOString();

    expect(engine.verifyIdentity('agent-1', issued.did).valid).toBe(false);
    expect(engine.hasCapability('agent-1', 'deploy')).toBe(false);
  });

  it('treats an expired identity as unverified and without capabilities', () => {
    const engine = new ZeroTrustIdentityEngine();
    const issued = engine.issueIdentity('agent-1', ['deploy']);
    const identity = engine.getIdentity('agent-1');
    if (identity) identity.expiresAt = new Date(Date.now() - 1_000).toISOString();

    expect(engine.verifyIdentity('agent-1', issued.did).valid).toBe(false);
    expect(engine.hasCapability('agent-1', 'deploy')).toBe(false);
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
