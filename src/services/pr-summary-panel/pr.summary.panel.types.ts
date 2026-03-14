import { PRSummary } from '../pr-summary/pr.summary.types';

export type PanelLoadingState = 'idle' | 'loading' | 'success' | 'error';

export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface LinkedIssueDisplay {
  number: number;
  title: string | null;
  source: string;
  url: string | null;
}

export interface PRSummaryPanelState {
  loadingState: PanelLoadingState;
  prNumber: number | null;
  prTitle: string | null;
  prAuthor: string | null;
  prUrl: string | null;
  repoLabel: string | null;
  summary: string | null;
  riskLevel: RiskLevel;
  linkedIssues: LinkedIssueDisplay[];
  errorMessage: string | null;
  generatedAt: string | null;
  wasChunked: boolean;
  chunkCount: number;
  templateVersion: string | null;
}

export type PanelMessageType =
  | 'copy'
  | 'post-to-pr'
  | 'regenerate'
  | 'open-issue'
  | 'dismiss-error';

export interface PanelMessage {
  command: PanelMessageType;
  payload?: unknown;
}

export const PR_SUMMARY_COMMANDS = {
  SHOW_PANEL: 'devmind.showPRSummaryPanel',
  GENERATE: 'devmind.generatePRSummary',
  REGENERATE: 'devmind.regeneratePRSummary',
  COPY_SUMMARY: 'devmind.copyPRSummary',
  POST_TO_PR: 'devmind.postPRSummaryToGitHub',
} as const;
