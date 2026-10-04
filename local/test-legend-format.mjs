import test from 'node:test';
import assert from 'node:assert/strict';
import {legendBlocks,legendHtml,legendNotion} from './legend-format.mjs';

const text='> Материал для собеседования\n\n## Профиль\n\n**Роль:** Программист 1С\n\n## Стек\n\nПлатформа: 1С:Предприятие 8.3\n\n## Кейсы\n\n### Обмен заказами\n\n**Мой вклад:** Настройка обмена.\n\n- Проверка дублей\n- Проверка результата\n\n### Зачем дорабатывали?\n\nНужны дополнительные проверки.';

test('Просмотр легенды сохраняет заголовки, подписи, списки и навигацию',()=>{
 const html=legendHtml(text);
 assert.match(html,/legend-profile-grid/);assert.match(html,/<h3>Обмен заказами<\/h3>/);
 assert.match(html,/<strong>Мой вклад:<\/strong>/);assert.match(html,/<ul><li>Проверка дублей/);
 assert.match(html,/aria-label="Разделы легенды"/);assert.match(html,/legend-callout/);
});
test('Notion получает собственные заголовки и колонки вместо экранированного Markdown',()=>{
 const md=legendNotion(text);
 assert.match(md,/<columns>/);assert.match(md,/<column ratio="50">/);
 assert.match(md,/## Профиль \{color="blue"\}/);assert.match(md,/## Стек \{color="purple"\}/);
 assert.match(md,/### Обмен заказами/);assert.match(md,/\*\*Мой вклад:\*\*/);
 assert.match(md,/<callout color="blue_bg">/);assert.doesNotMatch(md,/\\\*\\\*/);
});
test('Старые заголовки и вопросы оформляются без перегенерации и изменения источника',()=>{
 const old='1. РАССКАЗ О СЕБЕ\n\nРаботал над обменом.\n\n2. ФАКАПЫ\n\nФакап 1: проверка дублей\n\nСреда: тестовая база\n\nПочему понадобилась доработка?\n\nОбъяснение.';
 const blocks=legendBlocks(old);
 assert.equal(blocks[0].type,'heading');assert.equal(blocks[0].level,2);
 assert.match(legendHtml(old),/<h3>Факап 1: проверка дублей<\/h3>/);
 assert.match(legendNotion(old),/\*\*Среда:\*\* тестовая база/);
 assert.ok(old.startsWith('1. РАССКАЗ О СЕБЕ'));
});
test('Вставленный HTML и команды Notion остаются буквальным текстом',()=>{
 const raw='## Кейсы\n\n<script>alert(1)</script>\n\n**<page url="bad">:** текст\n\n<synced_block url="bad"/>';
 const html=legendHtml(raw),md=legendNotion(raw);
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(md,/(?<!\\)<(?:page|synced_block)/);assert.match(md,/\\<page/);
});
test('Код, обычные абзацы и нумерованные шаги сохраняют содержание',()=>{
 const raw='## Кейс\n\nПроверка `value < 0`\n\n1. Проверить данные\n2. Повторить обмен\n\nПервый абзац.\n\nВторой абзац.';
 assert.match(legendHtml(raw),/<code>value &lt; 0<\/code>/);
 assert.match(legendHtml(raw),/<ol><li>Проверить данные/);
 assert.match(legendNotion(raw),/`value < 0`/);
 assert.match(legendHtml(raw),/<p>Первый абзац\.<\/p><p>Второй абзац\.<\/p>/);
});
test('Длинный кейс прежней легенды разделяется на название и абзацы без новой фактуры',()=>{
 const body='Обмен заказами. '+Array.from({length:9},(_,i)=>`Проверка ${i+1} подтверждала результат обработки заказа в обеих системах.`).join(' ');
 const blocks=legendBlocks('Опорные кейсы\n\n1. '+body);
 assert.equal(blocks[1].text,'1. Обмен заказами.');
 assert.equal(blocks[2].text,body.slice('Обмен заказами. '.length));
 const html=legendHtml('Опорные кейсы\n\n1. '+body);
 assert.ok((html.match(/<p>/g)||[]).length>1);
 const plain=html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
 for(let i=1;i<=9;i++)assert.ok(plain.includes(`Проверка ${i} подтверждала результат`));
});
test('Старые рассказы о работах и вопросы с ответом в одной строке получают отдельные заголовки',()=>{
 const raw='Последнее место работы - Компания\n\nОписание.\n\nВопросы и опорные ответы\n\n1. Как проверяли результат? Сравнивали строки заказа.\n2. Что делали лично? Настраивал сторону 1С.';
 const html=legendHtml(raw),md=legendNotion(raw);
 assert.match(html,/<h2>Последнее место работы - Компания<\/h2>/);
 assert.match(md,/## Вопросы и опорные ответы/);
 assert.match(md,/### 1\. Как проверяли результат\?\n\nСравнивали строки заказа\./);
 assert.match(md,/### 2\. Что делали лично\?\n\nНастраивал сторону 1С\./);
});
