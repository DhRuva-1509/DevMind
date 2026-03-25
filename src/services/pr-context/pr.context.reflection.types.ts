import { ExtractedPRContext } from './pr.context.types';

// ─── Quality checks ────────────────────────────────────────────────────────────

export type QualityCheckName = 'token_budget' | 'field_completeness' | 'pattern_coverage';

export type QualityCheckStatus = 'pass' | 'fail';

export interface QualityCheckResult {
  name: QualityCheckName;
  status: QualityCheckStatus;
  reason: string | null;
  measuredValue: number;
  threshold: number;
}

export type QualityFlag = 'good' | 'degraded';

export interface ReflectionResult {
  passed: boolean;
  checks: QualityCheckResult[];
  retryCount: number;
  qualityFlag: QualityFlag;
  failureReasons: string[];
}

export interface ReflectionConfig {
  tokenBudget?: number;
  maxRetries?: number;
  retryBudgetFactor?: number;
  enabled?: boolean;
}

export interface ReflectionTelemetryEntry {
  id: string;
  type: 'reflection-failure';
  owner: string;
  repo: string;
  prNumber: number;
  qualityFlag: QualityFlag;
  failureReasons: string[];
  retryCount: number;
  checks: QualityCheckResult[];
  loggedAt: string;
}

export const DEFAULT_REFLECTION_CONFIG: Required<ReflectionConfig> = {
  tokenBudget: 6000,
  maxRetries: 2,
  retryBudgetFactor: 0.75,
  enabled: true,
};
