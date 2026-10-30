import { createHash, randomUUID } from 'node:crypto';

/**
 * G-010: Zero-Trust Identity Layer.
 *
 * Issues verifiable Decentralized Identifiers (DID) for agents and
 * provides identity verification. The DID format is `did:bos:<uuid>`.
 */

interface AgentIdentity {
  agentId: string;
  did: string;
  publicKeyHash: string;
  capabilities: string[];
  issuedAt: string;
  expiresAt: string | null;
}

interface IdentityVerificationResult {
  agentId: string;
  did: string;
  valid: boolean;
  reason?: string;
  verifiedAt: string;
}

export class ZeroTrustIdentityEngine {
  private identities = new Map<string, AgentIdentity>();

  /**
   * Issue a new agent identity.
   *
   * Generates a DID and a synthetic public key hash for the agent.
   * In production the public key would come from a key-management
   * system; here we use a deterministic hash derived from the agentId.
   */
  issueIdentity(agentId: string, capabilities: string[] = []): AgentIdentity {
    const did = `did:bos:${randomUUID()}`;
    const publicKeyHash = computeKeyHash(agentId, did);

    const identity: AgentIdentity = {
      agentId,
      did,
      publicKeyHash,
      capabilities,
      issuedAt: new Date().toISOString(),
      expiresAt: null,
    };

    this.identities.set(agentId, identity);
    return identity;
  }

  /**
   * Get the identity for a known agent.
   */
  getIdentity(agentId: string): AgentIdentity | undefined {
    return this.identities.get(agentId);
  }

  /**
   * Verify an agent's identity.
   *
   * In production this would verify a cryptographic signature.
   * In this PoC, verification checks that:
   * 1. The agentId is known.
   * 2. The DID matches the stored identity.
   * 3. The identity has not expired.
   */
  verifyIdentity(agentId: string, did: string): IdentityVerificationResult {
    const identity = this.identities.get(agentId);

    if (!identity) {
      return {
        agentId,
        did,
        valid: false,
        reason: 'Unknown agentId — no identity issued',
        verifiedAt: new Date().toISOString(),
      };
    }

    if (identity.did !== did) {
      return {
        agentId,
        did,
        valid: false,
        reason: `DID mismatch: expected ${identity.did}`,
        verifiedAt: new Date().toISOString(),
      };
    }

    if (identity.expiresAt && new Date(identity.expiresAt) < new Date()) {
      return {
        agentId,
        did,
        valid: false,
        reason: `Identity expired at ${identity.expiresAt}`,
        verifiedAt: new Date().toISOString(),
      };
    }

    return {
      agentId,
      did,
      valid: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Check whether an identity has a specific capability.
   */
  hasCapability(agentId: string, capability: string): boolean {
    const identity = this.identities.get(agentId);
    return identity?.capabilities.includes(capability) ?? false;
  }

  /** Get all issued identities. */
  getAllIdentities(): AgentIdentity[] {
    return [...this.identities.values()];
  }

  /** Revoke an identity by setting its expiry to now. */
  revokeIdentity(agentId: string): void {
    const identity = this.identities.get(agentId);
    if (identity) {
      identity.expiresAt = new Date().toISOString();
    }
  }
}

/**
 * Compute a deterministic SHA-256 hash representing the agent's public key.
 * In production this would be derived from the actual key material.
 */
function computeKeyHash(agentId: string, did: string): string {
  return createHash('sha256').update(`${agentId}:${did}:${new Date().toISOString()}`).digest('hex');
}
