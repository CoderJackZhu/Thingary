# T21 final HEAD checks

HEAD: `4a1d682699f155afe008e21c418956d8d0299bd7`

| Command | Exit | Passed | Log |
|---|---|---|---|
| `npm run test:ui` | 0 | 82 | [ui](ui.log) |
| `npm test` | 0 | 103 | [rust](rust.log) |
| `npm run test:demo` | 0 | 2 | [demo](demo.log) |
| `npm run check` | 0 | — | [check](check.log) |
| `npm run build` | 0 | — | [web-build](web-build.log) |
| `npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app` | 0 | — | [debug-build](debug-build.log) |
| `npm run tauri -- build --config .local/t21-release.conf.json --bundles app` | 0 | — | [release-build](release-build.log) |
| `git diff --check` | 0 | — | [diff-check](diff-check.log) |
