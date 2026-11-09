import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { demoArt } from './demo-art.mjs';
const require=createRequire(import.meta.url);const root=fileURLToPath(new URL('../../../',import.meta.url));
function key(id){const bytes=createHash('sha256').update(id).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return `private-media/${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}
export async function seedDemo({db,storageRoot,password}){
 if(!password||password.length<10)throw new Error('Set GLOOMI_DEMO_PASSWORD with at least 10 characters.');
 const passwordHash=await require('bcrypt').hash(password,10);const users=[];await mkdir(resolve(storageRoot,'private-media'),{recursive:true});
 const authors=[['demo_ira','Ира · Демо','Собираю цвета, свет и маленькие истории.'],['demo_max','Макс · Демо','Архитектура, прогулки и спокойный ритм.'],['demo_sonya','Соня · Демо','Вдохновение в повседневных моментах.']];
 for(let i=0;i<authors.length;i++){
  const [username,displayName,bio]=authors[i];const email=`${username}@gloomi-demo.invalid`;let user=await db.user.findUnique({where:{username}});
  if(user&&user.email!==email){console.log(`Skipped reserved demo name: ${username}`);continue;}
  if(!user)user=await db.user.create({data:{email,username,passwordHash,emailVerified:new Date(),profile:{create:{displayName,bio:`Демонстрационный аккаунт. ${bio}`,visibility:'PUBLIC'}}}});
  users.push(user);
  for(let n=0;n<3;n++){
   const id=`gloomi-demo-post-${i}-${n}`;const existing=await db.post.findUnique({where:{id}});if(existing)continue;
   const mediaId=`gloomi-demo-media-${i}-${n}`;const objectKey=key(mediaId);const bytes=demoArt(i*3+n);await writeFile(resolve(storageRoot,objectKey),bytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error});
   await db.$transaction(async tx=>{await tx.mediaAsset.create({data:{id:mediaId,ownerId:user.id,objectKey,mediaType:'IMAGE',purpose:'POST',contentType:'image/png',sizeBytes:bytes.length,status:'ATTACHED',uploadUntil:new Date(Date.now()+86400000)}});await tx.post.create({data:{id,authorId:user.id,mediaAssetId:mediaId,mediaUrl:'',caption:`Демо · ${['Мягкий свет и немного тишины. #момент #цвет','Маленькие открытия обычного дня. #архитектура #gloomi','Там, где хочется замедлиться. #вдохновение #прогулка'][n]}`,location:['Город в вашем ритме','По дороге домой','Место для вдохновения'][n]}})});
  }
 }
 console.log(`Demo seed ready: ${users.length} explicitly labeled authors. Existing users/posts were not overwritten.`);return users;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let db;
 try{
  require('dotenv').config({path:resolve(root,'.env')});const target=new URL(process.env.DATABASE_URL||'');
  if(!['localhost','127.0.0.1'].includes(target.hostname)&&!process.argv.includes('--allow-remote-demo')){console.error('Remote demo seeding is disabled. Primary Neon data requires separate explicit authorization; no changes were made.');process.exitCode=1;}
  else{const {PrismaClient}=require('@prisma/client');db=new PrismaClient();await seedDemo({db,storageRoot:resolve(process.env.LOCAL_MEDIA_DIR||resolve(root,'uploads')),password:process.env.GLOOMI_DEMO_PASSWORD})}
 }catch{console.error('Demo seed failed. Check DATABASE_URL, GLOOMI_DEMO_PASSWORD and private storage permissions locally. Credentials are never printed.');process.exitCode=1}
 finally{await db?.$disconnect()}
}
