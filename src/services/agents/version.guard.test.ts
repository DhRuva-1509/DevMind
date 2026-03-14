import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import {
  VersionGuardAgent,
  DependencyReaderAdapter,
  DocSearchAdapter,
  OpenAIAdapter,
  LoggingAdapter,
  FeatureToggleAdapter,
} from './version.guard.agent';
import { CodePatternExtractor } from './code.pattern.extractor';
import {
  FeatureDisabledError,
  VersionGuardWarning,
  OpenAIAnalysisResponse,
} from './version.guard.types';

function makeDeps(versions: Record<string, string> = {}): DependencyReaderAdapter {
  return {
    getLibraryVersion: sinon
      .stub()
      .callsFake(async (_root: string, lib: string) => versions[lib] ?? null),
    getAllDependencies: sinon.stub().resolves(versions),
  };
}

function makeDocSearch(overrides: Partial<DocSearchAdapter> = {}): DocSearchAdapter {
  return {
    search: sinon.stub().resolves([
      {
        content: 'In v5, useQuery now requires an object argument with queryKey and queryFn.',
        sourceUrl: 'https://tanstack.com/query/v5',
        score: 0.95,
      },
    ]),
    indexExists: sinon.stub().resolves(true),
    ...overrides,
  };
}

function makeOpenAI(warnings: OpenAIAnalysisResponse['warnings'] = []): OpenAIAdapter {
  return {
    analyze: sinon.stub().resolves({ warnings }),
  };
}

function makeLogger(): LoggingAdapter {
  return { log: sinon.stub().resolves() };
}

function makeToggle(enabled = true): FeatureToggleAdapter {
  return { isEnabled: sinon.stub().returns(enabled) };
}

function makeAgent(
  overrides: {
    versions?: Record<string, string>;
    docSearchOverrides?: Partial<DocSearchAdapter>;
    aiWarnings?: OpenAIAnalysisResponse['warnings'];
    toggleEnabled?: boolean;
    config?: object;
  } = {}
): {
  agent: VersionGuardAgent;
  deps: DependencyReaderAdapter;
  docSearch: DocSearchAdapter;
  openai: OpenAIAdapter;
  logger: LoggingAdapter;
  toggle: FeatureToggleAdapter;
} {
  const deps = makeDeps(overrides.versions ?? { 'react-query': '^5.0.0' });
  const docSearch = makeDocSearch(overrides.docSearchOverrides);
  const openai = makeOpenAI(overrides.aiWarnings ?? []);
  const logger = makeLogger();
  const toggle = makeToggle(overrides.toggleEnabled ?? true);

  const agent = new VersionGuardAgent(
    { enableLogging: false, projectId: 'test-proj', ...overrides.config },
    deps,
    docSearch,
    openai,
    logger,
    toggle
  );

  return { agent, deps, docSearch, openai, logger, toggle };
}

const REACT_QUERY_V4_CODE = `
import { useQuery } from '@tanstack/react-query';

function UserProfile({ userId }) {
  const { data, isLoading } = useQuery(['user', userId], () => fetchUser(userId));
  return <div>{data?.name}</div>;
}
`.trim();

const REACT_QUERY_V5_CORRECT = `
import { useQuery } from '@tanstack/react-query';

function UserProfile({ userId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  });
  return <div>{data?.name}</div>;
}
`.trim();

const PRISMA_CODE = `
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getUser(id: string) {
  return prisma.user.findUnique({ where: { id } });
}
`.trim();

const NO_IMPORTS_CODE = `
function add(a, b) {
  return a + b;
}
`.trim();

describe('VersionGuardAgent', () => {
  afterEach(() => sinon.restore());

  describe('constructor', () => {
    it('creates an instance with injected dependencies', () => {
      const { agent } = makeAgent();
      expect(agent).to.be.instanceOf(VersionGuardAgent);
    });

    it('accepts custom minConfidence config', () => {
      const { agent } = makeAgent({ config: { minConfidence: 0.9 } });
      expect(agent).to.be.instanceOf(VersionGuardAgent);
    });

    it('accepts custom topK config', () => {
      const { agent } = makeAgent({ config: { topK: 5 } });
      expect(agent).to.be.instanceOf(VersionGuardAgent);
    });

    it('accepts custom projectId', () => {
      const { agent } = makeAgent({ config: { projectId: 'my-project' } });
      expect(agent).to.be.instanceOf(VersionGuardAgent);
    });
  });

  describe('feature toggle (AC-8)', () => {
    it('throws FeatureDisabledError when toggle is off', async () => {
      const { agent } = makeAgent({ toggleEnabled: false });
      try {
        await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(FeatureDisabledError);
      }
    });

    it('throws FeatureDisabledError when config.enabled is false', async () => {
      const { agent } = makeAgent({ config: { enabled: false } });
      try {
        await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(FeatureDisabledError);
      }
    });

    it('proceeds normally when toggle is on', async () => {
      const { agent } = makeAgent({ toggleEnabled: true });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result).to.have.property('warnings');
    });
  });

  describe('analyzeFile()', () => {
    it('returns an AnalysisResult with correct shape', async () => {
      const { agent } = makeAgent();
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result).to.have.keys([
        'filePath',
        'projectId',
        'warnings',
        'analyzedLibraries',
        'skippedLibraries',
        'durationMs',
        'triggeredBy',
      ]);
    });

    it('sets filePath on result', async () => {
      const { agent } = makeAgent();
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.filePath).to.equal('src/App.tsx');
    });

    it('sets triggeredBy from parameter', async () => {
      const { agent } = makeAgent();
      const result = await agent.analyzeFile(
        'src/App.tsx',
        REACT_QUERY_V4_CODE,
        '/project',
        'command'
      );
      expect(result.triggeredBy).to.equal('command');
    });

    it('defaults triggeredBy to "save"', async () => {
      const { agent } = makeAgent();
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.triggeredBy).to.equal('save');
    });

    it('returns empty warnings for file with no imports', async () => {
      const { agent } = makeAgent();
      const result = await agent.analyzeFile('src/util.ts', NO_IMPORTS_CODE, '/project');
      expect(result.warnings).to.deep.equal([]);
      expect(result.analyzedLibraries).to.deep.equal([]);
    });

    it('skips library when version not found in package.json', async () => {
      const { agent } = makeAgent({ versions: {} });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.skippedLibraries).to.include('react-query');
    });

    it('skips library when doc index does not exist', async () => {
      const { agent } = makeAgent({
        docSearchOverrides: { indexExists: sinon.stub().resolves(false) },
      });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.skippedLibraries).to.include('react-query');
    });

    it('records durationMs', async () => {
      const { agent } = makeAgent();
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.durationMs).to.be.a('number').and.greaterThanOrEqual(0);
    });

    it('queries doc search with library and version', async () => {
      const { agent, docSearch } = makeAgent({ versions: { 'react-query': '^5.0.0' } });
      await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect((docSearch.search as SinonStub).callCount).to.be.greaterThan(0);
      const opts = (docSearch.search as SinonStub).firstCall.args[2];
      expect(opts.library).to.equal('react-query');
      expect(opts.version).to.equal('5.0.0');
    });

    it('calls OpenAI analyze with a prompt string', async () => {
      const { agent, openai } = makeAgent();
      await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect((openai.analyze as SinonStub).callCount).to.be.greaterThan(0);
      const prompt = (openai.analyze as SinonStub).firstCall.args[0];
      expect(prompt).to.be.a('string').and.include('react-query');
    });

    it('surfaces warnings that meet confidence threshold', async () => {
      const { agent } = makeAgent({
        aiWarnings: [
          {
            symbol: 'useQuery',
            message: 'useQuery array syntax is deprecated in v5',
            suggestion: 'useQuery({ queryKey: [...], queryFn: ... })',
            confidence: 0.95,
            severity: 'warning',
            line: 3,
            character: 30,
          },
        ],
      });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.warnings).to.have.length(1);
      expect(result.warnings[0].symbol).to.equal('useQuery');
    });

    it('filters out warnings below minConfidence', async () => {
      const { agent } = makeAgent({
        config: { minConfidence: 0.8 },
        aiWarnings: [
          {
            symbol: 'useQuery',
            message: 'Maybe deprecated',
            suggestion: 'use something else',
            confidence: 0.5,
            severity: 'info',
            line: 3,
            character: 30,
          },
        ],
      });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.warnings).to.have.length(0);
    });

    it('handles OpenAI failure gracefully — skips library', async () => {
      const openai: OpenAIAdapter = { analyze: sinon.stub().rejects(new Error('OpenAI down')) };
      const deps = makeDeps({ 'react-query': '^5.0.0' });
      const docSearch = makeDocSearch();
      const agent = new VersionGuardAgent(
        { enableLogging: false, projectId: 'test-proj' },
        deps,
        docSearch,
        openai,
        makeLogger(),
        makeToggle()
      );
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.skippedLibraries).to.include('react-query');
      expect(result.warnings).to.have.length(0);
    });

    it('skips logging when enableLogging is false', async () => {
      const logger = makeLogger();
      const deps = makeDeps({ 'react-query': '^5.0.0' });
      const agent = new VersionGuardAgent(
        { enableLogging: false, projectId: 'test-proj' },
        deps,
        makeDocSearch(),
        makeOpenAI(),
        logger,
        makeToggle()
      );
      await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect((logger.log as SinonStub).callCount).to.equal(0);
    });

    it('logs to Cosmos DB when enableLogging is true', async () => {
      const logger = makeLogger();
      const aiWarnings = [
        {
          symbol: 'useQuery',
          message: 'deprecated',
          suggestion: 'fix',
          confidence: 0.9,
          severity: 'warning' as const,
          line: 3,
          character: 30,
        },
      ];
      const deps = makeDeps({ 'react-query': '^5.0.0' });
      const agent = new VersionGuardAgent(
        { enableLogging: true, projectId: 'test-proj' },
        deps,
        makeDocSearch(),
        makeOpenAI(aiWarnings),
        logger,
        makeToggle()
      );
      await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect((logger.log as SinonStub).callCount).to.equal(1);
    });

    it('includes id, timestamp, and projectId in log entry', async () => {
      const logger = makeLogger();
      const aiWarnings = [
        {
          symbol: 'useQuery',
          message: 'deprecated',
          suggestion: 'fix',
          confidence: 0.9,
          severity: 'warning' as const,
          line: 3,
          character: 30,
        },
      ];
      const deps = makeDeps({ 'react-query': '^5.0.0' });
      const agent = new VersionGuardAgent(
        { enableLogging: true, projectId: 'my-project' },
        deps,
        makeDocSearch(),
        makeOpenAI(aiWarnings),
        logger,
        makeToggle()
      );
      await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      const logEntry = (logger.log as SinonStub).firstCall.args[0];
      expect(logEntry.id).to.be.a('string');
      expect(logEntry.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T/);
      expect(logEntry.projectId).to.equal('my-project');
    });
  });

  describe('warnings shape (AC-5)', () => {
    it('each warning has required fields', async () => {
      const { agent } = makeAgent({
        aiWarnings: [
          {
            symbol: 'useQuery',
            message: 'Array syntax deprecated in v5',
            suggestion: 'useQuery({ queryKey: [...], queryFn: ... })',
            confidence: 0.95,
            severity: 'warning',
            line: 3,
            character: 30,
          },
        ],
      });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      const w = result.warnings[0];
      expect(w).to.have.keys([
        'id',
        'library',
        'version',
        'symbol',
        'message',
        'suggestion',
        'confidence',
        'severity',
        'location',
        'quickFix',
      ]);
    });

    it('warning id is a UUID', async () => {
      const { agent } = makeAgent({
        aiWarnings: [
          {
            symbol: 'useQuery',
            message: 'deprecated',
            suggestion: 'fix',
            confidence: 0.95,
            severity: 'warning',
            line: 3,
            character: 30,
          },
        ],
      });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.warnings[0].id).to.match(/^[0-9a-f-]{36}$/);
    });

    it('warning includes library and version', async () => {
      const { agent } = makeAgent({
        aiWarnings: [
          {
            symbol: 'useQuery',
            message: 'deprecated',
            suggestion: 'fix',
            confidence: 0.95,
            severity: 'warning',
            line: 3,
            character: 30,
          },
        ],
      });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.warnings[0].library).to.equal('react-query');
      expect(result.warnings[0].version).to.equal('5.0.0');
    });

    it('warning has a location with filePath', async () => {
      const { agent } = makeAgent({
        aiWarnings: [
          {
            symbol: 'useQuery',
            message: 'deprecated',
            suggestion: 'fix',
            confidence: 0.95,
            severity: 'warning',
            line: 3,
            character: 30,
          },
        ],
      });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.warnings[0].location.filePath).to.equal('src/App.tsx');
    });

    it('warning has a quickFix when suggestion is provided', async () => {
      const { agent } = makeAgent({
        aiWarnings: [
          {
            symbol: 'useQuery',
            message: 'deprecated',
            suggestion: 'useQuery({ queryKey: [...] })',
            confidence: 0.95,
            severity: 'warning',
            line: 3,
            character: 30,
          },
        ],
      });
      const result = await agent.analyzeFile('src/App.tsx', REACT_QUERY_V4_CODE, '/project');
      expect(result.warnings[0].quickFix).to.exist;
      expect(result.warnings[0].quickFix?.title).to.include('useQuery');
    });
  });

  describe('buildAnalysisPrompt()', () => {
    const { agent } = makeAgent();

    it('includes library name in prompt', () => {
      const prompt = agent.buildAnalysisPrompt({
        library: 'react-query',
        version: '5.0.0',
        codeSnippet: 'useQuery(...)',
        relevantDocs: ['docs here'],
        symbols: ['useQuery'],
      });
      expect(prompt).to.include('react-query');
    });

    it('includes version in prompt', () => {
      const prompt = agent.buildAnalysisPrompt({
        library: 'react-query',
        version: '5.0.0',
        codeSnippet: 'useQuery(...)',
        relevantDocs: ['docs here'],
        symbols: ['useQuery'],
      });
      expect(prompt).to.include('5.0.0');
    });

    it('includes code snippet in prompt', () => {
      const prompt = agent.buildAnalysisPrompt({
        library: 'react-query',
        version: '5.0.0',
        codeSnippet: 'useQuery(["key"], fn)',
        relevantDocs: ['docs'],
        symbols: ['useQuery'],
      });
      expect(prompt).to.include('useQuery(["key"], fn)');
    });

    it('includes relevant docs in prompt', () => {
      const prompt = agent.buildAnalysisPrompt({
        library: 'react-query',
        version: '5.0.0',
        codeSnippet: 'code',
        relevantDocs: ['queryKey is required in v5'],
        symbols: ['useQuery'],
      });
      expect(prompt).to.include('queryKey is required in v5');
    });

    it('instructs model to return JSON', () => {
      const prompt = agent.buildAnalysisPrompt({
        library: 'react-query',
        version: '5.0.0',
        codeSnippet: 'code',
        relevantDocs: ['docs'],
        symbols: ['useQuery'],
      });
      expect(prompt).to.include('JSON');
    });

    it('limits docs to 5', () => {
      const docs = Array.from({ length: 10 }, (_, i) => `Doc content ${i}`);
      const prompt = agent.buildAnalysisPrompt({
        library: 'react-query',
        version: '5.0.0',
        codeSnippet: 'code',
        relevantDocs: docs,
        symbols: ['useQuery'],
      });
      expect(prompt).to.include('Doc content 4');
      expect(prompt).to.not.include('Doc content 5');
    });
  });

  describe('buildSearchQuery()', () => {
    const { agent } = makeAgent();

    it('includes symbols in query', () => {
      const q = agent.buildSearchQuery(['useQuery', 'useMutation'], 'react-query', '5.0.0');
      expect(q).to.include('useQuery');
      expect(q).to.include('useMutation');
    });

    it('includes library and version', () => {
      const q = agent.buildSearchQuery(['useQuery'], 'react-query', '5.0.0');
      expect(q).to.include('react-query');
      expect(q).to.include('5.0.0');
    });

    it('limits to first 5 symbols', () => {
      const symbols = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const q = agent.buildSearchQuery(symbols, 'lib', '1.0');
      expect(q).to.include('a');
      expect(q).to.not.include('f');
    });
  });

  describe('buildCodeSnippet()', () => {
    const { agent } = makeAgent();

    it('returns truncated content when no usages', () => {
      const snippet = agent.buildCodeSnippet('line1\nline2\nline3', []);
      expect(snippet.length).to.be.at.most(2000);
    });

    it('includes lines around usage', () => {
      const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
      const snippet = agent.buildCodeSnippet(content, [{ line: 10 }]);
      expect(snippet).to.include('line 10');
    });

    it('includes line numbers in output', () => {
      const content = 'const x = 1;\nconst y = 2;';
      const snippet = agent.buildCodeSnippet(content, [{ line: 0 }]);
      expect(snippet).to.match(/\d+:/);
    });
  });

  describe('normalizeVersion()', () => {
    const { agent } = makeAgent();

    it('strips ^ prefix', () => expect(agent.normalizeVersion('^18.2.0')).to.equal('18.2.0'));
    it('strips ~ prefix', () => expect(agent.normalizeVersion('~1.4.0')).to.equal('1.4.0'));
    it('strips >= prefix', () => expect(agent.normalizeVersion('>=5.0.0')).to.equal('5.0.0'));
    it('leaves clean version unchanged', () =>
      expect(agent.normalizeVersion('4.17.21')).to.equal('4.17.21'));
    it('strips multiple operators', () =>
      expect(agent.normalizeVersion('>=2.0.0')).to.equal('2.0.0'));
  });

  describe('findCallEnd()', () => {
    const { agent } = makeAgent();

    it('finds end of simple call', () => {
      expect(agent.findCallEnd('useQuery(key, fn);', 0)).to.equal(17);
    });

    it('handles nested parens', () => {
      expect(agent.findCallEnd('fn(a(b), c)', 0)).to.equal(11);
    });

    it('returns line length when no closing paren', () => {
      const line = 'useQuery';
      expect(agent.findCallEnd(line, 0)).to.equal(line.length);
    });
  });

  describe('CodePatternExtractor', () => {
    const ex = new CodePatternExtractor();

    describe('detectLanguage()', () => {
      it('detects typescript', () => expect(ex.detectLanguage('app.ts')).to.equal('typescript'));
      it('detects typescriptreact', () =>
        expect(ex.detectLanguage('App.tsx')).to.equal('typescriptreact'));
      it('detects javascript', () => expect(ex.detectLanguage('app.js')).to.equal('javascript'));
      it('detects javascriptreact', () =>
        expect(ex.detectLanguage('App.jsx')).to.equal('javascriptreact'));
      it('returns unknown for unsupported', () =>
        expect(ex.detectLanguage('app.py')).to.equal('unknown'));
    });

    describe('extractImports()', () => {
      it('extracts named imports', () => {
        const imports = ex.extractImports("import { useQuery } from '@tanstack/react-query';");
        expect(imports[0].named).to.include('useQuery');
        expect(imports[0].module).to.equal('@tanstack/react-query');
      });

      it('extracts default import', () => {
        const imports = ex.extractImports("import React from 'react';");
        expect(imports[0].defaultImport).to.equal('React');
      });

      it('extracts namespace import', () => {
        const imports = ex.extractImports("import * as z from 'zod';");
        expect(imports[0].namespace).to.be.true;
      });

      it('extracts multiple named imports', () => {
        const imports = ex.extractImports(
          "import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';"
        );
        expect(imports[0].named).to.have.members(['useQuery', 'useMutation', 'useQueryClient']);
      });

      it('extracts default + named imports', () => {
        const imports = ex.extractImports("import React, { useState, useEffect } from 'react';");
        expect(imports[0].defaultImport).to.equal('React');
        expect(imports[0].named).to.include('useState');
      });

      it('extracts type imports', () => {
        const imports = ex.extractImports(
          "import type { QueryOptions } from '@tanstack/react-query';"
        );
        expect(imports[0].module).to.equal('@tanstack/react-query');
      });

      it('records correct line number', () => {
        const code = "const x = 1;\nimport { useQuery } from 'react-query';";
        const imports = ex.extractImports(code);
        expect(imports[0].line).to.equal(1);
      });

      it('extracts CommonJS require', () => {
        const imports = ex.extractImports("const { PrismaClient } = require('@prisma/client');");
        expect(imports[0].module).to.equal('@prisma/client');
        expect(imports[0].named).to.include('PrismaClient');
      });

      it('handles multiple import lines', () => {
        const code = [
          "import { useQuery } from '@tanstack/react-query';",
          "import { PrismaClient } from '@prisma/client';",
        ].join('\n');
        expect(ex.extractImports(code)).to.have.length(2);
      });

      it('returns empty array for no imports', () => {
        expect(ex.extractImports('const x = 1;\nconst y = 2;')).to.deep.equal([]);
      });
    });

    describe('resolveLibraries()', () => {
      it('normalizes @tanstack/react-query to react-query', () => {
        const imports = ex.extractImports("import { useQuery } from '@tanstack/react-query';");
        expect(ex.resolveLibraries(imports)).to.include('react-query');
      });

      it('normalizes @prisma/client to prisma', () => {
        const imports = ex.extractImports("import { PrismaClient } from '@prisma/client';");
        expect(ex.resolveLibraries(imports)).to.include('prisma');
      });

      it('returns deduplicated library list', () => {
        const code = [
          "import { useQuery } from '@tanstack/react-query';",
          "import { useMutation } from 'react-query';",
        ].join('\n');
        const imports = ex.extractImports(code);
        const libs = ex.resolveLibraries(imports);
        expect(libs.filter((l) => l === 'react-query')).to.have.length(1);
      });

      it('excludes relative imports', () => {
        const imports = ex.extractImports("import { helper } from './utils';");
        expect(ex.resolveLibraries(imports)).to.deep.equal([]);
      });
    });

    describe('extractApiUsages()', () => {
      it('finds call usages of imported symbols', () => {
        const code = [
          "import { useQuery } from '@tanstack/react-query';",
          "const result = useQuery(['key'], fn);",
        ].join('\n');
        const imports = ex.extractImports(code);
        const usages = ex.extractApiUsages(code, imports);
        expect(usages.some((u) => u.symbol === 'useQuery')).to.be.true;
      });

      it('records correct line number for usage', () => {
        const code = [
          "import { useQuery } from 'react-query';",
          '// comment',
          "const x = useQuery(['key'], fn);",
        ].join('\n');
        const imports = ex.extractImports(code);
        const usages = ex.extractApiUsages(code, imports);
        const uq = usages.find((u) => u.symbol === 'useQuery');
        expect(uq?.line).to.equal(2);
      });

      it('records sourceModule on usage', () => {
        const code = "import { useQuery } from '@tanstack/react-query';\nuseQuery(['key'], fn);";
        const imports = ex.extractImports(code);
        const usages = ex.extractApiUsages(code, imports);
        expect(usages[0].sourceModule).to.equal('@tanstack/react-query');
      });

      it('does not report symbols that were not imported', () => {
        const code = "import { useMutation } from 'react-query';\nuseQuery(['key'], fn);";
        const imports = ex.extractImports(code);
        const usages = ex.extractApiUsages(code, imports);
        expect(usages.every((u) => u.symbol !== 'useQuery')).to.be.true;
      });

      it('returns empty array when no imports', () => {
        expect(ex.extractApiUsages('useQuery()', [])).to.deep.equal([]);
      });
    });

    describe('extract() integration', () => {
      it('returns ExtractedPatterns with correct shape', () => {
        const patterns = ex.extract('App.tsx', REACT_QUERY_V4_CODE);
        expect(patterns).to.have.keys([
          'filePath',
          'language',
          'imports',
          'apiUsages',
          'detectedLibraries',
        ]);
      });

      it('detects react-query from @tanstack/react-query import', () => {
        const patterns = ex.extract('App.tsx', REACT_QUERY_V4_CODE);
        expect(patterns.detectedLibraries).to.include('react-query');
      });

      it('detects prisma from @prisma/client import', () => {
        const patterns = ex.extract('api.ts', PRISMA_CODE);
        expect(patterns.detectedLibraries).to.include('prisma');
      });

      it('sets correct language for .tsx file', () => {
        const patterns = ex.extract('App.tsx', REACT_QUERY_V4_CODE);
        expect(patterns.language).to.equal('typescriptreact');
      });

      it('finds useQuery usage in react-query code', () => {
        const patterns = ex.extract('App.tsx', REACT_QUERY_V4_CODE);
        expect(patterns.apiUsages.some((u) => u.symbol === 'useQuery')).to.be.true;
      });

      it('finds PrismaClient usage in prisma code', () => {
        const patterns = ex.extract('api.ts', PRISMA_CODE);
        expect(patterns.apiUsages.some((u) => u.symbol === 'PrismaClient')).to.be.true;
      });

      it('returns empty arrays for file with no imports', () => {
        const patterns = ex.extract('util.ts', NO_IMPORTS_CODE);
        expect(patterns.imports).to.deep.equal([]);
        expect(patterns.apiUsages).to.deep.equal([]);
        expect(patterns.detectedLibraries).to.deep.equal([]);
      });
    });
  });
});
