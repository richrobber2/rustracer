// Research prototype: SI units, uniform material; not calibrated human tissue.
export class SkinPatch {
  constructor({n=5, width=.18, depth=.03}={}) {
    if(n<3 || n%2!==1)throw new Error("Patch resolution must be odd and at least 3");
    const layers=4; this.n=n; this.rest=[]; this.tets=[]; this.edges=[]; this.surface=[];
    const id=(x,y,z)=>z*n*n+y*n+x;
    for(let z=0;z<layers;z++) for(let y=0;y<n;y++) for(let x=0;x<n;x++) this.rest.push((x/(n-1)-.5)*width,z*depth/(layers-1),(y/(n-1)-.5)*width);
    const patterns=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]], set=new Set();
    for(let z=0;z<layers-1;z++) for(let y=0;y<n-1;y++) for(let x=0;x<n-1;x++) {
      const c=[id(x,y,z),id(x+1,y,z),id(x,y+1,z),id(x+1,y+1,z),id(x,y,z+1),id(x+1,y,z+1),id(x,y+1,z+1),id(x+1,y+1,z+1)];
      for(const p of patterns) {const t=p.map(i=>c[i]); this.tets.push({ids:t,rest:this.volume(t,this.rest)}); for(let a=0;a<4;a++)for(let b=a+1;b<4;b++)set.add([t[a],t[b]].sort((a,b)=>a-b).join(','));}
      if(z===layers-2)this.surface.push(id(x,y,z+1),id(x,y+1,z+1),id(x+1,y+1,z+1),id(x,y,z+1),id(x+1,y+1,z+1),id(x+1,y,z+1));
    }
    for(const e of set) {const ids=e.split(',').map(Number);this.edges.push({ids,rest:Math.hypot(...[0,1,2].map(k=>this.rest[ids[0]*3+k]-this.rest[ids[1]*3+k])),skin:ids.every(i=>i>=(layers-1)*n*n)});}
    this.rest=Float64Array.from(this.rest); this.positions=this.rest.slice(); this.velocity=new Float64Array(this.rest.length);
    this.mass=new Float64Array(layers*n*n);
    for(const t of this.tets)for(const i of t.ids)this.mass[i]+=Math.abs(t.rest)*1000/4;
    this.inv=Float64Array.from(this.mass,(m,i)=>i<n*n?0:1/m);
    this.compliance=.02; this.preserveVolume=true; this.load=0; this.accumulator=0;
    this.center=id((n-1)/2,(n-1)/2,layers-1);
  }
  volume(ids,p=this.positions) {
    const [a,b,c,d]=ids.map(i=>[p[3*i],p[3*i+1],p[3*i+2]]),u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]),w=d.map((v,k)=>v-a[k]);
    return (u[0]*(v[1]*w[2]-v[2]*w[1])+u[1]*(v[2]*w[0]-v[0]*w[2])+u[2]*(v[0]*w[1]-v[1]*w[0]))/6;
  }
  reset(){this.positions.set(this.rest);this.velocity.fill(0);this.accumulator=0;this.load=0;}
  step(elapsed){this.accumulator+=Math.min(Math.max(elapsed,0),.05);while(this.accumulator>=1/240){this.substep(1/240);this.accumulator-=1/240;}}
  substep(dt){
    const p=this.positions, old=p.slice(), dt2=dt*dt;
    for(let i=0;i<this.inv.length;i++)if(this.inv[i])for(let k=0;k<3;k++){
      this.velocity[3*i+k]*=Math.exp(-8*dt);
      const r=Math.hypot(this.rest[3*i],this.rest[3*i+2]);
      const force=k===1 && i>=3*this.n*this.n?this.load*Math.exp(-r*r/(2*.018**2)):0;
      p[3*i+k]+=this.velocity[3*i+k]*dt+force*this.inv[i]*dt2;
    }
    const el=new Float64Array(this.edges.length), gradient=new Float64Array(p.length); let volumeLambda=0;
    const restVolume=this.tets.reduce((sum,t)=>sum+Math.abs(t.rest),0);
    for(let iteration=0;iteration<4;iteration++){
      this.edges.forEach((e,j)=>{
        const [a,b]=e.ids,d=[0,1,2].map(k=>p[3*a+k]-p[3*b+k]),len=Math.hypot(...d);if(len<1e-12)return;
        const alpha=this.compliance*(e.skin?.2:1)/dt2,den=this.inv[a]+this.inv[b]+alpha,dl=(-(len-e.rest)-alpha*el[j])/den;el[j]+=dl;
        for(let k=0;k<3;k++){p[3*a+k]+=this.inv[a]*dl*d[k]/len;p[3*b+k]-=this.inv[b]*dl*d[k]/len;}
      });
      if(this.preserveVolume){
        gradient.fill(0);let volume=0;
        for(const t of this.tets){
          const [a,b,c,d]=t.ids.map(i=>[p[3*i],p[3*i+1],p[3*i+2]]),sub=(u,v)=>u.map((x,k)=>x-v[k]),cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
          const gb=cross(sub(c,a),sub(d,a)).map(x=>x/6),gc=cross(sub(d,a),sub(b,a)).map(x=>x/6),gd=cross(sub(b,a),sub(c,a)).map(x=>x/6),ga=gb.map((x,k)=>-x-gc[k]-gd[k]),g=[ga,gb,gc,gd],sign=Math.sign(t.rest);
          volume+=this.volume(t.ids)*sign;
          for(let k=0;k<4;k++)for(let l=0;l<3;l++)gradient[3*t.ids[k]+l]+=g[k][l]*sign/restVolume;
        }
        const alpha=1e-5/dt2;let den=alpha;
        for(let i=0;i<p.length;i++)den+=this.inv[Math.floor(i/3)]*gradient[i]*gradient[i];
        const dl=(-(volume/restVolume-1)-alpha*volumeLambda)/den;volumeLambda+=dl;
        for(let i=0;i<p.length;i++)p[i]+=this.inv[Math.floor(i/3)]*dl*gradient[i];
      }
    }
    for(let i=0;i<p.length;i++)this.velocity[i]=(p[i]-old[i])/dt;
  }
  metrics(){const base=this.tets.reduce((s,t)=>s+Math.abs(t.rest),0),volume=this.tets.reduce((s,t)=>s+this.volume(t.ids)*Math.sign(t.rest),0);return {volumeError:100*(volume/base-1),displacement:1000*(this.positions[3*this.center+1]-this.rest[3*this.center+1]),inverted:this.tets.filter(t=>this.volume(t.ids)*t.rest<=0).length};}
}
