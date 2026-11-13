import fs from 'node:fs'; import path from 'node:path';
const root = process.argv[2];
const envFiles = ['.env','.env.local','.env.production','.env.development'].filter(f=>fs.existsSync(f));
const vals = [];
for (const f of envFiles) for (const line of fs.readFileSync(f,'utf8').split('\n')) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2].trim().replace(/^['"]|['"]$/g,''); if (v.length >= 12) vals.push({file:f,key:m[1],v});
}
const files=[]; (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); e.isDirectory()?walk(p):files.push(p);}})(root);
const blobs = files.map(f=>fs.readFileSync(f,'latin1'));
const out = [];
out.push(`files scanned: ${files.length} under ${root}`);
out.push(`env files: ${envFiles.join(', ')}; values (len>=12) checked: ${vals.length}`);
for (const {file,key,v} of vals) { let c=0; for (const b of blobs){let i=0; while((i=b.indexOf(v,i))!==-1){c++;i+=v.length;}} out.push(`${file}:${key} matches=${c}`); }
for (const pat of ['sk-ant','sk-','AIza']) { let c=0, fl=new Set(); const re = new RegExp(pat.replace('-','\\-')+'[A-Za-z0-9_\\-]{8,}','g'); blobs.forEach((b,i)=>{const m=b.match(re); if(m){c+=m.length; fl.add(files[i]);}}); let raw=0; blobs.forEach(b=>{raw+=b.split(pat).length-1}); out.push(`pattern '${pat}': raw=${raw}, key-like(${pat}+8 chars)=${c} files=${[...fl].join(',')}`); }
console.log(out.join('\n'));
