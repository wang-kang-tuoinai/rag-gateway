// Both charts use the same plot margins and absolute time transform.
export const fullTime=ms=>new Date(ms).toLocaleString('zh-CN',{hour12:false});
export function chartFrame(canvas,window,maxValue,unit) {
  const width=Math.max(280,canvas.getBoundingClientRect().width),height=260,dpr=windowDevicePixelRatio();
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const x=ms=>64+(ms-window.start_ms)/(window.end_ms-window.start_ms)*(width-84);
  const y=value=>height-36-value/maxValue*(height-56);
  ctx.font='11px Segoe UI, Microsoft YaHei';ctx.lineWidth=1;
  for(let i=0;i<=4;i++) {
    const line=y(maxValue*i/4);ctx.strokeStyle='#e7ece8';ctx.beginPath();ctx.moveTo(64,line);ctx.lineTo(width-20,line);ctx.stroke();
    ctx.fillStyle='#738078';ctx.textAlign='right';ctx.fillText(`${Math.round(maxValue*i/4)} ${unit}`,57,line+4);
    const ms=window.start_ms+(window.end_ms-window.start_ms)*i/4;
    ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.fillText(new Date(ms).toLocaleTimeString('zh-CN',{hour12:false}),x(ms),height-12);
  }
  return {ctx,width,height,x,y,maxValue};
}
function windowDevicePixelRatio(){return globalThis.devicePixelRatio||1;}
export function clipPlot(f,draw) {
  f.ctx.save();f.ctx.beginPath();f.ctx.rect(64,18,f.width-84,f.height-54);f.ctx.clip();draw();f.ctx.restore();
}
export function drawSelection(f,selection) {
  if(!selection)return;
  const left=Math.max(64,f.x(selection.start*1000)),right=Math.min(f.width-20,f.x(selection.end*1000));
  if(right>left){f.ctx.fillStyle='#28644920';f.ctx.fillRect(left,18,right-left,f.height-54);f.ctx.strokeStyle='#286449';f.ctx.strokeRect(left,18,right-left,f.height-54);}
}
export function emptyText(f,text){f.ctx.fillStyle='#758079';f.ctx.textAlign='center';f.ctx.fillText(text,f.width/2,f.height/2);}
