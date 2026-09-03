import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stackInTree } from '../src/stack.js';

describe('stackInTree', () => {
  it('reads dependency files and file names from a working copy, skipping node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'at-tree-'));
    writeFileSync(join(root, 'pom.xml'), '<artifactId>spring-boot-starter-web</artifactId><artifactId>flyway-mysql</artifactId><artifactId>lombok</artifactId>');
    mkdirSync(join(root, 'web'));
    writeFileSync(join(root, 'web', 'package.json'), JSON.stringify({ dependencies: { react: '1' }, devDependencies: { vitest: '1' } }));
    mkdirSync(join(root, 'src', 'main', 'java'), { recursive: true });
    writeFileSync(join(root, 'src', 'main', 'java', 'App.java'), 'class App {}');
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'x', 'package.json'), JSON.stringify({ dependencies: { express: '1' } }));
    const techs = stackInTree(root).map((t) => t.tech).sort();
    expect(techs).toEqual(['flyway', 'java', 'maven', 'node', 'react', 'spring-boot', 'vitest']);
  });
});
