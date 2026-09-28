const text=value=>typeof value==='string'&&value.trim().length>0;

export function hasCandidateData(student){
 return Boolean(student&&(text(student.name)||text(student.telegram)||text(student.resume)||text(student.project)||text(student.tasks)||text(student.complex)||(student.jobs||[]).some(job=>job&&Object.values(job).some(text))));
}

export function studentsMissingResume(students){
 return (students||[]).filter(student=>hasCandidateData(student)&&!text(student.result?.resume_text));
}

export function notionEntryPreventsDuplicate(entry){
 return Boolean(entry&&(entry.pageId||['done','creating','uncertain','updating','update_error'].includes(entry.status)));
}

export function studentsPendingNotion(students,entries={}){
 return (students||[]).filter(student=>text(student.result?.resume_text)&&!notionEntryPreventsDuplicate(entries[student.id]));
}
