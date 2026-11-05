#!/usr/bin/env node
/**
 * Issue an HMAC approval token for a governed policy version.
 *
 * Usage:
 *   BEHAVIOR_OS_APPROVAL_KEY=<shared-secret> \
 *     node scripts/policy-approval-token.mjs <policyId> <versionId> <contentHash> "<rationale>"
 *
 * The payload contract matches `policyApprovalPayload` in
 * `packages/core/src/engine/learning-engine.ts`:
 *   `${policyId}|${versionId}|${contentHash}|${rationale}`
 *
 * Keep the rationale byte-for-byte identical to the one passed to
 * `approvePolicyVersion`, otherwise the token will not verify.
 */
import { createHmac } from 'node:crypto';

const [policyId, versionId, contentHash, ...rationaleParts] = process.argv.slice(2);
const rationale = rationaleParts.join(' ').trim();

if (!policyId || !versionId || !contentHash || !rationale) {
  console.error(
    'usage: node scripts/policy-approval-token.mjs <policyId> <versionId> <contentHash> "<rationale>"',
  );
  process.exit(2);
}

const key = process.env.BEHAVIOR_OS_APPROVAL_KEY;
if (!key) {
  console.error('BEHAVIOR_OS_APPROVAL_KEY must be set in the environment');
  process.exit(2);
}

const token = createHmac('sha256', key)
  .update(`${policyId}|${versionId}|${contentHash}|${rationale}`)
  .digest('hex');

console.log(token);
