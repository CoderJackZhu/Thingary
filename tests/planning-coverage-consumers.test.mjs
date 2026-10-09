import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import { actionableAnnotations, annotationSummary, affectingAnnotations, annotationDirection } from '../src/plan-annotations.ts';
import { planningConsumers, independentPlanningConsumers } from '../src/planning-consumers.ts';
import { prepareBasicPlan, buildBasicCapabilities } from '../src/plan-basic.ts';

const code=ts.transpileModule(readFileSync(new URL('../src/CoverageNote.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports={};
vm.runInNewContext(code,{exports,require:id=>({'react':React,'react/jsx-runtime':jsx,'./plan-annotations':{actionableAnnotations,annotationSummary,annotationDirection},'./plan-basic':{prepareBasicPlan}}[id])});
const render=(annotations,compact=false)=>renderToStaticMarkup(React.createElement(exports.CoverageNote,{annotations,compact}));
const batch=JSON.parse(readFileSync(new URL('./fixtures/planning-basic/nonblocking-demo.json',import.meta.url)));

test('demo ready result renders adjacent explicit assumptions; unused pool only in expanded basis',()=>{
 const c=buildBasicCapabilities(batch);assert.equal(c.requirement.status,'ready');
 const html=render(c.annotations);assert.match(html,/暂按额外费用计入，可能重复包含/);assert.match(html,/本次未采用/);
 assert.ok(annotationSummary(c.annotations).length<=3);
 assert.ok(annotationSummary(c.annotations).every(x=>!x.includes('本次未采用')));
 assert.match(render(c.annotations,true),/带待核对假设，详见目标页/);
 assert.equal(render(c.annotations.filter(x=>x.reason_code==='POOL_NOT_USED'),true),'');
});
test('many mixed sources yield at most one summary per direction, source counts are deduplicated',()=>{
 const base=buildBasicCapabilities(batch).annotations.find(a=>a.reason_code==='DEBT_UNLINKED');
 const rows=['requirement_lower','requirement_higher','uncertain'].flatMap((effect,j)=>Array.from({length:5},(_,i)=>({...base,id:`${j}-${i}`,effect,source_ids:[`source-${i}`]})));
 const lines=annotationSummary(rows);assert.equal(lines.length,3);assert.ok(lines.every(x=>x.includes('5 项')));
 assert.match(lines[0],/可能偏低/);assert.match(lines[1],/可能偏高/);assert.match(lines[2],/方向待核对/);
 assert.equal(affectingAnnotations([...rows,{...base,reason_code:'POOL_NOT_USED',treatment:'not_used'}]).length,15);
 const html=render(rows);assert.equal((html.match(/class="coverage-summary"/g)||[]).length,3);
 assert.doesNotMatch(html,/已确认|全部可行/);
});

// Audit each independently mountable numerical rendering function, not just file imports.
// This guards future paths against losing the shared component; real component event and
// SSR consumer tests separately assert the rendered note and saved-state transitions.
for(const consumer of planningConsumers)test(`coverage guard: ${consumer.file} → ${consumer.render}`,()=>{
 const source=ts.createSourceFile(consumer.file,readFileSync(new URL(`../src/${consumer.file}`,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let fn;function find(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===consumer.render)fn=n;ts.forEachChild(n,find);}find(source);
 assert.ok(fn,`missing listed rendering path ${consumer.render}`);
 const tags=[];function visit(n){if(ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))tags.push(n.tagName.getText(source));ts.forEachChild(n,visit);}visit(fn.body);
 assert.ok(tags.includes(consumer.guard)||fn.body.getText(source).includes('详见目标页'),`naked numerical render path: ${consumer.render}`);
 if(consumer.guard==='RequirementLine')assert.match(fn.body.getText(source),/annotations=\{caps.annotations\}/);
});
test('independent policy, frozen report, temporary runway keep explicit model boundaries',()=>assert.equal(independentPlanningConsumers.length,3));
