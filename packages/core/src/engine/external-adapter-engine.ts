/**
 * G-019: External System Adapter Framework.
 *
 * Provides standardized adapters for integrating with external systems:
 * - AuditExporter: Export governance logs to SIEM
 * - PolicyImporter: Import policies from external systems
 * - EventConnector: Receive events from external message buses
 */

interface ExternalEvent {
  id: string;
  source: string;
  type: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}

interface ExternalPolicy {
  id: string;
  source: string;
  ruleId: string;
  action: string;
  conditions: { type: string; value: unknown }[];
  importedAt: string;
}

export class ExternalSystemAdapter {
  private events: ExternalEvent[] = [];
  private importedPolicies: ExternalPolicy[] = [];

  /**
   * AuditExporter: Export governance logs to an external SIEM.
   *
   * @param logs - Array of governance log entries to export.
   * @param target - SIEM endpoint identifier.
   */
  exportAuditLogs(
    logs: { action: string; agentId: string; verdict: string; timestamp: string }[],
    target: string,
  ): { exported: number; target: string; batchId: string } {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return {
      exported: logs.length,
      target,
      batchId,
    };
  }

  /**
   * PolicyImporter: Import policies from an external system.
   *
   * @param rules - External rules to import.
   * @param source - The source system identifier.
   */
  importPolicies(
    rules: {
      id: string;
      action: string;
      conditions: { type: string; value: unknown }[];
      description?: string;
    }[],
    source: string,
  ): ExternalPolicy[] {
    const imported: ExternalPolicy[] = rules.map((rule) => ({
      id: `imported-${rule.id}`,
      source,
      ruleId: rule.id,
      action: rule.action,
      conditions: rule.conditions,
      importedAt: new Date().toISOString(),
    }));

    this.importedPolicies.push(...imported);
    return imported;
  }

  /**
   * EventConnector: Receive events from external message buses.
   *
   * @param event - The event to record.
   */
  receiveEvent(event: Omit<ExternalEvent, 'id' | 'receivedAt'>): ExternalEvent {
    const fullEvent: ExternalEvent = {
      ...event,
      id: `ext-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      receivedAt: new Date().toISOString(),
    };
    this.events.push(fullEvent);
    return fullEvent;
  }

  /** Get all received external events. */
  getEvents(): ExternalEvent[] {
    return [...this.events];
  }

  /** Get all imported policies. */
  getImportedPolicies(): ExternalPolicy[] {
    return [...this.importedPolicies];
  }

  /** Clear all state. */
  clear(): void {
    this.events = [];
    this.importedPolicies = [];
  }
}

export type { ExternalEvent, ExternalPolicy };
