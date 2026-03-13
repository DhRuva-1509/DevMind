
import * as path from 'path';
import { expect } from 'chai';
import { DependencyParserService, FileReader } from './dependency.parser';
import { DependencyParseError, FileNotFoundError, InvalidFormatError } from './dependency.types';

function fakeReader(files: Record<string, string>): FileReader {
  return {
    exists: (p) => Object.prototype.hasOwnProperty.call(files, path.resolve(p)),
    read: (p) => {
      const resolved = path.resolve(p);
      if (!Object.prototype.hasOwnProperty.call(files, resolved)) {
        throw new Error(`File not found: ${resolved}`);
      }
      return files[resolved];
    },
  };
}

function missingReader(): FileReader {
  return {
    exists: () => false,
    read: () => {
      throw new Error('should not be called');
    },
  };
}

function makeParser(
  files: Record<string, string> = {},
  overrides?: object
): DependencyParserService {
  return new DependencyParserService({ enableLogging: false, ...overrides }, fakeReader(files));
}

const PKG = path.resolve('package.json');
const REQ = path.resolve('requirements.txt');
const REQ_DEV = path.resolve('requirements-dev.txt');

const SAMPLE_PACKAGE_JSON = JSON.stringify({
  name: 'my-app',
  version: '1.0.0',
  dependencies: { react: '^18.2.0', axios: '~1.4.0', lodash: '4.17.21' },
  devDependencies: { typescript: '>=5.0.0', jest: '^29.0.0' },
  peerDependencies: { 'react-dom': '>=18.0.0' },
  optionalDependencies: { fsevents: '^2.3.2' },
});

const SAMPLE_REQUIREMENTS = `
# Production dependencies
requests>=2.28.0,<3.0
flask==2.3.2
numpy~=1.24.0
pandas>=1.5.0
pytest==7.4.0
black>=23.0.0
boto3[s3]>=1.26.0
Django>=4.0; python_version>='3.8'
Pillow==9.5.0
`.trim();

describe('DependencyParserService', () => {
  describe('constructor', () => {
    it('creates an instance with default config', () => {
      expect(new DependencyParserService()).to.be.instanceOf(DependencyParserService);
    });

    it('accepts custom cacheTtlMs', () => {
      expect(makeParser({}, { cacheTtlMs: 60_000 })).to.be.instanceOf(DependencyParserService);
    });

    it('accepts enableCache: false', () => {
      expect(makeParser({}, { enableCache: false }).getCacheSize()).to.equal(0);
    });
  });

  describe('parsePackageJson()', () => {
    it('returns a ParseResult with node ecosystem', () => {
      expect(
        makeParser({ [PKG]: SAMPLE_PACKAGE_JSON }).parsePackageJson('package.json').ecosystem
      ).to.equal('node');
    });

    it('parses dependencies section', () => {
      const deps = makeParser({ [PKG]: SAMPLE_PACKAGE_JSON })
        .parsePackageJson('package.json')
        .dependencies.filter((d) => d.section === 'dependencies');
      expect(deps).to.have.length(3);
      expect(deps.map((d) => d.name)).to.include.members(['react', 'axios', 'lodash']);
    });

    it('parses devDependencies section', () => {
      const deps = makeParser({ [PKG]: SAMPLE_PACKAGE_JSON })
        .parsePackageJson('package.json')
        .dependencies.filter((d) => d.section === 'devDependencies');
      expect(deps).to.have.length(2);
      expect(deps.map((d) => d.name)).to.include.members(['typescript', 'jest']);
    });

    it('parses peerDependencies section', () => {
      const deps = makeParser({ [PKG]: SAMPLE_PACKAGE_JSON })
        .parsePackageJson('package.json')
        .dependencies.filter((d) => d.section === 'peerDependencies');
      expect(deps).to.have.length(1);
      expect(deps[0].name).to.equal('react-dom');
    });

    it('parses optionalDependencies section', () => {
      const deps = makeParser({ [PKG]: SAMPLE_PACKAGE_JSON })
        .parsePackageJson('package.json')
        .dependencies.filter((d) => d.section === 'optionalDependencies');
      expect(deps).to.have.length(1);
      expect(deps[0].name).to.equal('fsevents');
    });

    it('sets totalCount correctly', () => {
      expect(
        makeParser({ [PKG]: SAMPLE_PACKAGE_JSON }).parsePackageJson('package.json').totalCount
      ).to.equal(7);
    });

    it('sets cachedAt as ISO string', () => {
      expect(
        makeParser({ [PKG]: SAMPLE_PACKAGE_JSON }).parsePackageJson('package.json').cachedAt
      ).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('skips missing sections gracefully', () => {
      const content = JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0' } });
      expect(makeParser({ [PKG]: content }).parsePackageJson('package.json').totalCount).to.equal(
        1
      );
    });

    it('handles package.json with no dependency sections', () => {
      const result = makeParser({ [PKG]: JSON.stringify({ name: 'app' }) }).parsePackageJson(
        'package.json'
      );
      expect(result.totalCount).to.equal(0);
      expect(result.dependencies).to.deep.equal([]);
    });

    it('skips non-string version values', () => {
      const content = JSON.stringify({ dependencies: { react: '^18.0.0', bad: null } });
      expect(makeParser({ [PKG]: content }).parsePackageJson('package.json').totalCount).to.equal(
        1
      );
    });

    it('throws FileNotFoundError when file does not exist', () => {
      const p = new DependencyParserService({ enableLogging: false }, missingReader());
      try {
        p.parsePackageJson('package.json');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(FileNotFoundError);
      }
    });

    it('throws InvalidFormatError for invalid JSON', () => {
      const p = makeParser({ [PKG]: 'not json {{{' });
      try {
        p.parsePackageJson('package.json');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(InvalidFormatError);
      }
    });
  });

  describe('parseRequirementsTxt()', () => {
    it('returns a ParseResult with python ecosystem', () => {
      expect(
        makeParser({ [REQ]: SAMPLE_REQUIREMENTS }).parseRequirementsTxt('requirements.txt')
          .ecosystem
      ).to.equal('python');
    });

    it('parses all non-comment, non-blank lines', () => {
      expect(
        makeParser({ [REQ]: SAMPLE_REQUIREMENTS }).parseRequirementsTxt('requirements.txt')
          .totalCount
      ).to.equal(9);
    });

    it('assigns section "main" to all python deps', () => {
      const result = makeParser({ [REQ]: SAMPLE_REQUIREMENTS }).parseRequirementsTxt(
        'requirements.txt'
      );
      expect(result.dependencies.every((d) => d.section === 'main')).to.be.true;
    });

    it('skips comment lines', () => {
      expect(
        makeParser({ [REQ]: '# comment\nrequests>=2.0' }).parseRequirementsTxt('requirements.txt')
          .totalCount
      ).to.equal(1);
    });

    it('skips blank lines', () => {
      expect(
        makeParser({ [REQ]: '\n\nrequests>=2.0\n\n' }).parseRequirementsTxt('requirements.txt')
          .totalCount
      ).to.equal(1);
    });

    it('skips -r and --index-url option lines', () => {
      const content = '-r base.txt\n--index-url https://pypi.org\nrequests>=2.0';
      expect(
        makeParser({ [REQ]: content }).parseRequirementsTxt('requirements.txt').totalCount
      ).to.equal(1);
    });

    it('strips inline comments', () => {
      const dep = makeParser({ [REQ]: 'requests>=2.0  # http library' }).parseRequirementsTxt(
        'requirements.txt'
      ).dependencies[0];
      expect(dep.name).to.equal('requests');
    });

    it('strips environment markers', () => {
      const dep = makeParser({ [REQ]: "Django>=4.0; python_version>='3.8'" }).parseRequirementsTxt(
        'requirements.txt'
      ).dependencies[0];
      expect(dep.name).to.equal('Django');
      expect(dep.specifier.version).to.equal('4.0');
    });

    it('strips package extras', () => {
      const dep = makeParser({ [REQ]: 'boto3[s3]>=1.26.0' }).parseRequirementsTxt(
        'requirements.txt'
      ).dependencies[0];
      expect(dep.name).to.equal('boto3');
    });

    it('throws FileNotFoundError when file does not exist', () => {
      const p = new DependencyParserService({ enableLogging: false }, missingReader());
      try {
        p.parseRequirementsTxt('requirements.txt');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(FileNotFoundError);
      }
    });
  });

  describe('parse()', () => {
    it('delegates to parsePackageJson for package.json', () => {
      expect(
        makeParser({ [PKG]: JSON.stringify({ dependencies: { react: '^18.0.0' } }) }).parse(
          'package.json'
        ).ecosystem
      ).to.equal('node');
    });

    it('delegates to parseRequirementsTxt for requirements.txt', () => {
      expect(makeParser({ [REQ]: 'requests>=2.0' }).parse('requirements.txt').ecosystem).to.equal(
        'python'
      );
    });

    it('delegates to parseRequirementsTxt for requirements-dev.txt', () => {
      expect(
        makeParser({ [REQ_DEV]: 'pytest==7.4.0' }).parse('requirements-dev.txt').ecosystem
      ).to.equal('python');
    });

    it('throws DependencyParseError for unsupported files', () => {
      try {
        makeParser().parse('Pipfile');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(DependencyParseError);
      }
    });
  });

  describe('parseNodeVersion()', () => {
    const parser = new DependencyParserService({ enableLogging: false });

    const cases: Array<[string, string, string, boolean]> = [
      ['^18.2.0', '^', '18.2.0', true],
      ['~1.4.0', '~', '1.4.0', true],
      ['>=5.0.0', '>=', '5.0.0', true],
      ['<=4.0.0', '<=', '4.0.0', true],
      ['>3.0.0', '>', '3.0.0', true],
      ['<2.0.0', '<', '2.0.0', true],
      ['4.17.21', '', '4.17.21', false],
      ['=1.0.0', '=', '1.0.0', false],
      ['*', '', '*', true],
      ['latest', '', 'latest', true],
      ['', '', '', true],
    ];

    cases.forEach(([raw, op, ver, isRange]) => {
      it(`parses "${raw}" → operator="${op}", version="${ver}", isRange=${isRange}`, () => {
        const spec = parser.parseNodeVersion(raw);
        expect(spec.operator).to.equal(op);
        expect(spec.version).to.equal(ver);
        expect(spec.isRange).to.equal(isRange);
        expect(spec.raw).to.equal(raw);
      });
    });

    it('handles compound range ">=1.0.0 <2.0.0"', () => {
      const spec = parser.parseNodeVersion('>=1.0.0 <2.0.0');
      expect(spec.isRange).to.be.true;
      expect(spec.operator).to.equal('>=');
    });

    it('handles OR range "^1.0.0 || ^2.0.0"', () => {
      expect(parser.parseNodeVersion('^1.0.0 || ^2.0.0').isRange).to.be.true;
    });

    it('handles git references', () => {
      const spec = parser.parseNodeVersion('git+https://github.com/org/repo.git');
      expect(spec.isRange).to.be.false;
      expect(spec.operator).to.equal('');
    });

    it('handles file references', () => {
      expect(parser.parseNodeVersion('file:../my-lib').operator).to.equal('');
    });

    it('handles scoped package versions', () => {
      const content = JSON.stringify({ dependencies: { '@angular/core': '^16.0.0' } });
      const result = makeParser({ [PKG]: content }).parsePackageJson('package.json');
      expect(result.dependencies[0].name).to.equal('@angular/core');
      expect(result.dependencies[0].specifier.operator).to.equal('^');
    });
  });

  describe('parsePythonVersion()', () => {
    const parser = new DependencyParserService({ enableLogging: false });

    const cases: Array<[string, string, string, boolean]> = [
      ['>=2.28.0', '>=', '2.28.0', true],
      ['==2.3.2', '==', '2.3.2', false],
      ['~=1.24.0', '~=', '1.24.0', true],
      ['!=1.0.0', '!=', '1.0.0', true],
      ['<=3.0', '<=', '3.0', true],
      ['>1.0', '>', '1.0', true],
      ['<3.0', '<', '3.0', true],
      ['==1.0.*', '==', '1.0.*', true],
      ['', '', '', false],
    ];

    cases.forEach(([raw, op, ver, isRange]) => {
      it(`parses "${raw}" → operator="${op}", version="${ver}", isRange=${isRange}`, () => {
        const spec = parser.parsePythonVersion(raw);
        expect(spec.operator).to.equal(op);
        expect(spec.version).to.equal(ver);
        expect(spec.isRange).to.equal(isRange);
      });
    });

    it('handles compound ">=2.0,<3.0" — uses first specifier as operator', () => {
      const spec = parser.parsePythonVersion('>=2.0,<3.0');
      expect(spec.operator).to.equal('>=');
      expect(spec.version).to.equal('2.0');
      expect(spec.isRange).to.be.true;
      expect(spec.raw).to.equal('>=2.0,<3.0');
    });

    it('preserves raw compound string', () => {
      const spec = parser.parsePythonVersion('>=1.0,!=1.5,<2.0');
      expect(spec.raw).to.equal('>=1.0,!=1.5,<2.0');
      expect(spec.isRange).to.be.true;
    });
  });

  describe('normalizeNodeName()', () => {
    const parser = new DependencyParserService({ enableLogging: false });

    it('lowercases the name', () => expect(parser.normalizeNodeName('React')).to.equal('react'));
    it('trims whitespace', () => expect(parser.normalizeNodeName('  lodash  ')).to.equal('lodash'));
    it('preserves scoped package names', () =>
      expect(parser.normalizeNodeName('@angular/core')).to.equal('@angular/core'));
  });

  describe('normalizePythonName()', () => {
    const parser = new DependencyParserService({ enableLogging: false });

    it('lowercases the name', () =>
      expect(parser.normalizePythonName('Requests')).to.equal('requests'));
    it('normalizes hyphens and underscores to hyphens (PEP 503)', () => {
      expect(parser.normalizePythonName('my_package')).to.equal('my-package');
      expect(parser.normalizePythonName('my.package')).to.equal('my-package');
      expect(parser.normalizePythonName('my--package')).to.equal('my-package');
    });
    it('normalizes mixed separators', () =>
      expect(parser.normalizePythonName('My_Great.Package')).to.equal('my-great-package'));
  });

  describe('caching', () => {
    it('caches result on first parse', () => {
      const p = makeParser({ [PKG]: SAMPLE_PACKAGE_JSON });
      p.parsePackageJson('package.json');
      expect(p.getCacheSize()).to.equal(1);
    });

    it('returns cached result on second call without re-reading file', () => {
      let readCount = 0;
      const reader: FileReader = {
        exists: () => true,
        read: () => {
          readCount++;
          return SAMPLE_PACKAGE_JSON;
        },
      };
      const p = new DependencyParserService({ enableLogging: false }, reader);
      p.parsePackageJson('package.json');
      p.parsePackageJson('package.json');
      expect(readCount).to.equal(1);
    });

    it('does not cache when enableCache is false', () => {
      const p = makeParser({ [PKG]: SAMPLE_PACKAGE_JSON }, { enableCache: false });
      p.parsePackageJson('package.json');
      expect(p.getCacheSize()).to.equal(0);
    });

    it('re-reads file after cache expires', () => {
      let readCount = 0;
      const reader: FileReader = {
        exists: () => true,
        read: () => {
          readCount++;
          return SAMPLE_PACKAGE_JSON;
        },
      };
      const p = new DependencyParserService({ enableLogging: false, cacheTtlMs: -1 }, reader);
      p.parsePackageJson('package.json');
      p.parsePackageJson('package.json');
      expect(readCount).to.equal(2);
    });

    it('clearCache() clears all entries', () => {
      const p = makeParser({ [PKG]: SAMPLE_PACKAGE_JSON });
      p.parsePackageJson('package.json');
      p.clearCache();
      expect(p.getCacheSize()).to.equal(0);
    });

    it('clearCache(filePath) clears only that entry', () => {
      let call = 0;
      const reader: FileReader = {
        exists: () => true,
        read: () => (call++ === 0 ? SAMPLE_PACKAGE_JSON : 'requests>=2.0'),
      };
      const p = new DependencyParserService({ enableLogging: false }, reader);
      p.parsePackageJson('package.json');
      p.parseRequirementsTxt('requirements.txt');
      expect(p.getCacheSize()).to.equal(2);
      p.clearCache(path.resolve('package.json'));
      expect(p.getCacheSize()).to.equal(1);
    });
  });

  describe('edge cases', () => {
    it('handles empty requirements.txt', () => {
      expect(
        makeParser({ [REQ]: '' }).parseRequirementsTxt('requirements.txt').totalCount
      ).to.equal(0);
    });

    it('handles requirements.txt with only comments', () => {
      expect(
        makeParser({ [REQ]: '# nothing\n# here' }).parseRequirementsTxt('requirements.txt')
          .totalCount
      ).to.equal(0);
    });

    it('handles package with no version in requirements.txt', () => {
      const dep = makeParser({ [REQ]: 'requests' }).parseRequirementsTxt('requirements.txt')
        .dependencies[0];
      expect(dep.specifier.version).to.equal('');
      expect(dep.specifier.isRange).to.be.false;
    });

    it('handles Windows-style CRLF line endings in requirements.txt', () => {
      expect(
        makeParser({ [REQ]: 'requests>=2.0\r\nflask==2.3.2\r\n' }).parseRequirementsTxt(
          'requirements.txt'
        ).totalCount
      ).to.equal(2);
    });

    it('handles deeply nested scoped packages in package.json', () => {
      const content = JSON.stringify({
        devDependencies: { '@types/node': '^20.0.0', '@types/react': '^18.0.0' },
      });
      const result = makeParser({ [PKG]: content }).parsePackageJson('package.json');
      expect(result.totalCount).to.equal(2);
      expect(result.dependencies[0].normalizedName).to.equal('@types/node');
    });

    it('handles version "0.0.0" without operator', () => {
      const spec = new DependencyParserService({ enableLogging: false }).parseNodeVersion('0.0.0');
      expect(spec.version).to.equal('0.0.0');
      expect(spec.operator).to.equal('');
      expect(spec.isRange).to.be.false;
    });

    it('handles python package with numeric name start', () => {
      const dep = makeParser({ [REQ]: 'h5py>=3.0' }).parseRequirementsTxt('requirements.txt')
        .dependencies[0];
      expect(dep.name).to.equal('h5py');
    });
  });
});
