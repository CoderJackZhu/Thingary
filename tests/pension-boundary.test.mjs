import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const root=resolve(import.meta.dirname,'..');

// Follow the actual application entry, including type-only and dynamic imports.
// Experimental preview entry points are intentionally not production roots.
function dependencies(entry) {
  const seen=new Set();
  function visit(file) {
    if(seen.has(file))return;seen.add(file);
    const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function walk(node) {
      const spec=ts.isImportDeclaration(node)||ts.isExportDeclaration(node)?node.moduleSpecifier:
        ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:
        ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)?node.argument.literal:null;
      if(spec&&ts.isStringLiteral(spec)&&spec.text.startsWith('.')) {
        const base=resolve(dirname(file),spec.text);
        const next=[base,base+'.ts',base+'.tsx',resolve(base,'index.ts'),resolve(base,'index.tsx')].find(p=>/\.tsx?$/.test(p)&&existsSync(p));
        if(next)visit(next);
      }
      ts.forEachChild(node,walk);
    }
    walk(ast);
  }
  visit(resolve(root,entry));return [...seen].map(p=>relative(root,p));
}

test('ordinary application does not depend on the pension policy lab',()=>{
  const files=dependencies('src/main.tsx');
  assert.ok(files.includes('src/plan-pension.ts'));
  assert.ok(files.includes('src/plan-pension-path.ts'));
  assert.deepEqual(files.filter(p=>p.startsWith('src/pension-lab/')),[]);
});

test('independent policy preview still reaches the isolated amount kernel',()=>{
  const files=dependencies('src/career-preview/preview.tsx');
  assert.ok(files.includes('src/pension-lab/benefit.ts'));
});
