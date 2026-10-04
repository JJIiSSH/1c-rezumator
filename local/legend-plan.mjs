const employerFields=['id','company','role','period','context','team_process','scale','stack'];
const caseFields=['id','employer_id','title','problem','standard_gap','own_contribution','solution','data_example','verification','result','limits'];
const failureFields=['case_id','environment','context','mistake','detection','test_consequences','fix','verification','prevention'];
function strings(value,keys){return value&&keys.every(k=>typeof value[k]==='string'&&value[k].length<=6000);}
function list(value,min,max){return Array.isArray(value)&&value.length>=min&&value.length<=max;}

export function validateLegendPlan(plan){
 if(!strings(plan,['profile'])||!list(plan.employers,1,2)||!plan.employers.every(e=>strings(e,employerFields)&&e.id&&e.company)||!list(plan.cases,3,4)||!plan.cases.every(c=>strings(c,caseFields)&&c.id)||!list(plan.failures,2,3)||!plan.failures.every(f=>strings(f,failureFields))||!list(plan.questions,0,5)||!list(plan.proposals,0,60)||![...plan.questions,...plan.proposals].every(x=>typeof x==='string'&&x.length<=6000)||JSON.stringify(plan).length>80000)throw Error('Модель вернула неполные карточки легенды. Повторите генерацию.');
 const employers=new Set(plan.employers.map(e=>e.id)),cases=new Set(plan.cases.map(c=>c.id));
 if(employers.size!==plan.employers.length||cases.size!==plan.cases.length||plan.cases.some(c=>!employers.has(c.employer_id))||plan.failures.some(f=>!cases.has(f.case_id)))throw Error('В карточках легенды нарушена связь кейсов с работодателями.');
 if(plan.failures.some(f=>!['test','local_copy','preprod'].includes(f.environment)))throw Error('Факапы легенды допускаются только в тестовых средах.');
 return plan;
}
export function parseLegendPlan(text){return validateLegendPlan(JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));}
