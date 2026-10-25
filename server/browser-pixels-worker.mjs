/** 有界 PNG 像素比较；运行于专用计算线程。 */
import { parentPort, workerData } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
const crcTable = Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const crc = (bytes) => {let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;};
function decode(value) {
  const data=Buffer.from(value);
  if(data.length>4*1024**2||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('PNG_FORMAT');
  let offset=8,width=0,height=0,channels=0,ended=false,header=false,compressed=0;
  const pieces=[];
  while(offset<data.length){
    if(offset+12>data.length)throw new Error('PNG_TRUNCATED');
    const size=data.readUInt32BE(offset),end=offset+12+size,type=data.toString('ascii',offset+4,offset+8);
    if(end>data.length||crc(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))throw new Error('PNG_CRC');
    const payload=data.subarray(offset+8,end-4);
    if(type==='IHDR'){
      if(header||offset!==8||size!==13)throw new Error('PNG_HEADER');
      width=payload.readUInt32BE(0);height=payload.readUInt32BE(4);channels=payload[9]===6?4:payload[9]===2?3:0;
      if(!width||!height||width>1920||height>1080||width*height>2073600||payload[8]!==8||!channels||payload[10]||payload[11]||payload[12])throw new Error('PNG_PROFILE');
      header=true;
    }else if(type==='IDAT'){
      if(!header||ended)throw new Error('PNG_ORDER');compressed+=size;if(compressed>4*1024**2)throw new Error('PNG_BUDGET');pieces.push(payload);
    }else if(type==='IEND'){
      if(size||!header||!pieces.length)throw new Error('PNG_END');ended=true;offset=end;break;
    }else if(!/^[a-z]/.test(type)&&type!=='PLTE')throw new Error('PNG_CRITICAL_CHUNK');
    offset=end;
  }
  if(!ended||offset!==data.length)throw new Error('PNG_TRAILING_DATA');
  const stride=width*channels,expected=height*(stride+1),raw=inflateSync(Buffer.concat(pieces),{maxOutputLength:expected});
  if(raw.length!==expected)throw new Error('PNG_DECODE_SIZE');
  const pixels=Buffer.alloc(width*height*4),row=Buffer.alloc(stride),prior=Buffer.alloc(stride);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];if(filter>4)throw new Error('PNG_FILTER');
    for(let x=0;x<stride;x++){
      const left=x>=channels?row[x-channels]:0,up=prior[x],upperLeft=x>=channels?prior[x-channels]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);
      row[x]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
    for(let x=0;x<width;x++){
      const target=(y*width+x)*4,source=x*channels;
      pixels[target]=row[source];pixels[target+1]=row[source+1];pixels[target+2]=row[source+2];pixels[target+3]=channels===4?row[source+3]:255;
    }
    row.copy(prior);
  }
  return {width,height,pixels};
}
try {
  const left=decode(workerData.left),right=decode(workerData.right),masks=workerData.masks;
  if(!Array.isArray(masks)||masks.length>20)throw new Error('PNG_MASKS');
  if(left.width!==right.width||left.height!==right.height){parentPort.postMessage({ok:true,result:{comparable:false,pixels:0,changed:0,ratio:null}});}else{
    for(const mask of masks)if(!['x','y','width','height'].every(key=>Number.isSafeInteger(mask[key]))||mask.x<0||mask.y<0||mask.width<1||mask.height<1||mask.x+mask.width>left.width||mask.y+mask.height>left.height)throw new Error('PNG_MASK_BOUNDS');
    let pixels=0,changed=0;
    for(let y=0;y<left.height;y++)for(let x=0;x<left.width;x++){
      if(masks.some(mask=>x>=mask.x&&x<mask.x+mask.width&&y>=mask.y&&y<mask.y+mask.height))continue;
      pixels++;const i=(y*left.width+x)*4;
      if(left.pixels[i]!==right.pixels[i]||left.pixels[i+1]!==right.pixels[i+1]||left.pixels[i+2]!==right.pixels[i+2]||left.pixels[i+3]!==right.pixels[i+3])changed++;
    }
    parentPort.postMessage({ok:true,result:{comparable:pixels>0,pixels,changed,ratio:pixels?changed/pixels:null}});
  }
}catch(error){parentPort.postMessage({ok:false,code:'BROWSER_PIXEL_COMPARISON_FAILED',error:error.message});}
