'use strict';
// Explicitly SYNTHETIC patterns. No real skin/medical or SOTA claim.
function texture(width=128,height=96) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    const t=10*Math.sin(x*Math.PI/2)+7*Math.cos(y*Math.PI/2);
    data[i]=170+t+x*.08;data[i+1]=130+t+y*.04;data[i+2]=105+t;data[i+3]=255;
  }
  return {width,height,data};
}
function grid(width=128,height=96) {
  const im=texture(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;im.data[i]=x%8===0?20:220;im.data[i+1]=y%8===0?20:180;im.data[i+2]=((x>>3)+(y>>3))%2?60:210;
  }return im;
}
function copy(im){return {...im,data:new Uint8ClampedArray(im.data)};}
function addSyntheticDefect(im,{x=.5,y=.5,r=.025,color=[68,35,24]}={}) {
  const out=copy(im),cx=x*(im.width-1),cy=y*(im.height-1),rr=r*Math.min(im.width,im.height);
  for(let yy=0;yy<im.height;yy++)for(let xx=0;xx<im.width;xx++)if(Math.hypot(xx-cx,yy-cy)<rr){const i=(yy*im.width+xx)*4;for(let c=0;c<3;c++)out.data[i+c]=color[c];}
  return out;
}
function binaryMask(width,height,predicate){const data=new Float32Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=predicate(x,y)?1:0;return {width,height,data};}
function changed(a,b,predicate=()=>true){let n=0;for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)if(predicate(x,y)){const i=(y*a.width+x)*4;if([0,1,2,3].some(c=>a.data[i+c]!==b.data[i+c]))n++;}return n;}
function energy(im,x0,y0,x1,y1){let sum=0,n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*im.width+x)*4;sum+=Math.abs(im.data[i]-im.data[i+4])+Math.abs(im.data[i]-im.data[i+im.width*4]);n+=2;}return sum/n;}
module.exports={texture,grid,copy,addSyntheticDefect,binaryMask,changed,energy};
