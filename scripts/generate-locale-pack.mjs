import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import OpenCC from 'opencc-js';

const root = resolve('.');
const chinese = /[\u3400-\u9fff]/;
const convert = OpenCC.Converter({ from: 'cn', to: 'twp' });
const phrases = new Set();
const prefix = new Set(), suffix = new Set();

async function collect(directory) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else if (/\.tsx?$/.test(entry.name)) {
      const source = ts.createSourceFile(path, await readFile(resolve(root, path), 'utf8'),
        ts.ScriptTarget.Latest, true, entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node) => {
        if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          const phrase = node.text.trim();
          if (phrase.length > 0 && phrase.length <= 200 && chinese.test(phrase) && !phrase.includes('\n'))
            phrases.add(phrase);
        }
        if (ts.isTemplateExpression(node)) {
          const head = node.head.text;
          const tail = node.templateSpans.at(-1)?.literal.text || '';
          if (head.length >= 5 && head.length <= 160 && chinese.test(head) && !head.includes('\n')) prefix.add(head);
          if (tail.length >= 5 && tail.length <= 160 && chinese.test(tail) && !tail.includes('\n')) suffix.add(tail);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}
await Promise.all([collect('src'), collect('plugins')]);
const pack = Object.fromEntries([...phrases].sort().map((phrase) => [phrase, convert(phrase)])
  .filter(([source, translated]) => source !== translated));
const fragmentPack = Object.fromEntries([['prefix', prefix], ['suffix', suffix]].map(([kind, values]) => [kind,
  [...values].map((source) => [source, convert(source)]).filter(([source, translated]) => source !== translated)
    .sort((a, b) => b[0].length - a[0].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
]));
for (const [name, value] of [['zh-TW.json', pack], ['zh-TW-fragments.json', fragmentPack]]) {
  const file = resolve(root, 'src/locales', name);
  const output = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== output) throw new Error(`${name} 需要重新生成`);
  } else await writeFile(file, output);
}
console.log(`Traditional Chinese UI phrases: ${Object.keys(pack).length}; dynamic fragments: ${fragmentPack.prefix.length + fragmentPack.suffix.length}`);
