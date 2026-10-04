import {assertReadyLegend} from './legend-content.mjs';
import {buildPrompt,buildLegendPlanPrompt,buildLegendReviewPrompt,parseResult,parseLegendResult} from './engine.mjs';
import {parseLegendPlan} from './legend-plan.mjs';
import {finalizeResumeChronology} from './resume-chronology.mjs';

export async function produceMaterial({student,rules,kind,run,onStage=()=>{},isCancelled=()=>false}){
 const ensureRunning=()=>{if(isCancelled())throw Error('Генерация остановлена');};
 if(kind!=='legend'){
  ensureRunning();const response=await run('resume',buildPrompt(student,rules));ensureRunning();
  return {...finalizeResumeChronology(parseResult(response.text),student),...(response.usage?{usage:response.usage}:{})};
 }
 ensureRunning();onStage(1,'Этап 1/2: собираем профиль и карточки кейсов…');
 const draft=await run('legend-plan',buildLegendPlanPrompt(student,rules));ensureRunning();
 const plan=parseLegendPlan(draft.text);
 onStage(2,'Этап 2/2: проверяем кейсы и пишем рассказ…');
 const reviewed=await run('legend',buildLegendReviewPrompt(student,rules,plan));ensureRunning();
 const result=parseLegendResult(reviewed.text);
 assertReadyLegend(result.legend_text);
 if(!result.case_plan)throw Error('Модель не вернула проверенные карточки легенды. Повторите генерацию.');
 return {...result,generation_passes:2,...(draft.usage||reviewed.usage?{usage:{passes:[{stage:'plan',usage:draft.usage||null},{stage:'review',usage:reviewed.usage||null}]}}:{})};
}
