/** Local loopback aliases must use the same cookie host on both sides. */
export function webOrigins() {
  const parsed=process.env.WEB_ORIGIN?.split(',').map(origin=>origin.trim()).filter(Boolean);
  const configured=parsed?.length?parsed:['http://localhost:5173'];
  if(process.env.NODE_ENV==='production')return configured;
  const allowed=new Set(configured);
  for(const origin of configured){
    try{const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1'].includes(url.hostname))continue;url.hostname=url.hostname==='localhost'?'127.0.0.1':'localhost';allowed.add(url.origin)}catch{}
  }
  return [...allowed];
}
