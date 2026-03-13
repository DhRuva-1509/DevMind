import * as fs from 'fs';
import * as path from 'path';
import {
  DependencyParserConfig,
  ParseResult,
  Dependency,
  DependencySection,
  VersionSpecifier,
  VersionOperator,
  DependencyParseError,
  FileNotFoundError,
  InvalidFormatError,
} from './dependency.types';

const DEFAULT_CONFIG: Required<DependencyParserConfig> = {
  enableCache: true,
  cacheTtlMs: 30_000,
  enableLogging: true,
};

interface CacheEntry {
  result: ParseResult;
  expiresAt: number;
}

export interface FileReader {
  exists(filePath: string): boolean;
  read(filePath: string): string;
}

const nodeFileReader: FileReader = {
  exists: (p) => fs.existsSync(p),
  read: (p) => fs.readFileSync(p, 'utf-8'),
};

export class DependencyParserService {
  private readonly config: Required<DependencyParserConfig>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly fileReader: FileReader;

  constructor(config: DependencyParserConfig = {}, fileReader: FileReader = nodeFileReader) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.fileReader = fileReader;
  }

  /**
   * Parses a package.json file and returns normalized dependencies.
   */
  parsePackageJson(filePath: string): ParseResult {
    const resolved = path.resolve(filePath);

    const cached = this.getFromCache(resolved);
    if (cached) {
      this.log(`Cache hit for ${resolved}`);
      return cached;
    }

    this.log(`Parsing package.json: ${resolved}`);

    const raw = this.readFile(resolved);
    let json: Record<string, unknown>;

    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new InvalidFormatError(resolved, 'file is not valid JSON');
    }

    const deps: Dependency[] = [];

    const sections: Array<[DependencySection, unknown]> = [
      ['dependencies', json.dependencies],
      ['devDependencies', json.devDependencies],
      ['peerDependencies', json.peerDependencies],
      ['optionalDependencies', json.optionalDependencies],
    ];

    for (const [section, block] of sections) {
      if (!block || typeof block !== 'object') {
        continue;
      }

      for (const [name, rawVersion] of Object.entries(block as Record<string, unknown>)) {
        if (typeof rawVersion !== 'string') {
          this.log(`Skipping non-string version for ${name}: ${String(rawVersion)}`);
          continue;
        }

        deps.push({
          name,
          normalizedName: this.normalizeNodeName(name),
          specifier: this.parseNodeVersion(rawVersion),
          section,
          ecosystem: 'node',
        });
      }
    }

    const result = this.buildResult('node', resolved, deps);
    this.setCache(resolved, result);
    return result;
  }

  /**
   * Parses a requirements.txt file and returns normalized dependencies.
   */
  parseRequirementsTxt(filePath: string): ParseResult {
    const resolved = path.resolve(filePath);

    const cached = this.getFromCache(resolved);
    if (cached) {
      this.log(`Cache hit for ${resolved}`);
      return cached;
    }

    this.log(`Parsing requirements.txt: ${resolved}`);

    const raw = this.readFile(resolved);
    const deps = this.parseRequirementsContent(raw, resolved);

    const result = this.buildResult('python', resolved, deps);
    this.setCache(resolved, result);
    return result;
  }

  /**
   * Auto-detects file type by name and delegates to the appropriate parser.
   */
  parse(filePath: string): ParseResult {
    const basename = path.basename(filePath).toLowerCase();

    if (basename === 'package.json') {
      return this.parsePackageJson(filePath);
    }

    if (basename === 'requirements.txt' || basename.startsWith('requirements')) {
      return this.parseRequirementsTxt(filePath);
    }

    throw new DependencyParseError(
      `Unsupported dependency file: ${basename}. Expected package.json or requirements.txt`,
      filePath
    );
  }

  /**
   * Clears the entire cache or a specific file's cache entry.
   */
  clearCache(filePath?: string): void {
    if (filePath) {
      this.cache.delete(path.resolve(filePath));
    } else {
      this.cache.clear();
    }
  }

  /**
   * Returns the number of entries currently in cache.
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Parses a single Node version string e.g. "^1.2.3", ">=2.0.0 <3.0.0", "latest", "*"
   */
  parseNodeVersion(raw: string): VersionSpecifier {
    const trimmed = raw.trim();

    if (
      !trimmed ||
      trimmed === '*' ||
      trimmed === 'latest' ||
      trimmed === 'next' ||
      trimmed === 'beta'
    ) {
      return { raw: trimmed, operator: '', version: trimmed, isRange: true };
    }

    if (
      trimmed.startsWith('git') ||
      trimmed.startsWith('http') ||
      trimmed.startsWith('file:') ||
      trimmed.startsWith('github:') ||
      trimmed.startsWith('bitbucket:') ||
      trimmed.includes('/')
    ) {
      return { raw: trimmed, operator: '', version: trimmed, isRange: false };
    }

    const operatorMatch = trimmed.match(/^(\^|~|>=|<=|>|<|=)/);
    const operator = (operatorMatch?.[1] ?? '') as VersionOperator;
    const version = trimmed.slice(operator.length).trim();

    const isRange =
      operator === '^' ||
      operator === '~' ||
      operator === '>=' ||
      operator === '<=' ||
      operator === '>' ||
      operator === '<' ||
      trimmed.includes(' ') ||
      trimmed.includes('||');

    return { raw: trimmed, operator, version, isRange };
  }

  /**
   * Normalizes a Node package name: lowercase, collapse whitespace.
   */
  normalizeNodeName(name: string): string {
    return name.trim().toLowerCase();
  }

  /**
   * Parses the full text content of a requirements.txt file.
   */
  parseRequirementsContent(content: string, filePath = 'requirements.txt'): Dependency[] {
    const deps: Dependency[] = [];

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();

      if (!line || line.startsWith('#') || line.startsWith('-') || line.startsWith('--')) {
        continue;
      }

      const withoutComment = line.split('#')[0].trim();
      if (!withoutComment) {
        continue;
      }

      const withoutMarker = withoutComment.split(';')[0].trim();

      const withoutExtras = withoutMarker.replace(/\[.*?\]/g, '');

      try {
        const dep = this.parseSingleRequirement(withoutExtras, filePath);
        if (dep) {
          deps.push(dep);
        }
      } catch {
        this.log(`Skipping unparseable requirement line: "${line}"`);
      }
    }

    return deps;
  }

  /**
   * Parses a single requirement line e.g. "requests>=2.28.0,<3.0"
   */
  parseSingleRequirement(line: string, filePath = 'requirements.txt'): Dependency | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }
    const match = trimmed.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)(.*)?$/);
    if (!match) {
      return null;
    }

    const name = match[1];
    const versionPart = (match[3] ?? '').trim();

    return {
      name,
      normalizedName: this.normalizePythonName(name),
      specifier: this.parsePythonVersion(versionPart),
      section: 'main',
      ecosystem: 'python',
    };
  }

  /**
   * Parses a Python version specifier string e.g. ">=2.28.0,<3.0", "==1.0.*", ""
   */
  parsePythonVersion(raw: string): VersionSpecifier {
    const trimmed = raw.trim();

    if (!trimmed) {
      return { raw: '', operator: '', version: '', isRange: false };
    }

    const parts = trimmed
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const first = parts[0];

    const operatorMatch = first.match(/^(~=|==|!=|>=|<=|>|<)/);
    const operator = (operatorMatch?.[1] ?? '') as VersionOperator;
    const version = first.slice(operator.length).trim();

    const isRange =
      parts.length > 1 ||
      operator === '>=' ||
      operator === '<=' ||
      operator === '>' ||
      operator === '<' ||
      operator === '~=' ||
      operator === '!=' ||
      version.endsWith('*');

    return { raw: trimmed, operator, version, isRange };
  }

  /**
   * Normalizes a Python package name per PEP 503:
   * lowercase, collapse runs of [-_.] to a single hyphen.
   */
  normalizePythonName(name: string): string {
    return name.toLowerCase().replace(/[-_.]+/g, '-');
  }

  private getFromCache(resolvedPath: string): ParseResult | null {
    if (!this.config.enableCache) {
      return null;
    }

    const entry = this.cache.get(resolvedPath);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(resolvedPath);
      return null;
    }

    return entry.result;
  }

  private setCache(resolvedPath: string, result: ParseResult): void {
    if (!this.config.enableCache) {
      return;
    }

    this.cache.set(resolvedPath, {
      result,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  private readFile(resolvedPath: string): string {
    if (!this.fileReader.exists(resolvedPath)) {
      throw new FileNotFoundError(resolvedPath);
    }

    try {
      return this.fileReader.read(resolvedPath);
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        throw err;
      }
      throw new DependencyParseError(`Failed to read file: ${resolvedPath}`, resolvedPath, err);
    }
  }

  private buildResult(
    ecosystem: ParseResult['ecosystem'],
    filePath: string,
    dependencies: Dependency[]
  ): ParseResult {
    return {
      ecosystem,
      filePath,
      dependencies,
      cachedAt: new Date().toISOString(),
      totalCount: dependencies.length,
    };
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[DependencyParser] ${message}`);
    }
  }
}
