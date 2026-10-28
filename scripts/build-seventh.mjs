/** 编译固定计算和离线入口，复制全部已核验资源；构建过程不联网。 */
import {build} from 'vite';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copySeventhNative} from './seventh-runtime-assets.mjs';
import {BUILD_TARGETS} from './build-targets.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'.sakura-server');
for(const target of BUILD_TARGETS.filter(target=>target.group==='seventh'))await build({root,build:{ssr:target.entry,outDir:join(root,target.outDir),emptyOutDir:target.emptyOutDir}});
await mkdir(join(output,'assets'),{recursive:true});
for(const file of ['seventh-worker.mjs','seventh-engineering-worker.py','seventh-creation-native-worker.py']){
 await cp(join(root,'server',file),join(output,file));await cp(join(root,'server',file),join(output,'assets',file));
}
await cp(join(root,'shared/seventh-catalog.json'),join(output,'seventh-catalog.json'));
await mkdir(join(output,'docs'),{recursive:true});
for(const name of ['seventh-tool-images.md','seventh-plugin-packs.md','seventh-plugin-members.md','release-2.12.0.md','release-2.12.1.md','release-2.12.2.md','release-2.12.3.md','release-2.12.4.md'])await cp(join(root,'docs',name),join(output,'docs',name));
await mkdir(join(output,'native/seventh-creation-sandbox'),{recursive:true});
for(const name of ['README.md','requirements.txt'])await cp(join(root,'native/seventh-creation-sandbox',name),join(output,'native/seventh-creation-sandbox',name));
const native=process.platform==='win32'&&process.arch==='x64'?await copySeventhNative(resolve(process.env.SAKURA_SEVENTH_NATIVE_ASSETS??join(root,'.tools/seventh-creation')),join(output,'assets/seventh-creation'),{worker:join(root,'server/seventh-creation-native-worker.py'),source:join(root,'native/seventh-creation-sandbox/Program.cs')}):null;
const names=['seventh-worker-task.js','seventh-offline.js','seventh-catalog.json',...['seventh-worker.mjs','seventh-engineering-worker.py','seventh-creation-native-worker.py'].flatMap(f=>[f,'assets/'+f])];
const files=await Promise.all(names.map(async file=>{const bytes=await readFile(join(output,file));return {file,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));
await writeFile(join(output,'assets/seventh-runtime.json'),JSON.stringify({schemaVersion:1,platform:process.platform,architecture:process.arch,files,native},null,2)+'\n');
console.log(JSON.stringify({seventhRuntime:'built',files:files.length,native},null,2));
