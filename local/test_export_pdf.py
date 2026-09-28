import io
import unittest
from datetime import date
import pdfplumber
from export_pdf import render, split_sections, jobs_from_lines, total_duration

class ExportPDFTests(unittest.TestCase):
    def test_intersections(self):
        jobs=[{'period':'Январь 2023 - Июнь 2023'},{'period':'Март 2023 - Декабрь 2023'}]
        self.assertEqual(total_duration(jobs,date(2026,9,11)),'1 год')

    def test_edited_content(self):
        text='Опыт работы\nИзменённая компания\nПрограммист 1С\nЯнварь 2023 - настоящее время\n- Ручная правка: с 25 до 10 минут.\nНавыки\nУТ 11.5; СКД'
        jobs,extra=jobs_from_lines(split_sections(text)['experience'])
        self.assertEqual(jobs[0]['company'],'Изменённая компания')
        self.assertIn('25 до 10',jobs[0]['body'][0])
        self.assertEqual(extra,[])

    def test_long_pdf(self):
        text='Желаемая должность и зарплата\nПрограммист 1С\nОпыт работы\nКомпания\nПрограммист 1С\nЯнварь 2023 - настоящее время\n'+('\n'.join(f'- Задача {i}: доработка резервирования товаров и складских операций.' for i in range(80)))+'\nНавыки\nСКД; УТ 11.5\nДополнительная информация\nОбо мне\nФИНАЛЬНАЯ СТРОКА <тест> & проверка'
        data=render(text,{'name':'Тестовый Иван','telegram':'@test','showAge':False,'age':'99'},'2026-09-11')
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            content='\n'.join(p.extract_text() or '' for p in pdf.pages)
            self.assertGreater(len(pdf.pages),1)
            for token in ('Тестовый Иван','Задача 79','ФИНАЛЬНАЯ СТРОКА <тест> & проверка','@test','3 года 9 месяцев'):
                self.assertIn(token,content)
            self.assertNotIn('99 лет',content)
            first=pdf.pages[0].extract_words()
            company=next(w for w in first if w['text']=='Компания')
            month=next(w for w in first if w['text']=='Январь')
            self.assertGreater(company['x0']-month['x0'],60)
            for p in pdf.pages:
                if 'Дополнительная информация' in (p.extract_text() or ''):
                    self.assertIn('ФИНАЛЬНАЯ',p.extract_text())

if __name__=='__main__':unittest.main()
