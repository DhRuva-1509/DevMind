import {
  TribalKnowledgeAgentConfig,
  AgentTriggerContext,
  TribalKnowledgeAgentResult,
  TribalKnowledgeWarning,
  RelatedPR,
  WarningSeverity,
  AgentStatus,
  TribalSearchAdapter,
  WarningGenerationAdapter,
  TribalKnowledgeLoggingAdapter,
  TribalKnowledgeTelemetryEntry,
  TribalKnowledgeAgentError,
  DEFAULT_AGENT_CONFIG,
  HIGH_SEVERITY_CATEGORIES,
  MEDIUM_SEVERITY_CATEGORIES,
} from './tribal.knowledge.agent.types';
import {
  TribalKnowledgeSearchResult,
  CommentCategory,
} from '../tribal-knowledge-indexer/tribal.knowledge.indexer.types';

export class TribalKnowledgeAgent {
  private readonly config: Required<TribalKnowledgeAgentConfig>;

  constructor(
    config: TribalKnowledgeAgentConfig = {},
    private readonly searchAdapter: TribalSearchAdapter,
    private readonly warningAdapter?: WarningGenerationAdapter,
    private readonly loggingAdapter?: TribalKnowledgeLoggingAdapter
  ) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
  }

  /**
   * Triggers on PR open, file change, or manual invocation.
   * Extracts patterns from current code (passed in context).
   * Searches Azure AI Search for similar past issues.
   * Generates contextual warnings via Azure OpenAI.
   * Links to relevant past PRs.
   * Applies configurable sensitivity threshold.
   * Stores results in Cosmos DB.
   */
  async analyze(context: AgentTriggerContext): Promise<TribalKnowledgeAgentResult> {
    this._validateContext(context);

    const startTime = Date.now();
    const generatedAt = new Date().toISOString();
    const { owner, repo, prNumber = null, trigger } = context;

    let patternsSearched = 0;
    let rawMatchesFound = 0;
    const warnings: TribalKnowledgeWarning[] = [];
    let errorMessage: string | undefined;
    let status: AgentStatus = 'complete';

    try {
      const searchQueries = this._buildSearchQueries(context);

      for (const query of searchQueries) {
        patternsSearched++;

        let matches: TribalKnowledgeSearchResult[];
        try {
          matches = await this.searchAdapter.search(owner, repo, query.text, {
            topK: this.config.topK,
            filePath: query.filePath,
          });
        } catch (err: any) {
          status = 'partial';
          continue;
        }

        const aboveThreshold = matches.filter(
          (m) => m.searchScore >= this.config.sensitivityThreshold
        );
        rawMatchesFound += matches.length;

        for (const match of aboveThreshold) {
          if (warnings.length >= this.config.maxWarnings) break;

          let message = match.document.content;
          if (this.config.enableWarningGeneration && this.warningAdapter) {
            try {
              message = await this._generateWarning(context, match);
            } catch {
              // Non-fatal: fall back to raw comment
            }
          }

          const relatedPR = this._buildRelatedPR(match, owner, repo);

          const warning: TribalKnowledgeWarning = {
            id: `warning-${match.document.id}-${Date.now()}`,
            filePath: match.document.filePath,
            message,
            severity: this._deriveSeverity(match.document.category, match.searchScore),
            category: match.document.category,
            confidence: match.searchScore,
            relatedPRs: [relatedPR],
            sourceMatch: match,
          };

          warnings.push(warning);
        }
      }

      if (warnings.length === 0 && status === 'complete') {
        status = 'no_matches';
      }
    } catch (err: any) {
      status = 'failed';
      errorMessage = err.message ?? String(err);
    }

    const result: TribalKnowledgeAgentResult = {
      owner,
      repo,
      prNumber,
      trigger,
      warnings,
      status,
      patternsSearched,
      rawMatchesFound,
      durationMs: Date.now() - startTime,
      generatedAt,
      ...(errorMessage ? { errorMessage } : {}),
    };

    const telemetryId = await this._logResult(owner, repo, prNumber, trigger, result);
    if (telemetryId) result.telemetryId = telemetryId;

    return result;
  }

  /**
   * Derives severity from category and search score.
   */
  deriveSeverity(category: CommentCategory, score: number): WarningSeverity {
    return this._deriveSeverity(category, score);
  }

  /**
   * Builds search queries from trigger context.
   * One query per detected pattern, plus one per changed file.
   */
  buildSearchQueries(context: AgentTriggerContext): Array<{ text: string; filePath?: string }> {
    return this._buildSearchQueries(context);
  }

  buildRelatedPRUrl(owner: string, repo: string, prNumber: number): string {
    return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  }

  private _validateContext(context: AgentTriggerContext): void {
    if (!context) {
      throw new TribalKnowledgeAgentError('context is required', 'INVALID_INPUT');
    }
    if (!context.owner?.trim()) {
      throw new TribalKnowledgeAgentError('context.owner is required', 'INVALID_INPUT');
    }
    if (!context.repo?.trim()) {
      throw new TribalKnowledgeAgentError('context.repo is required', 'INVALID_INPUT');
    }
    if (!Array.isArray(context.changedFiles)) {
      throw new TribalKnowledgeAgentError('context.changedFiles must be an array', 'INVALID_INPUT');
    }
  }

  private _buildSearchQueries(
    context: AgentTriggerContext
  ): Array<{ text: string; filePath?: string }> {
    const queries: Array<{ text: string; filePath?: string }> = [];

    for (const pattern of context.detectedPatterns) {
      queries.push({ text: pattern });
    }

    for (const snippet of context.codeSnippets) {
      if (snippet.content.trim()) {
        queries.push({ text: snippet.content.slice(0, 500), filePath: snippet.filePath });
      }
    }

    if (queries.length === 0 && context.prTitle) {
      queries.push({ text: context.prTitle });
    }

    return queries;
  }

  private async _generateWarning(
    context: AgentTriggerContext,
    match: TribalKnowledgeSearchResult
  ): Promise<string> {
    const systemPrompt = [
      'You are a code review assistant surfacing relevant past PR feedback.',
      'Given a past comment and the current code context, generate a concise, actionable warning.',
      'The warning should explain why this past issue is relevant to the current change.',
      'Keep it under 2 sentences. Do not repeat the past comment verbatim.',
    ].join(' ');

    const userPrompt = [
      `Past comment (from PR #${match.document.prNumber}):`,
      match.document.content,
      '',
      `Current context:`,
      `Files changed: ${context.changedFiles.join(', ')}`,
      `Patterns detected: ${context.detectedPatterns.join(', ')}`,
      context.prTitle ? `PR title: ${context.prTitle}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return this.warningAdapter!.generate(systemPrompt, userPrompt, this.config.maxOutputTokens);
  }

  private _deriveSeverity(category: CommentCategory, score: number): WarningSeverity {
    if (HIGH_SEVERITY_CATEGORIES.includes(category)) return 'high';
    if (MEDIUM_SEVERITY_CATEGORIES.includes(category)) return 'medium';
    if (
      score >= 0.9 &&
      (category === 'style' || category === 'test' || category === 'documentation')
    ) {
      return 'medium';
    }
    return 'low';
  }

  private _buildRelatedPR(
    match: TribalKnowledgeSearchResult,
    owner: string,
    repo: string
  ): RelatedPR {
    const { prNumber, prTitle, content } = match.document;
    return {
      owner,
      repo,
      prNumber,
      prTitle,
      commentExcerpt: content.length > 200 ? content.slice(0, 200) + '...' : content,
      url: this.buildRelatedPRUrl(owner, repo, prNumber),
    };
  }

  private async _logResult(
    owner: string,
    repo: string,
    prNumber: number | null,
    trigger: string,
    result: TribalKnowledgeAgentResult
  ): Promise<string | undefined> {
    if (!this.loggingAdapter || !this.config.enableLogging) return undefined;
    try {
      const id = `tribal-alert-${owner}-${repo}-${Date.now()}`;
      const entry: TribalKnowledgeTelemetryEntry = {
        id,
        partitionKey: `${owner}/${repo}`.toLowerCase(),
        type: 'tribal-knowledge-alert',
        owner,
        repo,
        prNumber,
        trigger: trigger as any,
        patternsSearched: result.patternsSearched,
        rawMatchesFound: result.rawMatchesFound,
        warningsGenerated: result.warnings.length,
        durationMs: result.durationMs,
        timestamp: result.generatedAt,
      };
      await this.loggingAdapter.log(entry);
      return id;
    } catch {
      return undefined;
    }
  }
}
