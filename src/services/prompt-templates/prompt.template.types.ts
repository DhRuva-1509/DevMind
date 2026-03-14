export type PRSize = 'small' | 'medium' | 'large';

export interface PRSizeThresholds {
  smallMaxLines: number;
  mediumMaxLines: number;
}

export interface PromptVersion {
  version: string;
  createdAt: string;
  changelog: string;
  author: string;
}

export type ABVariant = 'control' | 'experiment';

export interface ABTestConfig {
  testName: string;
  controlWeight: number;
  expiresAt: string | null;
  active: boolean;
}

export type PromptTemplateId =
  | 'pr-summary-system'
  | 'pr-summary-context'
  | 'pr-summary-context-small'
  | 'pr-summary-context-medium'
  | 'pr-summary-context-large'
  | 'pr-summary-fallback'
  | 'pr-summary-error';

export interface PromptTemplate {
  id: PromptTemplateId;
  name: string;
  template: string;
  version: PromptVersion;
  targetSize: PRSize | null;
  abVariant: ABVariant | null;
  abTestConfig: ABTestConfig | null;
  blobKey: string;
  maxTokens: number;
}

/** Variables injected into the context template at render time */
export interface PRSummaryTemplateVars extends Record<string, unknown> {
  // PR metadata
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prState: string;
  headBranch: string;
  baseBranch: string;
  prUrl: string;
  prBody: string;
  prSize: PRSize;

  // File summary
  totalFilesChanged: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  totalAdditions: number;
  totalDeletions: number;
  fileList: string;

  // Diffs (may be truncated for large PRs)
  diffSummary: string;

  // Commits
  commitSummary: string;

  // Issues
  linkedIssues: string;

  // Patterns
  codePatterns: string;

  // Token info
  contextTokens: number;
  wasTruncated: boolean;
}

export interface RenderedPrompt {
  systemPrompt: string;
  contextPrompt: string;
  templateVersions: {
    system: string;
    context: string;
  };
  abVariant: ABVariant | null;
  prSize: PRSize;
  estimatedTokens: number;
  usedFallback: boolean;
}

export interface PromptTemplateBlobManifest {
  latestVersion: string;
  versions: PromptVersion[];
  activeTests: ABTestConfig[];
  updatedAt: string;
}

export interface PromptTemplateConfig {
  containerName?: string;
  blobPrefix?: string;
  enableCache?: boolean;
  cacheTtlMs?: number;
  sizeThresholds?: PRSizeThresholds;
  enableLogging?: boolean;
  activeAbTest?: string | null;
}

export class PromptTemplateError extends Error {
  constructor(
    message: string,
    public readonly templateId: string
  ) {
    super(message);
    this.name = 'PromptTemplateError';
  }
}

export class PromptTemplateNotFoundError extends PromptTemplateError {
  constructor(templateId: string) {
    super(`Prompt template not found: ${templateId}`, templateId);
    this.name = 'PromptTemplateNotFoundError';
  }
}

export class PromptTemplateRenderError extends PromptTemplateError {
  constructor(templateId: string, cause: string) {
    super(`Failed to render template ${templateId}: ${cause}`, templateId);
    this.name = 'PromptTemplateRenderError';
  }
}
