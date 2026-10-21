import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, headingSlug } from '../scripts/guide-renderer.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
test('renderer retains explicit anchors, generates Chinese heading anchors and copies image intent', () => {
  const result = renderMarkdown('<a id="backup"></a>\n\n## 外币账户\n\n![虚构资料](images/wealth-light.jpg)\n\n## 外币账户', {resolveUrl: url => `/local/${url}`});
  assert.match(result.html, /id="backup"/);
  assert.deepEqual(result.headings.map(h => h.id), ['外币账户','外币账户-1']);
  assert.match(result.html, /src="\/local\/images\/wealth-light.jpg"/);
  assert.deepEqual(result.assets,['images/wealth-light.jpg']);
  assert.equal(headingSlug('1. 安装'), '1-安装');
  assert.match(renderMarkdown('`<script>`\n\n<script>alert(1)</script>').html, /&lt;script&gt;/);
});
test('built website has local working links, images, fragments and all canonical guide headings', () => {
  const output = mkdtempSync(join(tmpdir(), 'thingary-site-test-'));
  try {
    execFileSync(process.execPath, ['scripts/build-site.mjs', output], {cwd: root});
    const files = readdirSync(output,{recursive:true}).filter(f=>f.endsWith('.html'));
    assert.equal(files.length, 12);
    const documents = new Map(files.map(f=>[join(output,f),readFileSync(join(output,f),'utf8')]));
    const homeHeader = documents.get(join(output, 'index.html')).match(/<header class="header wrap">[\s\S]*?<\/header>/)[0];
    for (const [file,html] of documents) {
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
      assert.equal(new Set(ids).size,ids.length,`duplicate IDs in ${file}`);
      for(const match of html.matchAll(/\b(?:href|src|srcset)="([^"]+)"/g)) {
        const url = match[1];
        if (/^https:\/\//.test(url)) continue;
        assert.ok(!/^\/\//.test(url), `external dependency ${url}`);
        const [path,hash] = url.split('#');
        let target = resolve(dirname(file),decodeURIComponent(path || 'index.html'));
        if (path.endsWith('/')) target=join(target,'index.html');
        assert.ok(existsSync(target),`${file}: missing ${url}`);
        if(hash && target.endsWith('.html')) {
          const targetHtml=documents.get(target) ?? readFileSync(target,'utf8');
          assert.ok(targetHtml.includes(`id="${decodeURIComponent(hash)}"`),`${file}: missing fragment ${url}`);
        }
      }
      if(file.includes(`${join('guide','')}`) || file.includes('quickstart')) {
        const header = html.match(/<header class="header wrap">[\s\S]*?<\/header>/)?.[0];
        assert.ok(header, 'help must use the homepage header');
        assert.equal(header.replace(/href="(?:\.\.\/)+/g, 'href="').replace(' aria-current="page"', ''), homeHeader);
        assert.match(html, /id="brand-mark"/);
        assert.match(html, /id="language-zh"/);
        assert.doesNotMatch(html, /(?:src|srcset)="https:/, 'help images must stay local');
        assert.doesNotMatch(html, /href="https:\/\/github\.com\/CoderJackZhu\/Thingary\/blob\/main\/docs\/(?:USER_GUIDE|QUICKSTART)\.md/, 'core help must stay on the website');
      }
    }
    const index=readFileSync(join(output,'guide/index.html'),'utf8');
    const canonical=readFileSync(join(root,'docs/USER_GUIDE.md'),'utf8');
    for(const heading of renderMarkdown(canonical).headings.filter(h=>h.level>1)) assert.ok(index.includes(`id="${heading.id}"`), `missing legacy heading ${heading.id}`);
    for(const m of canonical.matchAll(/<a id="([a-z-]+)"><\/a>/g)) assert.ok(index.includes(`id="${m[1]}"`), `missing explicit anchor ${m[1]}`);
    assert.match(index, /location\.replace\(routes\[id\]/);
    assert.match(readFileSync(join(output,'quickstart/index.html'),'utf8'), /guide\/backup\/#backup/);
  } finally { rmSync(output,{recursive:true,force:true}); }
});
