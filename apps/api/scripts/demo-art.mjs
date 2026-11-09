// Original procedural illustrations: no third-party photos or image services.
import { deflateSync } from 'node:zlib';
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0)}return (value^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
export function demoArt(theme=0,width=780,height=640){
 const palettes=[[[232,221,248],[182,173,222],[104,98,153],[67,76,123],[251,220,181]],[[252,227,207],[235,177,146],[181,112,120],[111,81,104],[255,245,215]],[[208,233,234],[147,197,195],[71,137,149],[41,91,112],[255,230,187]],[[225,229,247],[163,180,222],[98,122,181],[61,74,131],[246,225,197]]];
 const [sky,far,mid,front,sun]=palettes[theme%palettes.length];const raw=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++){raw[y*(width*3+1)]=0;for(let x=0;x<width;x++){const nx=x/width,ny=y/height;let color=sky.map((v,i)=>Math.round(v+(far[i]-v)*ny*.38));
  if((nx-.73)**2+(ny-.25)**2<.105**2)color=sun;
  if(theme%3===0){if(ny>.61+Math.sin(nx*7+theme)*.09)color=far;if(ny>.77-Math.abs(nx-.43)*.68)color=mid;if(ny>.82+Math.sin(nx*6+theme)*.13)color=front;}
  else if(theme%3===1){if(nx>.17&&nx<.8&&ny>.22&&ny<.9)color=far;if(nx>.3&&nx<.67&&ny>.52)color=front;if(((nx-.485)/.185)**2+((ny-.52)/.19)**2<1&&ny<.52)color=front;if(ny>.9)color=mid;for(let j=0;j<4;j++)if(ny>.71+j*.055&&ny<.727+j*.055&&nx>.27-j*.035&&nx<.7+j*.035)color=sun;}
  else {if(ny>.52)color=far;if(ny>.58+Math.sin(nx*13+theme)*.025)color=mid;if(ny>.76+Math.sin(nx*8)*.07)color=front;if(ny>.9+Math.sin(nx*7)*.04)color=sun;}
  const p=y*(width*3+1)+1+x*3;raw[p]=color[0];raw[p+1]=color[1];raw[p+2]=color[2];
 }}
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
