import { DEFAULTS, evaluate, solve, capacityCurve, recoverySweep, demandCurve } from './model.mjs';
import { renderCapacityChart, renderRecoveryChart, renderDemandChart, renderAccountingChart } from './charts.mjs';

const $ = id => document.getElementById(id);
const format = (n, digits=1) => n === null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits:digits, minimumFractionDigits:0 }).format(Math.abs(n)<1e-7?0:n);
const percent = (n,d=0) => `${format(n*100,d)}%`;
const state = { p:{...DEFAULTS}, mode:'solve', manual:{c:100,alpha:.5}, selected:null, optimum:null, activePlayer:null };
let sweepCache = {key:null,data:[]};
let renderTimer, announcementTimer, toastTimer;
const paramLabels={gamma:'Permitted recovery',rho:'Allowed return',r:'True cost of capital',cap:'Eligible capacity',mean:'Expected demand',outside:'Outside option'};
const advanced=[
 {key:'spread',label:'Demand uncertainty',symbol:'s',min:0,max:1,step:.01,hint:'Widen or narrow the range of possible demand around its average.',percent:true},
 {key:'q',label:'Contract tariff',symbol:'q',min:.1,max:3,step:.05,hint:'Money per unit of billed capacity.'},
 {key:'v',label:'Value of service',symbol:'v',min:.1,max:4,step:.05,hint:'Gross data-center value per unit served.'},
 {key:'o',label:'Operating cost',symbol:'o',min:0,max:1.5,step:.05,hint:'Utility operating cost per unit served.'},
 {key:'k',label:'Base investment cost',symbol:'k',min:0,max:20,step:.25,hint:'The base investment needed for each additional unit of capacity.'},
 {key:'h',label:'Investment curvature',symbol:'h',min:0,max:.1,step:.002,hint:'How quickly further capacity expansion becomes more expensive.'},
];
$('advanced-controls').innerHTML=advanced.map(a=>`<div class="control"><label for="${a.key}">${a.label}<span>${a.symbol} <output id="${a.key}-value" for="${a.key}"></output></span></label><input id="${a.key}" type="range" min="${a.min}" max="${a.max}" step="${a.step}"><div class="hint">${a.hint}</div></div>`).join('');
const parameterKeys=Object.keys(DEFAULTS);
const roleDetails={
 regulator:{title:'The regulator sets the feasible rules',copy:'γ permits recovery of a share of the gap ρK − M; ρ caps the return on eligible capital. These are policy inputs. The draft does not assign the regulator an objective to optimize.'},
 utility:{title:'The utility chooses the offer',copy:'The utility chooses capacity c and minimum-bill share α to maximize actual profit M + T − rK. The data center must accept, the return ceiling must hold, and capacity cannot exceed the engineering bound.'},
 datacenter:{title:'The data center has a credible outside option',copy:'The data center accepts only if expected service value minus its expected bill is at least Π̄ᴅ. Demand and the outside option are economic conditions; acceptance is its strategic decision.'},
 ratepayers:{title:'Ratepayers fund permitted recovery',copy:'Other ratepayers pay the aggregate expected transfer T = γ(ρK − M). They are affected stakeholders with no strategic choice in this compact game. Recovery is expected, not a state-by-state bill or a per-household estimate.'},
};
function updateControl(key){
 const el=$(key),value=state.p[key];
 el.value=value;
 el.style.setProperty('--range-fill',`${(value-Number(el.min))/(Number(el.max)-Number(el.min))*100}%`);
 const isPct=['gamma','rho','r','spread'].includes(key);
 const displayed=isPct?percent(value,key==='gamma'||key==='spread'?0:1):format(value,key==='h'?3:2);
 $(key+'-value').textContent=displayed;
 el.setAttribute('aria-valuetext',displayed);
}
function syncControls(){parameterKeys.forEach(updateControl);$('manual-c').max=state.p.cap;}
function queueRender(){clearTimeout(renderTimer);renderTimer=setTimeout(render,80);}
parameterKeys.forEach(key=>$(key).addEventListener('input',event=>{
 state.p[key]=Number(event.target.value);$('scenario').value='custom';updateControl(key);
 if(key==='cap'){state.manual.c=Math.min(state.manual.c,state.p.cap);$('manual-c').max=state.p.cap;}
 queueRender();
}));
function manualInput(){state.manual={c:Number($('manual-c').value),alpha:Number($('manual-alpha').value)};queueRender();}
$('manual-c').addEventListener('input',manualInput);$('manual-alpha').addEventListener('input',manualInput);
function setMode(mode){
 if(mode==='manual'&&state.mode!=='manual'){state.manual={c:state.optimum?.c||Math.min(100,state.p.cap),alpha:state.optimum?.alpha||0};}
 state.mode=mode;render();
}
$('mode-solve').addEventListener('click',()=>setMode('solve'));$('mode-manual').addEventListener('click',()=>setMode('manual'));
const scenarios={baseline:{},'no-recovery':{gamma:0},'full-recovery':{gamma:1},'tight-cap':{cap:100},'strong-outside':{outside:70}};
$('scenario').addEventListener('change',e=>{state.p={...DEFAULTS,...scenarios[e.target.value]};state.mode='solve';syncControls();render();});
$('reset').addEventListener('click',()=>{state.p={...DEFAULTS};state.mode='solve';$('scenario').value='baseline';syncControls();render();toast('Illustrative baseline restored.');});
function selectRole(player){
 state.activePlayer=state.activePlayer===player?null:player;
 document.querySelectorAll('[data-player]').forEach(el=>{const isActive=el.dataset.player===state.activePlayer;el.classList.toggle('active',isActive);el.querySelector('button').setAttribute('aria-expanded',isActive);});
 const data=roleDetails[state.activePlayer]||{title:'Regulated profit, explained',copy:'The allowed return is a ceiling. Actual utility profit is the data center’s payment plus ratepayer recovery, less operating and capital costs.'};
 $('role-title').textContent=data.title;$('role-copy').textContent=data.copy;
}
document.querySelectorAll('[data-player] .player-heading').forEach(el=>el.addEventListener('click',()=>selectRole(el.closest('[data-player]').dataset.player)));
$('show-recovery').addEventListener('click',()=>{$('recovery-panel').scrollIntoView({behavior:'smooth',block:'center'});});
$('toggle-assumptions').addEventListener('click',()=>{const open=$('advanced-controls').hidden;$('advanced-controls').hidden=!open;$('toggle-assumptions').setAttribute('aria-expanded',open);$('toggle-assumptions').innerHTML=`${open?'Hide':'Edit'} assumptions <span>${open?'−':'+'}</span>`;});
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3200);}
function check(id,label,valid,detail,neutral=false){$(id).className=valid||neutral?'':'fail';$(id).innerHTML=`<span class="check-icon">${neutral?'–':valid?'✓':'×'}</span><span class="check-label">${label}</span><small>${detail}</small>`;}
function insight(s,p){
 if(s.status==='no-build')return s.reason+' The data center retains its outside option.';
 if(!s.participationFeasible)return 'The minimum bill leaves the data center below its outside option. Lower the minimum-bill share or change the offered capacity to explore an acceptable contract.';
 if(!s.regulatoryFeasible)return 'The data center’s contribution exceeds the allowed return. The draft excludes this offer; it does not automatically add a rebate.';
 if(s.profit<0)return 'The offer meets both constraints, but the utility would lose money. Its no-build alternative returns zero profit.';
 if(p.gamma===1&&p.rho>p.r)return 'Full recovery leaves utility profit equal to (ρ − r)K. More eligible capital can raise profit. The lowest minimum bill breaks ties; other α values may also be optimal.';
 if(p.rho<=p.r)return 'Allowed return does not exceed the true cost of capital. There is no positive regulated spread encouraging expansion.';
 if(s.c>=p.cap-.01)return 'The eligible-capacity ceiling binds. The utility has reached the engineering limit under these assumptions.';
 if(p.gamma===0)return 'No costs are shifted to ratepayers. The utility earns the data center’s net contribution less true capital cost; the return ceiling still applies.';
 return `Recovery covers ${percent(p.gamma)} of the allowed-return gap. The utility balances customer contribution against a ${percent(p.rho-p.r,1)} regulated spread on capital.`;
}
function render(){
 const p=state.p;state.optimum=solve(p);
 const manual=state.mode==='manual';
 const s=manual?{...evaluate(state.manual.c,state.manual.alpha,p),status:'proposal'}:state.optimum;
 state.selected=s;const noDeal=s.status==='no-build',valid=s.feasible;
 $('mode-solve').classList.toggle('selected',!manual);$('mode-solve').setAttribute('aria-pressed',!manual);
 $('mode-manual').classList.toggle('selected',manual);$('mode-manual').setAttribute('aria-pressed',manual);
 ['manual-c','manual-alpha'].forEach(id=>$(id).hidden=!manual);
 $('manual-c').value=s.c;$('manual-alpha').value=s.alpha;
 $('manual-c').max=p.cap;
 $('manual-c').style.setProperty('--range-fill',`${s.c/p.cap*100}%`);
 $('manual-alpha').style.setProperty('--range-fill',percent(s.alpha));
 $('manual-c').setAttribute('aria-valuetext',`${format(s.c)} capacity units`);
 $('manual-alpha').setAttribute('aria-valuetext',percent(s.alpha,1));
 $('offer-c').textContent=format(s.c);$('offer-alpha').textContent=noDeal?'—':percent(s.alpha,1);$('decision-tag').textContent=manual?'YOUR OFFER':noDeal?'NO DEAL':'SOLVED';
 $('utility-note').textContent=manual?'Adjust the offer; check whether both parties agree.':'Maximizes profit subject to both constraints.';
 $('outcome-heading').textContent=manual?'Your proposed offer':'The solved contract';
 $('outcome-caption').textContent=manual?'Contract check · this offer is not necessarily optimal.':'Utility’s best feasible offer at these settings.';
 $('outcome-status').textContent=noDeal?'No build':!valid?'Infeasible':s.profit<0?'Loss-making':manual?'Feasible':'Accepted';
 $('outcome-status').classList.toggle('warn',noDeal||!valid||s.profit<0);
 $('stat-capacity').textContent=valid?format(s.c):'—';
 document.querySelector('.capacity-stat>span').textContent=manual?'Proposed capacity':'Approved capacity';
 $('stat-served').textContent=valid?format(s.expectedServed):'—';$('stat-utilization').textContent=valid?`${percent(s.utilization)} utilized`:'Not implemented';
 $('used-meter').style.width=valid?`${s.utilization*100}%`:'0%';$('unused-meter').style.width=valid&&s.c>0?`${(1-s.utilization)*100}%`:'0%';
 $('stat-profit').textContent=format(s.profit);$('stat-dc').textContent=valid?format(s.dcPayoff):'—';$('stat-transfer').textContent=format(s.transfer);
 document.querySelector('#stat-dc').previousElementSibling.querySelector('small').textContent=noDeal?'Outside option retained':'Net of its bill';
 $('ratepayer-transfer').textContent=format(s.transfer);$('recovery-fill').style.width=valid?percent(p.gamma):'0%';
 $('ratepayer-note').textContent=noDeal?'No investment, so no ratepayer transfer.':!valid?'This offer is infeasible. No recovery is implemented.':`${percent(p.gamma)} of the ${format(Math.max(0,s.regulatorySlack))} gap between allowed return and customer contribution.`;
 const acceptance=$('acceptance');acceptance.classList.toggle('rejected',!s.participationFeasible);
 acceptance.lastElementChild.textContent=noDeal?'No offer · outside option retained':s.participationFeasible?`Accepts · payoff ${format(s.dcPayoff)} ≥ ${format(p.outside)}`:`Rejects · payoff ${format(s.dcPayoff)} < ${format(p.outside)}`;
 check('check-participation','Data-center participation',s.participationFeasible,noDeal?'No contract':Math.abs(s.participationSlack)<1e-4?'Binding':s.participationFeasible?`Slack ${format(s.participationSlack)}`:`Shortfall ${format(-s.participationSlack)}`,noDeal);
 check('check-regulation','Allowed-return ceiling',s.regulatoryFeasible,noDeal?'No contract':Math.abs(s.regulatorySlack)<1e-4?'Binding':s.regulatoryFeasible?`Slack ${format(s.regulatorySlack)}`:`Excess ${format(-s.regulatorySlack)}`,noDeal);
 check('check-utility','Utility participation',s.profit!==null&&s.profit>=-1e-8,noDeal?'No-build option':!valid?'Unavailable':s.profit<0?'Would walk away':'Profitable',!valid);
 $('insight-text').textContent=insight(s,p);
 $('solver-note').textContent=manual?'Proposed terms · outcomes shown only for feasible offers. Sensitivity charts still re-solve the utility’s game.':`Approximate capacity optimum · 600-point search + refinement. α optimized analytically. ${noDeal?'':s.bindingConstraints?.includes('participation')?'Data-center participation binds.':''}`;
 $('demand-assumption').textContent=(p.spread===0
  ? `Demand is fixed at ${format(p.mean)} capacity units because uncertainty is set to zero.`
  : `With the current settings, demand is equally likely between ${format(p.mean*(1-p.spread))} and ${format(p.mean*(1+p.spread))} capacity units, with an expected level of ${format(p.mean)}. The uncertainty setting controls the width of this range.`)
  + ' The demand plot also shows hypothetical values beyond the assumed range to illustrate how the contract works.';
 renderCapacityChart($('capacity-chart'),capacityCurve(p),s,p);
 const sweepKey=JSON.stringify({...p,gamma:null});if(sweepKey!==sweepCache.key){sweepCache={key:sweepKey,data:recoverySweep(p)};}
 renderRecoveryChart($('recovery-chart'),sweepCache.data,s,p);
 renderDemandChart($('demand-chart'),demandCurve(s.c,s.alpha,p),s,p);
 renderAccountingChart($('accounting-chart'),s,p);
 clearTimeout(announcementTimer);announcementTimer=setTimeout(()=>{$('live-result').textContent=`${$('outcome-status').textContent}. Capacity ${format(s.c)}, utility profit ${format(s.profit)}, ratepayer recovery ${format(s.transfer)}.`;},350);
}
$('export').addEventListener('click',()=>{
 const payload={model:'Regulated-utility compact game (draft §8, eq. 7)',version:'1.0.0',exportedAt:new Date().toISOString(),units:'Normalized capacity and money; all flows per common model period',assumptions:{demand:'Uniform [mean(1-spread),mean(1+spread)]',value:'V(x)=v*x',cost:'C(x)=o*x',capital:'K(c)=k*c+0.5*h*c*c',calibration:'illustrative, not empirically estimated',noDeal:'Utility no-build option 0; data center retains outside option',ties:'Smallest alpha; smaller capacity for positive-profit ties; no build for zero-profit ties'},mode:state.mode,parameters:state.p,selectedOutcome:state.selected,optimalOffer:state.optimum};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='grid-bargain-scenario.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Scenario and results exported.');
});
document.querySelectorAll('.nav-item').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(a=>a.classList.remove('active'));link.classList.add('active');}));
syncControls();render();
// SVG plots use real container widths so their labels retain readable sizes.
// Only width changes trigger a redraw; plot-height changes must not loop.
let lastChartWidths = [];
const chartResizeObserver = new ResizeObserver(entries => {
 const widths = [...document.querySelectorAll('.chart')].map(el => Math.round(el.getBoundingClientRect().width));
 if (widths.some((width, i) => width !== lastChartWidths[i])) {
  const alreadyMeasured = lastChartWidths.length > 0;
  lastChartWidths = widths;
  if (alreadyMeasured) queueRender();
 }
});
document.querySelectorAll('.chart').forEach(el => chartResizeObserver.observe(el));
