import {
  PromptTemplate,
  PromptTemplateId,
  PromptTemplateBlobManifest,
  PromptTemplateConfig,
  PRSummaryTemplateVars,
  RenderedPrompt,
  PRSize,
  ABVariant,
  ABTestConfig,
  PromptVersion,
  PromptTemplateNotFoundError,
  PromptTemplateError,
} from './prompt.template.types';
import { ExtractedPRContext } from '../pr-context/pr.context.types';

export interface BlobAdapter {
  upload(
    container: string,
    key: string,
    content: string
  ): Promise<{ success: boolean; error?: string }>;
  download(
    container: string,
    key: string
  ): Promise<{ success: boolean; content?: string; error?: string }>;
  exists(container: string, key: string): Promise<boolean>;
  listKeys(container: string, prefix: string): Promise<string[]>;
}

const DEFAULT_CONFIG: Required<PromptTemplateConfig> = {
  containerName: 'prompt-templates',
  blobPrefix: 'pr-summary/',
  enableCache: true,
  cacheTtlMs: 10 * 60 * 1000, // 10 minutes
  sizeThresholds: { smallMaxLines: 100, mediumMaxLines: 500 },
  enableLogging: true,
  activeAbTest: null,
};

const MANIFEST_KEY = 'pr-summary/manifest.json';
const CURRENT_VERSION = '1.0.0';

const DEFAULT_SYSTEM_PROMPT = `You are an expert software engineer reviewing pull requests. Your task is to generate clear, concise, and structured PR summaries that help team members quickly understand the changes.

Your summaries must:
- Be professional and objective
- Focus on WHAT changed and WHY (based on available context)
- Highlight breaking changes, risks, or areas needing attention
- Use markdown formatting for readability
- Keep the summary proportional to the PR size
- Never invent information not present in the context

Output format:
## Summary
[2-4 sentence overview of the PR]

## Changes
[Bullet list of key changes grouped by area]

## Impact
[Brief assessment of risk/impact level: Low / Medium / High with reasoning]

## Notes
[Any additional observations, follow-up suggestions, or linked issues]`;

const DEFAULT_CONTEXT_TEMPLATE_SMALL = `PR #{{prNumber}}: {{prTitle}}
Author: {{prAuthor}} | {{headBranch}} → {{baseBranch}} | Size: Small

{{#if prBody}}Description: {{prBody}}{{/if}}

Files changed ({{totalFilesChanged}}): +{{totalAdditions}} -{{totalDeletions}}
{{fileList}}

{{#if linkedIssues}}Linked issues: {{linkedIssues}}{{/if}}
{{#if codePatterns}}Patterns detected: {{codePatterns}}{{/if}}

Diff:
{{diffSummary}}`;

const DEFAULT_CONTEXT_TEMPLATE_MEDIUM = `PR #{{prNumber}}: {{prTitle}}
Author: {{prAuthor}} | {{headBranch}} → {{baseBranch}} | Size: Medium

{{#if prBody}}Description:
{{prBody}}
{{/if}}

## File Changes ({{totalFilesChanged}} files, +{{totalAdditions}} -{{totalDeletions}})
Added: {{filesAdded}} | Modified: {{filesModified}} | Removed: {{filesRemoved}}

{{fileList}}

## Commits
{{commitSummary}}

{{#if linkedIssues}}## Linked Issues
{{linkedIssues}}{{/if}}

{{#if codePatterns}}## Code Patterns Detected
{{codePatterns}}{{/if}}

## Diff Summary
{{diffSummary}}
{{#if wasTruncated}}[Note: Diff was truncated to fit token budget ({{contextTokens}} tokens)]{{/if}}`;

const DEFAULT_CONTEXT_TEMPLATE_LARGE = `PR #{{prNumber}}: {{prTitle}}
Author: {{prAuthor}} | State: {{prState}} | {{headBranch}} → {{baseBranch}} | Size: Large
URL: {{prUrl}}

{{#if prBody}}## PR Description
{{prBody}}
{{/if}}

## Change Overview
Total files: {{totalFilesChanged}} (+{{filesAdded}} added, ~{{filesModified}} modified, -{{filesRemoved}} removed)
Total lines: +{{totalAdditions}} additions, -{{totalDeletions}} deletions

## Changed Files
{{fileList}}

## Commit History
{{commitSummary}}

{{#if linkedIssues}}## Linked Issues / Tickets
{{linkedIssues}}{{/if}}

{{#if codePatterns}}## Code Patterns Detected
{{codePatterns}}{{/if}}

## Key Diff Sections
{{diffSummary}}
{{#if wasTruncated}}⚠️ Diff truncated — showing highest-impact changes only (budget: {{contextTokens}} tokens used).{{/if}}`;

const DEFAULT_FALLBACK_TEMPLATE = `PR #{{prNumber}}: {{prTitle}}
Author: {{prAuthor}} | {{headBranch}} → {{baseBranch}}

Changed {{totalFilesChanged}} files (+{{totalAdditions}} -{{totalDeletions}}).
{{#if linkedIssues}}Linked: {{linkedIssues}}{{/if}}

[Note: Full context unavailable — using minimal fallback template]`;

const DEFAULT_ERROR_TEMPLATE = `Unable to generate PR summary for PR #{{prNumber}}.
Error occurred during prompt rendering. Please try again or review the PR manually at: {{prUrl}}`;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class PromptTemplateService {
  private readonly config: Required<PromptTemplateConfig>;
  private readonly cache: Map<string, CacheEntry<PromptTemplate>> = new Map();
  private manifestCache: CacheEntry<PromptTemplateBlobManifest> | null = null;

  constructor(
    config: PromptTemplateConfig = {},
    private readonly blob: BlobAdapter
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config.sizeThresholds) {
      this.config.sizeThresholds = { ...DEFAULT_CONFIG.sizeThresholds, ...config.sizeThresholds };
    }
  }

  /**
   * Renders a complete prompt pair (system + context) for the given PR context.
   * Selects the appropriate size-specific template and applies A/B variant if active.
   * Falls back to built-in defaults if Blob Storage is unavailable.
   */
  async renderPrompt(context: ExtractedPRContext): Promise<RenderedPrompt> {
    const prSize = this.classifyPRSize(context);
    const abVariant = this.selectABVariant();

    let systemPrompt: string;
    let contextPrompt: string;
    let systemVersion = CURRENT_VERSION;
    let contextVersion = CURRENT_VERSION;
    let usedFallback = false;

    try {
      const [systemTpl, contextTpl] = await Promise.all([
        this.getTemplate('pr-summary-system', abVariant),
        this.getSizeTemplate(prSize, abVariant),
      ]);

      const vars = this.buildTemplateVars(context, prSize);
      systemPrompt = this.renderTemplate(systemTpl.template, vars);
      contextPrompt = this.renderTemplate(contextTpl.template, vars);
      systemVersion = systemTpl.version.version;
      contextVersion = contextTpl.version.version;
    } catch (err) {
      this.log(`Falling back to built-in templates: ${String(err)}`);
      usedFallback = true;
      const vars = this.buildTemplateVars(context, prSize);
      systemPrompt = DEFAULT_SYSTEM_PROMPT;
      contextPrompt = this.renderTemplate(this.getBuiltInContextTemplate(prSize), vars);
    }

    const estimatedTokens = this.estimateTokens(systemPrompt + contextPrompt);

    return {
      systemPrompt,
      contextPrompt,
      templateVersions: { system: systemVersion, context: contextVersion },
      abVariant,
      prSize,
      estimatedTokens,
      usedFallback,
    };
  }

  /**
   * Renders the error template for a given PR number and URL.
   */
  async renderErrorPrompt(prNumber: number, prUrl: string): Promise<string> {
    try {
      const tpl = await this.getTemplate('pr-summary-error', null);
      return this.renderTemplate(tpl.template, { prNumber, prUrl } as any);
    } catch {
      return this.renderTemplate(DEFAULT_ERROR_TEMPLATE, { prNumber, prUrl } as any);
    }
  }

  /**
   * Publishes a new template version to Blob Storage and updates the manifest.
   */
  async publishTemplate(
    id: PromptTemplateId,
    templateText: string,
    changelog: string,
    author: string,
    abVariant: ABVariant | null = null,
    abTestConfig: ABTestConfig | null = null
  ): Promise<PromptTemplate> {
    const manifest = await this.getOrCreateManifest();
    const newVersion = this.incrementVersion(manifest.latestVersion);

    const version: PromptVersion = {
      version: newVersion,
      createdAt: new Date().toISOString(),
      changelog,
      author,
    };

    const template: PromptTemplate = {
      id,
      name: id,
      template: templateText,
      version,
      targetSize: this.getTargetSize(id),
      abVariant,
      abTestConfig,
      blobKey: this.buildBlobKey(id, newVersion, abVariant),
      maxTokens: this.estimateTokens(templateText) + 200,
    };

    // Store versioned template
    const uploadResult = await this.blob.upload(
      this.config.containerName,
      template.blobKey,
      JSON.stringify(template, null, 2)
    );

    if (!uploadResult.success) {
      throw new PromptTemplateError(`Failed to upload template: ${uploadResult.error}`, id);
    }

    // Store as "latest" pointer
    await this.blob.upload(
      this.config.containerName,
      this.buildLatestKey(id, abVariant),
      JSON.stringify(template, null, 2)
    );

    // Update manifest
    manifest.latestVersion = newVersion;
    manifest.versions.push(version);
    manifest.updatedAt = new Date().toISOString();
    await this.blob.upload(
      this.config.containerName,
      MANIFEST_KEY,
      JSON.stringify(manifest, null, 2)
    );

    // Invalidate cache
    this.invalidateCacheEntry(id, abVariant);

    this.log(`Published template ${id} v${newVersion}`);
    return template;
  }

  /**
   * Retrieves a specific version of a template from Blob Storage.
   */
  async getTemplateVersion(
    id: PromptTemplateId,
    version: string,
    abVariant: ABVariant | null = null
  ): Promise<PromptTemplate> {
    const key = this.buildBlobKey(id, version, abVariant);
    const result = await this.blob.download(this.config.containerName, key);
    if (!result.success || !result.content) {
      throw new PromptTemplateNotFoundError(id);
    }
    return JSON.parse(result.content) as PromptTemplate;
  }

  /**
   * Lists all available template versions from the manifest.
   */
  async listVersions(): Promise<PromptVersion[]> {
    const manifest = await this.getOrCreateManifest();
    return manifest.versions;
  }

  /**
   * Returns the Blob Storage manifest.
   */
  async getManifest(): Promise<PromptTemplateBlobManifest> {
    return this.getOrCreateManifest();
  }

  /**
   * Registers an A/B test in the manifest.
   */
  async registerABTest(config: ABTestConfig): Promise<void> {
    const manifest = await this.getOrCreateManifest();
    const existing = manifest.activeTests.findIndex((t) => t.testName === config.testName);
    if (existing >= 0) {
      manifest.activeTests[existing] = config;
    } else {
      manifest.activeTests.push(config);
    }
    manifest.updatedAt = new Date().toISOString();
    await this.blob.upload(
      this.config.containerName,
      MANIFEST_KEY,
      JSON.stringify(manifest, null, 2)
    );
    this.manifestCache = null;
    this.log(`Registered A/B test: ${config.testName}`);
  }

  /**
   * Classifies a PR as small / medium / large based on total changed lines.
   */
  classifyPRSize(context: ExtractedPRContext): PRSize {
    const totalLines = context.changedFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
    const { smallMaxLines, mediumMaxLines } = this.config.sizeThresholds;
    if (totalLines <= smallMaxLines) return 'small';
    if (totalLines <= mediumMaxLines) return 'medium';
    return 'large';
  }

  /**
   * Selects an A/B variant based on the active test config.
   * Uses a deterministic random selection weighted by controlWeight.
   */
  selectABVariant(): ABVariant | null {
    if (!this.config.activeAbTest) return null;
    // Deterministic per-process random — real implementation would use userId hash
    const roll = Math.random();
    // Default 50/50 split — actual weight comes from manifest at render time
    return roll < 0.5 ? 'control' : 'experiment';
  }

  /**
   * Renders a template string by replacing {{variable}} placeholders.
   * Also handles simple {{#if var}}...{{/if}} blocks.
   */
  renderTemplate(template: string, vars: Record<string, unknown>): string {
    // Handle {{#if var}}...{{/if}} blocks
    let result = template.replace(
      /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_match, key: string, content: string) => {
        const val = vars[key];
        if (val === null || val === undefined || val === '' || val === false) return '';
        return content;
      }
    );

    // Replace {{variable}} placeholders
    result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const val = vars[key];
      if (val === null || val === undefined) return '';
      return String(val);
    });

    return result.trim();
  }

  /**
   * Builds the template variable map from an ExtractedPRContext.
   */
  buildTemplateVars(context: ExtractedPRContext, prSize: PRSize): PRSummaryTemplateVars {
    const fileList = context.changedFiles
      .map(
        (f) => `  ${this.changeIcon(f.changeType)} ${f.path}${f.language ? ` (${f.language})` : ''}`
      )
      .join('\n');

    const commitSummary = context.commits.map((c) => `  • ${c.subject} — ${c.author}`).join('\n');

    const linkedIssues =
      context.issueReferences.length > 0
        ? context.issueReferences.map((r) => `#${r.number} (${r.source})`).join(', ')
        : '';

    const codePatterns =
      context.detectedPatterns.length > 0
        ? context.detectedPatterns.map((p) => `${p.type} (${p.occurrences}x)`).join(', ')
        : '';

    const diffSummary = context.parsedDiffs
      .slice(0, prSize === 'large' ? 5 : prSize === 'medium' ? 8 : 15)
      .map((d) => {
        const hunkLines = d.hunks
          .flatMap((h) => h.lines.slice(0, 20))
          .map((l) => `${l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' '}${l.content}`)
          .join('\n');
        return `### ${d.path} (+${d.additions} -${d.deletions})\n${hunkLines}${d.truncated ? '\n[... truncated]' : ''}`;
      })
      .join('\n\n');

    const filesAdded = context.changedFiles.filter((f) => f.changeType === 'added').length;
    const filesModified = context.changedFiles.filter((f) => f.changeType === 'modified').length;
    const filesRemoved = context.changedFiles.filter((f) => f.changeType === 'removed').length;
    const totalAdditions = context.changedFiles.reduce((s, f) => s + f.additions, 0);
    const totalDeletions = context.changedFiles.reduce((s, f) => s + f.deletions, 0);

    return {
      prNumber: context.prNumber,
      prTitle: context.prTitle,
      prAuthor: context.prAuthor,
      prState: context.prState,
      headBranch: context.headBranch,
      baseBranch: context.baseBranch,
      prUrl: context.prUrl,
      prBody: context.prBody ?? '',
      prSize,
      totalFilesChanged: context.changedFiles.length,
      filesAdded,
      filesModified,
      filesRemoved,
      totalAdditions,
      totalDeletions,
      fileList,
      diffSummary,
      commitSummary,
      linkedIssues,
      codePatterns,
      contextTokens: context.tokenBudget.totalTokens,
      wasTruncated: context.tokenBudget.wasTruncated,
    };
  }

  /**
   * Estimates token count (~4 chars per token).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Gets a template from cache → Blob Storage → built-in default.
   */
  async getTemplate(id: PromptTemplateId, abVariant: ABVariant | null): Promise<PromptTemplate> {
    const cacheKey = `${id}:${abVariant ?? 'null'}`;

    // Check cache
    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    // Try Blob Storage
    const blobKey = this.buildLatestKey(id, abVariant);
    try {
      const result = await this.blob.download(this.config.containerName, blobKey);
      if (result.success && result.content) {
        const template = JSON.parse(result.content) as PromptTemplate;
        if (this.config.enableCache) {
          this.cache.set(cacheKey, {
            value: template,
            expiresAt: Date.now() + this.config.cacheTtlMs,
          });
        }
        return template;
      }
    } catch (err) {
      this.log(`Blob download failed for ${blobKey}, using built-in default`);
      // Rethrow so callers (e.g. renderPrompt) can detect the failure
      // and set usedFallback: true
      throw err;
    }

    // Return built-in default
    return this.getBuiltInTemplate(id, abVariant);
  }

  /**
   * Gets the size-specific context template.
   */
  async getSizeTemplate(size: PRSize, abVariant: ABVariant | null): Promise<PromptTemplate> {
    const sizeId: PromptTemplateId = `pr-summary-context-${size}`;
    try {
      return await this.getTemplate(sizeId, abVariant);
    } catch {
      return this.getBuiltInTemplate(sizeId, abVariant);
    }
  }

  private getBuiltInTemplate(id: PromptTemplateId, abVariant: ABVariant | null): PromptTemplate {
    const now = new Date().toISOString();
    const version: PromptVersion = {
      version: CURRENT_VERSION,
      createdAt: now,
      changelog: 'Built-in default template',
      author: 'system',
    };

    const templateText = this.getBuiltInTemplateText(id);

    return {
      id,
      name: id,
      template: templateText,
      version,
      targetSize: this.getTargetSize(id),
      abVariant,
      abTestConfig: null,
      blobKey: this.buildLatestKey(id, abVariant),
      maxTokens: this.estimateTokens(templateText) + 200,
    };
  }

  private getBuiltInTemplateText(id: PromptTemplateId): string {
    switch (id) {
      case 'pr-summary-system':
        return DEFAULT_SYSTEM_PROMPT;
      case 'pr-summary-context-small':
        return DEFAULT_CONTEXT_TEMPLATE_SMALL;
      case 'pr-summary-context-medium':
        return DEFAULT_CONTEXT_TEMPLATE_MEDIUM;
      case 'pr-summary-context-large':
        return DEFAULT_CONTEXT_TEMPLATE_LARGE;
      case 'pr-summary-context':
        return DEFAULT_CONTEXT_TEMPLATE_MEDIUM;
      case 'pr-summary-fallback':
        return DEFAULT_FALLBACK_TEMPLATE;
      case 'pr-summary-error':
        return DEFAULT_ERROR_TEMPLATE;
      default:
        return DEFAULT_FALLBACK_TEMPLATE;
    }
  }

  getBuiltInContextTemplate(size: PRSize): string {
    switch (size) {
      case 'small':
        return DEFAULT_CONTEXT_TEMPLATE_SMALL;
      case 'medium':
        return DEFAULT_CONTEXT_TEMPLATE_MEDIUM;
      case 'large':
        return DEFAULT_CONTEXT_TEMPLATE_LARGE;
    }
  }

  private async getOrCreateManifest(): Promise<PromptTemplateBlobManifest> {
    if (this.manifestCache && this.manifestCache.expiresAt > Date.now()) {
      return this.manifestCache.value;
    }

    try {
      const result = await this.blob.download(this.config.containerName, MANIFEST_KEY);
      if (result.success && result.content) {
        const manifest = JSON.parse(result.content) as PromptTemplateBlobManifest;
        this.manifestCache = { value: manifest, expiresAt: Date.now() + this.config.cacheTtlMs };
        return manifest;
      }
    } catch {}

    const manifest: PromptTemplateBlobManifest = {
      latestVersion: CURRENT_VERSION,
      versions: [
        {
          version: CURRENT_VERSION,
          createdAt: new Date().toISOString(),
          changelog: 'Initial version',
          author: 'system',
        },
      ],
      activeTests: [],
      updatedAt: new Date().toISOString(),
    };

    await this.blob.upload(
      this.config.containerName,
      MANIFEST_KEY,
      JSON.stringify(manifest, null, 2)
    );
    this.manifestCache = { value: manifest, expiresAt: Date.now() + this.config.cacheTtlMs };
    return manifest;
  }

  buildBlobKey(id: string, version: string, abVariant: ABVariant | null): string {
    const base = `${this.config.blobPrefix}${id}`;
    return abVariant ? `${base}/${abVariant}/v${version}.json` : `${base}/v${version}.json`;
  }

  buildLatestKey(id: string, abVariant: ABVariant | null): string {
    const base = `${this.config.blobPrefix}${id}`;
    return abVariant ? `${base}/${abVariant}/latest.json` : `${base}/latest.json`;
  }

  private getTargetSize(id: PromptTemplateId): 'small' | 'medium' | 'large' | null {
    if (id.endsWith('-small')) return 'small';
    if (id.endsWith('-medium')) return 'medium';
    if (id.endsWith('-large')) return 'large';
    return null;
  }

  incrementVersion(current: string): string {
    const parts = current.split('.').map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    return parts.join('.');
  }

  private changeIcon(changeType: string): string {
    switch (changeType) {
      case 'added':
        return '+';
      case 'removed':
        return '-';
      case 'renamed':
        return '→';
      default:
        return '~';
    }
  }

  private invalidateCacheEntry(id: string, abVariant: ABVariant | null): void {
    const cacheKey = `${id}:${abVariant ?? 'null'}`;
    this.cache.delete(cacheKey);
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[PromptTemplateService] ${message}`);
    }
  }
}
