export const plan={
 profile:'Интеграции и отчётность',
 employers:[{id:'e1',company:'Компания А',role:'Программист 1С',period:'2023 - настоящее время',context:'Торговля, УТ 11.5',team_process:'Разработчик и аналитик',scale:'Регулярные обмены',stack:'УТ 11.5, СКД'}],
 cases:Array.from({length:3},(_,i)=>({id:'c'+i,employer_id:'e1',title:'Кейс '+i,problem:'Ручной процесс',standard_gap:'Дополнительные проверки клиента',own_contribution:'Доработал проверку',solution:'Расширение',data_example:'Документ - проверка - результат',verification:'Проверка на копии базы',result:'Меньше ручной работы',limits:'Проверять повторную загрузку'})),
 failures:Array.from({length:2},(_,i)=>({case_id:'c'+i,environment:'test',context:'Тестовая база',mistake:'Пропустил проверку',detection:'Нашли на тесте',test_consequences:'Некорректные тестовые записи',fix:'Исправил проверку',verification:'Повторный тест',prevention:'Добавил сценарий проверки'})),
 questions:[],proposals:['Предложенный тестовый сценарий: две ошибки при проверке до релиза']
};
export const result={legend_text:'Рассказ о себе\nПрограммист 1С\nФакапы только на тестовой базе',summary:'Черновик',checks:[],questions:[],changes:plan.proposals,case_plan:plan};
export const student={id:'test',jobs:[],result:{resume_text:'Компания А\nПрограммист 1С\n2023 - настоящее время\nУТ 11.5',summary:'Резюме',checks:[],questions:[],changes:[]},legend:result,fillMetrics:false};
