# Behavior-OS DNA Patterns

## Built-in Patterns

### 1. Surgical Team
**File:** `dnas/surgical-team.yaml`

Zero-defect governance inspired by surgical protocols. Best for critical systems where errors are not acceptable.

**Key Features:**
- 100% test coverage required
- Zero lint errors
- Zero security vulnerabilities
- Sterile field protocol (blocks unapproved production changes)
- Timeout verification for deployments

**Use Case:** Production deployments, financial systems, healthcare applications

---

### 2. Enterprise Governance
**File:** `dnas/enterprise-governance.yaml`

Compliance-focused governance for regulated industries. Best for enterprise environments.

**Key Features:**
- 80% test coverage minimum
- Change management requirements
- PII data protection rules
- Audit trail generation
- Access control enforcement

**Use Case:** Banking, fintech, healthcare, government applications

---

### 3. Military Operations
**File:** `dnas/military-operations.yaml`

Chain of command and mission-focused operations. Best for high-stakes coordination.

**Key Features:**
- Strict chain of command
- Mission-critical prioritization
- After-action reviews
- Clearance-based access
- Radio silence (minimize distractions)

**Use Case:** Defense, emergency response, critical infrastructure

---

### 4. Lean Factory
**File:** `dnas/lean-factory.yaml`

Continuous improvement and waste elimination. Best for iterative development.

**Key Features:**
- 70% test coverage minimum
- Waste elimination rules
- Kaizen improvement cycles
- Value stream mapping
- Just-in-time delivery

**Use Case:** Startups, agile teams, continuous improvement

---

## Creating Custom Patterns

To create a custom DNA pattern:

```yaml
name: my-custom-pattern
version: "1.0.0"
description: "Custom governance pattern"

personas:
  - role: developer
    name: Custom Developer
    authority: developer
    boundaries:
      - id: max-files
        type: max_files
        value: 10
    skills: [coding, testing, reviewing]

governance:
  - id: custom-rule
    level: critical
    action: block
    conditions:
      - type: production
        value: true
    description: "Block unapproved production changes"

quality:
  - id: coverage
    type: test_coverage
    threshold: 85
  - id: lint
    type: lint
    threshold: 0

workflows:
  - id: deploy
    name: Deployment Workflow
    steps:
      - id: "1"
        name: Pre-deploy check
        required: true
        approvalRequired: true
      - id: "2"
        name: Deploy
        required: true
      - id: "3"
        name: Post-deploy verification
        required: true
```

## Pattern Comparison

| Pattern | Coverage | Lint | Security | Best For |
|---------|----------|------|----------|----------|
| Surgical Team | 100% | 0 errors | 0 vulns | Critical systems |
| Enterprise Governance | 80% | 0 errors | Review | Regulated industries |
| Military Operations | 75% | 0 errors | Classified | High-stakes ops |
| Lean Factory | 70% | 0 errors | Standard | Agile teams |
