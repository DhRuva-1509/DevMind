import { randomUUID } from 'crypto';
import { CodePatternExtractor } from './code.pattern.extractor';
import {
  VersionGuardConfig,
  ExtractedPatterns,
  VersionGuardWarning,
  AnalysisResult,
  AnalysisPromptContext,
  OpenAIAnalysisResponse,
  OpenAIWarningOutput,
  InteractionLog,
  QuickFix,
  CodeLocation,
  FeatureDisabledError,
  VersionGuardError,
} from './version.guard.types';

export interface DependencyReaderAdapter {
  getLibraryVersion(projectRoot: string, library: string): Promise<string | null>;
  getAllDependencies(projectRoot: string): Promise<Record<string, string>>;
}

export interface DocSearchAdapter {
  search(
    projectId: string,
    query: string,
    options: { library: string; version?: string; topK?: number }
  ): Promise<Array<{ content: string; sourceUrl: string; score: number }>>;
  indexExists(projectId: string, library: string): Promise<boolean>;
}

export interface OpenAIAdapter {
  analyze(prompt: string, deployment: string): Promise<OpenAIAnalysisResponse>;
}

export interface LoggingAdapter {
  log(entry: InteractionLog): Promise<void>;
}

export interface FeatureToggleAdapter {
  isEnabled(): boolean;
}

const DEFAULT_CONFIG: Required<VersionGuardConfig> = {
  enabled: true,
  topK: 8,
  maxPromptTokens: 2000,
  minConfidence: 0.7,
  enableLogging: true,
  analysisDeployment: 'gpt-4o',
  projectId: 'default',
};

export class VersionGuardAgent {
  private readonly config: Required<VersionGuardConfig>;
  private readonly extractor: CodePatternExtractor;
  private readonly deps: DependencyReaderAdapter;
  private readonly docSearch: DocSearchAdapter;
  private readonly openai: OpenAIAdapter;
  private readonly logger: LoggingAdapter;
  private readonly toggle: FeatureToggleAdapter;

  constructor(
    config: VersionGuardConfig = {},
    deps: DependencyReaderAdapter,
    docSearch: DocSearchAdapter,
    openai: OpenAIAdapter,
    logger: LoggingAdapter,
    toggle: FeatureToggleAdapter
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.extractor = new CodePatternExtractor();
    this.deps = deps;
    this.docSearch = docSearch;
    this.openai = openai;
    this.logger = logger;
    this.toggle = toggle;
  }

  async analyzeFile(
    filePath: string,
    fileContent: string,
    projectRoot: string,
    trigger: 'save' | 'command' | 'manual' = 'save'
  ): Promise<AnalysisResult> {
    const startMs = Date.now();
    const projectId = this.config.projectId;

    if (!this.toggle.isEnabled() || !this.config.enabled) {
      throw new FeatureDisabledError(filePath);
    }

    const patterns = this.extractor.extract(filePath, fileContent);

    if (patterns.detectedLibraries.length === 0 || patterns.apiUsages.length === 0) {
      return this.buildEmptyResult(filePath, projectId, [], trigger, startMs);
    }

    const versionMap = await this.resolveVersions(projectRoot, patterns.detectedLibraries);

    const warnings: VersionGuardWarning[] = [];
    const analyzedLibraries: string[] = [];
    const skippedLibraries: string[] = [];

    for (const library of patterns.detectedLibraries) {
      const version = versionMap[library];
      if (!version) {
        skippedLibraries.push(library);
        continue;
      }

      const hasIndex = await this.docSearch.indexExists(projectId, library);
      if (!hasIndex) {
        skippedLibraries.push(library);
        continue;
      }

      const libraryUsages = patterns.apiUsages.filter((u) =>
        this.isUsageFromLibrary(u.sourceModule, library)
      );

      if (libraryUsages.length === 0) continue;

      analyzedLibraries.push(library);

      const symbols = [...new Set(libraryUsages.map((u) => u.symbol))];
      const query = this.buildSearchQuery(symbols, library, version);
      const docs = await this.docSearch.search(projectId, query, {
        library,
        version,
        topK: this.config.topK,
      });

      if (docs.length === 0) continue;

      const codeSnippet = this.buildCodeSnippet(fileContent, libraryUsages);
      const promptContext: AnalysisPromptContext = {
        library,
        version,
        codeSnippet,
        relevantDocs: docs.map((d) => d.content),
        symbols,
      };

      const prompt = this.buildAnalysisPrompt(promptContext);

      let analysisResponse: OpenAIAnalysisResponse;
      try {
        analysisResponse = await this.openai.analyze(prompt, this.config.analysisDeployment);
      } catch (err) {
        skippedLibraries.push(library);
        continue;
      }

      const libraryWarnings = this.mapWarnings(
        analysisResponse.warnings,
        library,
        version,
        filePath,
        fileContent
      );

      warnings.push(...libraryWarnings);
    }

    const result: AnalysisResult = {
      filePath,
      projectId,
      warnings,
      analyzedLibraries,
      skippedLibraries,
      durationMs: Date.now() - startMs,
      triggeredBy: trigger,
    };

    if (this.config.enableLogging) {
      await this.logInteraction(result);
    }

    return result;
  }

  extractPatterns(filePath: string, content: string): ExtractedPatterns {
    return this.extractor.extract(filePath, content);
  }

  buildAnalysisPrompt(ctx: AnalysisPromptContext): string {
    const docsSection = ctx.relevantDocs
      .slice(0, 5)
      .map((d, i) => `--- Doc ${i + 1} ---\n${d}`)
      .join('\n\n');

    return `You are a code analysis assistant specializing in JavaScript/TypeScript library APIs.

Analyze the following code for outdated or deprecated API usage patterns based on the ${ctx.library} v${ctx.version} documentation provided.

LIBRARY: ${ctx.library}
VERSION: ${ctx.version}
SYMBOLS IN USE: ${ctx.symbols.join(', ')}

RELEVANT DOCUMENTATION:
${docsSection}

CODE TO ANALYZE:
\`\`\`
${ctx.codeSnippet}
\`\`\`

Return a JSON object with this exact structure:
{
  "warnings": [
    {
      "symbol": "the deprecated symbol name",
      "message": "clear explanation of what changed and why",
      "suggestion": "ONLY the corrected function call expression — valid TypeScript code that directly replaces the deprecated call — no explanation text, no sentences, just code e.g. useQuery({ queryKey: ['user', id], queryFn: fetchUser })",
      "confidence": 0.0-1.0,
      "severity": "error|warning|info",
      "line": 0,
      "character": 0
    }
  ]
}

Rules:
- Only report issues that are clearly documented as changed/deprecated in the provided docs
- Set confidence 0.9+ only when docs explicitly state the API is removed or deprecated
- Set confidence 0.7-0.9 for likely issues based on doc context
- Set severity "error" for removed APIs, "warning" for deprecated, "info" for best-practice changes
- Return empty warnings array if no issues found
- Do not invent issues not supported by the documentation
- The "suggestion" field must be ONLY valid replacement code — it will be pasted directly into the source file
- Return ONLY the JSON object, no markdown, no explanation`;
  }

  buildSearchQuery(symbols: string[], library: string, version: string): string {
    return `${symbols.slice(0, 5).join(' ')} ${library} ${version} deprecated changed migration`;
  }

  buildCodeSnippet(content: string, usages: Array<{ line: number }>): string {
    if (usages.length === 0) return content.slice(0, 2000);

    const lines = content.split('\n');
    const usageLines = usages.map((u) => u.line);
    const minLine = Math.max(0, Math.min(...usageLines) - 3);
    const maxLine = Math.min(lines.length - 1, Math.max(...usageLines) + 10);

    return lines
      .slice(minLine, maxLine + 1)
      .map((l, i) => `${minLine + i + 1}: ${l}`)
      .join('\n');
  }

  mapWarnings(
    raw: OpenAIWarningOutput[],
    library: string,
    version: string,
    filePath: string,
    fileContent: string
  ): VersionGuardWarning[] {
    return raw
      .filter((w) => w.confidence >= this.config.minConfidence)
      .map((w) => {
        const location = this.resolveLocation(w, filePath, fileContent);
        const quickFix = w.suggestion
          ? this.buildQuickFix(w.suggestion, w.symbol, location, fileContent)
          : undefined;

        return {
          id: randomUUID(),
          library,
          version,
          symbol: w.symbol,
          message: w.message,
          suggestion: w.suggestion,
          confidence: w.confidence,
          severity: w.severity,
          location,
          quickFix,
        };
      });
  }

  buildQuickFix(
    suggestion: string,
    symbol: string,
    location: CodeLocation,
    fileContent: string
  ): QuickFix {
    const lines = fileContent.split('\n');
    const startLineText = lines[location.line] ?? '';

    // Find where the symbol call starts on the line
    const symbolIdx = startLineText.indexOf(symbol);
    const startChar = symbolIdx >= 0 ? symbolIdx : location.character;

    // Walk forward across lines to find the matching closing paren
    // This handles multiline calls like useQuery(['key'], () =>\n  fetch(...)\n)
    let endLine = location.line;
    let endChar = startLineText.length;
    let depth = 0;
    let started = false;

    outer: for (let li = location.line; li < Math.min(lines.length, location.line + 30); li++) {
      const lineText = lines[li] ?? '';
      const charStart = li === location.line ? startChar : 0;

      for (let ci = charStart; ci < lineText.length; ci++) {
        const ch = lineText[ci];
        if (ch === '(') {
          depth++;
          started = true;
        } else if (ch === ')') {
          depth--;
          if (started && depth === 0) {
            endLine = li;
            endChar = ci + 1;
            break outer;
          }
        }
      }
    }

    return {
      title: `Replace ${symbol} with suggested fix`,
      newText: suggestion,
      range: {
        filePath: location.filePath,
        line: location.line,
        character: startChar,
        endLine,
        endCharacter: endChar,
      },
    };
  }

  findCallEnd(line: string, startIdx: number): number {
    let depth = 0;
    let started = false;

    for (let i = startIdx; i < line.length; i++) {
      if (line[i] === '(') {
        depth++;
        started = true;
      } else if (line[i] === ')') {
        depth--;
        if (started && depth === 0) return i + 1;
      }
    }

    return line.length;
  }

  private async resolveVersions(
    projectRoot: string,
    libraries: string[]
  ): Promise<Record<string, string>> {
    const all = await this.deps.getAllDependencies(projectRoot);
    const result: Record<string, string> = {};

    for (const lib of libraries) {
      if (all[lib]) {
        result[lib] = this.normalizeVersion(all[lib]);
        continue;
      }
      for (const [raw, version] of Object.entries(all)) {
        if (raw.includes(lib) || lib.includes(raw.replace('@', '').split('/').pop() ?? '')) {
          result[lib] = this.normalizeVersion(version);
          break;
        }
      }
    }

    return result;
  }

  normalizeVersion(raw: string): string {
    return raw.replace(/^[\^~>=<]+/, '').trim();
  }

  private isUsageFromLibrary(sourceModule: string, library: string): boolean {
    if (sourceModule === library) return true;
    if (sourceModule.includes(library)) return true;

    const normalized: Record<string, string> = {
      '@tanstack/react-query': 'react-query',
      '@prisma/client': 'prisma',
      'drizzle-orm': 'drizzle',
    };
    return (normalized[sourceModule] ?? '') === library;
  }

  private resolveLocation(
    w: OpenAIWarningOutput,
    filePath: string,
    fileContent: string
  ): CodeLocation {
    const lines = fileContent.split('\n');
    const line = Math.max(0, Math.min(w.line, lines.length - 1));
    const lineText = lines[line] ?? '';
    const character = Math.max(0, Math.min(w.character, lineText.length));

    const symbolEnd = lineText.indexOf(w.symbol, character);
    const endCharacter =
      symbolEnd >= 0
        ? symbolEnd + w.symbol.length
        : Math.min(character + w.symbol.length, lineText.length);

    return { filePath, line, character, endLine: line, endCharacter };
  }

  private buildEmptyResult(
    filePath: string,
    projectId: string,
    skippedLibraries: string[],
    triggeredBy: AnalysisResult['triggeredBy'],
    startMs: number
  ): AnalysisResult {
    return {
      filePath,
      projectId,
      warnings: [],
      analyzedLibraries: [],
      skippedLibraries,
      durationMs: Date.now() - startMs,
      triggeredBy,
    };
  }

  private async logInteraction(result: AnalysisResult): Promise<void> {
    try {
      const entry: InteractionLog = {
        id: randomUUID(),
        projectId: result.projectId,
        filePath: result.filePath,
        triggeredBy: result.triggeredBy,
        librariesAnalyzed: result.analyzedLibraries,
        warningsFound: result.warnings.length,
        durationMs: result.durationMs,
        timestamp: new Date().toISOString(),
        warnings: result.warnings.map((w) => ({
          symbol: w.symbol,
          library: w.library,
          severity: w.severity,
        })),
      };
      await this.logger.log(entry);
    } catch {}
  }
}