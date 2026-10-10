# QualityGate Metrics Reference

When configuring quality gates in BehaviorOS DNA patterns, ensure the `type` field matches the metric keys expected by the QualityEngine.

## Supported Metric Keys

| Gate Type | Description | Typical Threshold |
|-----------|-------------|-------------------|
| `test_coverage` | Code coverage percentage | ≥ 80% |
| `lint_errors` | Number of lint violations | = 0 |
| `typecheck_errors` | TypeScript compilation errors | = 0 |
| `security_vulnerabilities` | Security scan results | = 0 |
| `performance_score` | Performance benchmark score | ≥ 60 |

## Operator Selection Guide

| Scenario | Recommended Operator | Example |
|----------|---------------------|---------|
| Coverage must meet minimum | `gte` (default) | `{ threshold: 80 }` |
| Errors must be zero | `lte` | `{ threshold: 0, operator: "lte" }` |
| Exact match required | `eq` | `{ threshold: 100, operator: "eq" }` |
| Must not equal value | `neq` | `{ threshold: -1, operator: "neq" }` |

## Common Pitfalls

1. **Type mismatch**: Using `type: "lint"` with metric `lint_errors: 5` will NOT fail because default `gte` operator checks `5 >= 0` which passes. Use `operator: "lte"` for error counts.

2. **Gate `type` vs metric key**: The gate's `type` field must EXACTLY match the metric key passed to `evaluate()`:
   - Gate: `{ type: "lint_errors", threshold: 0, operator: "lte" }`
   - Metric: `{ lint_errors: 5 }` ✓
   - Wrong: `{ lint: 5 }` ✗ (type mismatch — gate skipped)

3. **Null metrics**: Passing `null` or `undefined` to `evaluate()` returns `{ passed: true }` — null is treated as empty metrics object, not as failure.

4. **Gate returns type field**: The `failedGates` array now includes a `type` field showing which metric triggered the failure.

## Example DNA Configuration

```yaml
quality:
  - id: "coverage"
    type: "test_coverage"
    threshold: 80
    # Default operator: gte (minimum threshold)
    
  - id: "lint"
    type: "lint_errors"
    threshold: 0
    operator: "lte"  # Errors must be <= 0
    
  - id: "security"
    type: "security_vulnerabilities"
    threshold: 0
    operator: "lte"  # Vulnerabilities must be <= 0
```

## Result Shape

```typescript
interface QualityResult {
  passed: boolean;
  failedGates: Array<{
    id: string;
    expected: number;
    actual: number;
    type?: string;  // Gate type that failed
  }>;
  metrics: QualityMetrics;
}
```
