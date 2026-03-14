import { ExtractedPatterns, ImportStatement, ApiUsage } from './version.guard.types';

const MODULE_ALIASES: Record<string, string> = {
  '@tanstack/react-query': 'react-query',
  '@tanstack/vue-query': 'vue-query',
  '@tanstack/svelte-query': 'svelte-query',
  'react-query': 'react-query',
  '@prisma/client': 'prisma',
  prisma: 'prisma',
  'drizzle-orm': 'drizzle',
  'drizzle-orm/node-postgres': 'drizzle',
  'drizzle-orm/mysql2': 'drizzle',
  zod: 'zod',
  express: 'express',
  fastify: 'fastify',
  next: 'nextjs',
  'next/router': 'nextjs',
  'next/navigation': 'nextjs',
  'next/headers': 'nextjs',
  react: 'react',
  'react-dom': 'react',
  typescript: 'typescript',
  vue: 'vue',
  'vue-router': 'vue',
};

type Language = ExtractedPatterns['language'];

export class CodePatternExtractor {
  /**
   * Main entry point — extracts patterns from a source file's text content.
   */
  extract(filePath: string, content: string): ExtractedPatterns {
    const language = this.detectLanguage(filePath);
    const imports = this.extractImports(content);
    const detectedLibraries = this.resolveLibraries(imports);
    const apiUsages = this.extractApiUsages(content, imports);

    return { filePath, language, imports, apiUsages, detectedLibraries };
  }

  detectLanguage(filePath: string): Language {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, Language> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
    };
    return map[ext] ?? 'unknown';
  }

  /**
   * Extracts all ES module import statements from source text.
   * Handles:
   *   import React from 'react'
   *   import { useQuery, useMutation } from '@tanstack/react-query'
   *   import * as z from 'zod'
   *   import type { Foo } from 'bar'
   *   const x = require('module')  ← CommonJS
   */
  extractImports(content: string): ImportStatement[] {
    const imports: ImportStatement[] = [];
    const lines = content.split('\n');

    // ES module: import ... from '...'
    const esImportRe = /^import\s+(?:type\s+)?(.+?)\s+from\s+['"](.+?)['"]/;
    // CommonJS: require('...')
    const requireRe = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(['"](.+?)['"]\)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      const esMatch = line.match(esImportRe);
      if (esMatch) {
        const [, specifiers, module] = esMatch;
        imports.push({ ...this.parseSpecifiers(specifiers), module, line: i });
        continue;
      }

      const cjsMatch = line.match(requireRe);
      if (cjsMatch) {
        const [, namedStr, defaultName, module] = cjsMatch;
        const named = namedStr
          ? namedStr
              .split(',')
              .map((s) =>
                s
                  .trim()
                  .split(/\s+as\s+/)[0]
                  .trim()
              )
              .filter(Boolean)
          : [];
        imports.push({ module, named, defaultImport: defaultName ?? undefined, line: i });
      }
    }

    return imports;
  }

  /**
   * Parses the specifier portion of an import statement.
   */
  parseSpecifiers(
    specifiers: string
  ): Pick<ImportStatement, 'named' | 'defaultImport' | 'namespace'> {
    const trimmed = specifiers.trim();

    if (trimmed.startsWith('*')) {
      return { named: [], namespace: true };
    }
    const namedMatch = trimmed.match(/^\{([^}]+)\}$/);
    if (namedMatch) {
      const named = namedMatch[1]
        .split(',')
        .map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            .trim()
        )
        .filter(Boolean);
      return { named };
    }

    const defaultAndNamed = trimmed.match(/^(\w+)\s*,\s*\{([^}]+)\}$/);
    if (defaultAndNamed) {
      const named = defaultAndNamed[2]
        .split(',')
        .map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            .trim()
        )
        .filter(Boolean);
      return { named, defaultImport: defaultAndNamed[1] };
    }

    if (/^\w+$/.test(trimmed)) {
      return { named: [], defaultImport: trimmed };
    }

    return { named: [] };
  }

  /**
   * Maps raw module names to canonical library names using the alias map.
   * Returns deduplicated list of canonical library names.
   */
  resolveLibraries(imports: ImportStatement[]): string[] {
    const libs = new Set<string>();
    for (const imp of imports) {
      const canonical = MODULE_ALIASES[imp.module];
      if (canonical) {
        libs.add(canonical);
      } else {
        const bare = imp.module.startsWith('@') ? imp.module : imp.module.split('/')[0];
        if (!bare.startsWith('.') && !bare.startsWith('/')) {
          libs.add(bare);
        }
      }
    }
    return [...libs];
  }

  /**
   * Extracts usages of imported symbols within the file.
   * Only tracks symbols that were explicitly imported.
   */
  extractApiUsages(content: string, imports: ImportStatement[]): ApiUsage[] {
    const usages: ApiUsage[] = [];
    const lines = content.split('\n');

    const symbolMap = new Map<string, string>();
    for (const imp of imports) {
      for (const name of imp.named) {
        symbolMap.set(name, imp.module);
      }
      if (imp.defaultImport) {
        symbolMap.set(imp.defaultImport, imp.module);
      }
    }

    if (symbolMap.size === 0) return usages;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      for (const [symbol, sourceModule] of symbolMap) {
        const callRe = new RegExp(`\\b${this.escapeRegex(symbol)}\\s*[(<.]`, 'g');
        let match: RegExpExecArray | null;

        while ((match = callRe.exec(line)) !== null) {
          const callText = line.slice(match.index, match.index + 120).trim();
          usages.push({
            symbol,
            callText,
            line: lineIdx,
            character: match.index,
            sourceModule,
          });
        }
      }
    }

    return usages;
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
