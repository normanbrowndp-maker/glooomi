import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory=fileURLToPath(new URL('../public/fonts/',import.meta.url));await mkdir(directory,{recursive:true});
const userAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
for(const [family,slug,license] of [['Grand Hotel','grand-hotel','grandhotel'],['Pacifico','pacifico','pacifico'],['Leckerli One','leckerli-one','leckerlione'],['Montserrat','montserrat','montserrat']]){
  const weights=family==='Montserrat'?':wght@400;500;600;700;800':'';
  const response=await fetch(`https://fonts.googleapis.com/css2?family=${family.replaceAll(' ','+')}${weights}&display=swap`,{headers:{'User-Agent':userAgent}});
  if(!response.ok)throw new Error(`Font stylesheet failed: ${slug}`);const css=await response.text();
  const blocks=css.match(/(?:\/\*[^*]+\*\/\s*)?@font-face\s*\{[^}]+\}/g)||[];
  let result='';const downloads=new Map();let n=0;
  for(const block of blocks){
    if(family!=='Montserrat' && !/\/\* latin \*\//.test(block))continue;
    if(family==='Montserrat' && !/\/\* (latin|latin-ext|cyrillic|cyrillic-ext) \*\//.test(block))continue;
    const url=block.match(/url\(([^)]+)\)/)?.[1];if(!url)continue;
    let name=downloads.get(url);if(!name){name=`${slug}-${++n}.woff2`;const font=await fetch(url);if(!font.ok)throw new Error(`Font download failed: ${slug}`);await writeFile(directory+name,Buffer.from(await font.arrayBuffer()));downloads.set(url,name);}
    result+=block.replace(url,`/fonts/${name}`)+'\n';
  }
  if(!result)throw new Error(`No supported font subsets: ${slug}`);
  await writeFile(directory+`${slug}.css`,result);
  const ofl=await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${license}/OFL.txt`);if(!ofl.ok)throw new Error(`License missing: ${slug}`);await writeFile(directory+`${slug}-OFL.txt`,await ofl.text());
  console.log(`${slug}: ${downloads.size} local WOFF2 files with OFL license`);
}
