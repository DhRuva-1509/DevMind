export type PackageEcosystem = 'node' | 'python';

export type VersionOperator = '^' | '~' | '>=' | '<=' | '>' | '<' | '==' | '!=' | '~=' | '';

export interface VersionSpecifier {
  raw: string;
  operator: VersionOperator;
  version: string;
  isRange: boolean;
}

export interface Dependency {
  name: string;
  normalizedName: string;
  specifier: VersionSpecifier;
  section: DependencySection;
  ecosystem: PackageEcosystem;
}

export type DependencySection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies'
  | 'main'
  | 'unknown';

export interface ParseResult {
  ecosystem: PackageEcosystem;
  filePath: string;
  dependencies: Dependency[];
  cachedAt: string;
  totalCount: number;
}

export interface DependencyParserConfig {
  enableCache?: boolean;
  cacheTtlMs?: number;
  enableLogging?: boolean;
}

export class DependencyParseError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DependencyParseError';
  }
}

export class FileNotFoundError extends DependencyParseError {
  constructor(filePath: string) {
    super(`Dependency file not found: ${filePath}`, filePath);
    this.name = 'FileNotFoundError';
  }
}

export class InvalidFormatError extends DependencyParseError {
  constructor(filePath: string, detail: string) {
    super(`Invalid format in ${filePath}: ${detail}`, filePath);
    this.name = 'InvalidFormatError';
  }
}
