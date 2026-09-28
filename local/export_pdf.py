"""Local PDF export using an hh.ru-style resume layout; no model calls."""
import io
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Indenter, Flowable


def register_fonts():
    bundled = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/fonts'
    for regular, bold in [
        (Path(__file__).parent/'fonts/DejaVuSans.ttf', Path(__file__).parent/'fonts/DejaVuSans-Bold.ttf'),
        (Path('/System/Library/Fonts/Supplemental/Arial.ttf'), Path('/System/Library/Fonts/Supplemental/Arial Bold.ttf')),
        (bundled/'Ubuntu-R.ttf', bundled/'Ubuntu-B.ttf'),
        (Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')),
    ]:
        if regular.is_file() and bold.is_file():
            pdfmetrics.registerFont(TTFont('Resume', str(regular)))
            pdfmetrics.registerFont(TTFont('ResumeBold', str(bold)))
            pdfmetrics.registerFontFamily('Resume', normal='Resume', bold='ResumeBold', italic='Resume', boldItalic='ResumeBold')
            return
    raise RuntimeError('Не найден шрифт с поддержкой кириллицы для PDF')


def clean_line(line):
    line = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', line).strip()
    line = re.sub(r'^#{1,6}\s+', '', line).replace('**', '')
    return re.sub(r'[\u2011-\u2015]', '-', line)


ALIASES = {
    'желаемая должность и зарплата': 'desired', 'желаемая должность': 'desired',
    'профессиональный профиль': 'about', 'профиль': 'about', 'о себе': 'about', 'обо мне': 'about',
    'опыт работы': 'experience', 'профессиональный опыт': 'experience',
    'образование': 'education', 'навыки': 'skills', 'ключевые навыки': 'skills',
    'профессиональные навыки': 'skills', 'дополнительная информация': 'about',
    'проекты': 'projects', 'дополнительные проекты': 'projects', 'сертификаты': 'certificates',
    'курсы': 'courses', 'опыт вождения': 'driving', 'знание языков': 'languages', 'контакты': 'contacts',
}
MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь']
DATE_LINE = re.compile(r'^(?:(?:'+ '|'.join(MONTHS) +r')\s+\d{4}|\d{4}[-.]\d{2}|\d{4})\s*-\s*(?:настоящее|по настоящее|н\.\s*в\.|(?:'+ '|'.join(MONTHS) +r')\s+\d{4}|\d{4}[-.]\d{2}|\d{4})', re.I)
ROLE = re.compile(r'программист|разработчик|инженер|аналитик|консультант|руководитель|архитектор|developer', re.I)


def split_sections(text):
    sections = {'header': []}
    current = 'header'
    for raw in text.splitlines():
        line = clean_line(raw)
        key = line.rstrip(':').lower()
        section = ALIASES.get(key)
        if key.startswith('опыт работы -') or re.match(r'^опыт работы\s*:?\s+\d+\s+(?:год|года|лет|месяц)', key):
            section = 'experience'
        if section:
            current = section
            sections.setdefault(section, [])
        elif line:
            sections.setdefault(current, []).append(line)
    return sections


def jobs_from_lines(lines):
    starts=[]
    for i,line in enumerate(lines):
        if DATE_LINE.match(line):
            # Both old Markdown output and the current plain-text contract put
            # company and role before the date. Also accept role after date.
            header_count = 2 if i>=2 and ROLE.search(lines[i-1]) else 1
            start=max(0,i-header_count)
            if starts and start<=starts[-1][1]:
                continue
            starts.append((start,i))
    if not starts:
        return [],lines
    jobs=[]
    for n,(start,date_index) in enumerate(starts):
        end=starts[n+1][0] if n+1<len(starts) else len(lines)
        header=lines[start:date_index]
        body=lines[date_index+1:end]
        role=header[-1] if len(header)>1 else ''
        if not role and body and ROLE.search(body[0]) and not body[0].startswith('- '):
            role=body.pop(0)
        jobs.append({'company':header[0] if header else '', 'role':role,'period':lines[date_index], 'body':body})
    return jobs,lines[:starts[0][0]]


def month_index(part):
    part=part.strip().lower()
    m=re.fullmatch(r'(\d{4})[-.](\d{2})',part)
    if m and 1<=int(m[2])<=12:
        return int(m[1])*12+int(m[2])-1
    m=re.fullmatch(r'([а-яё]+)\s+(\d{4})',part)
    if m and m[1] in MONTHS:
        return int(m[2])*12+MONTHS.index(m[1])
    return None


def interval(period, today):
    parts=re.split(r'\s+-\s+',period, maxsplit=1)
    if len(parts)!=2:
        return None
    start=month_index(parts[0])
    end=today.year*12+today.month-1 if re.search(r'настоящее|н\.\s*в\.',parts[1],re.I) else month_index(parts[1])
    if start is None or end is None or start>end:
        return None
    return start,end+1


def plural(n,forms):
    return forms[2] if 11<=n%100<=14 else forms[0] if n%10==1 else forms[1] if 2<=n%10<=4 else forms[2]


def duration(months):
    years,rest=divmod(months,12)
    values=[]
    if years: values.append(f'{years} '+plural(years,('год','года','лет')))
    if rest: values.append(f'{rest} '+plural(rest,('месяц','месяца','месяцев')))
    return ' '.join(values)


def total_duration(jobs,today):
    ranges=[interval(j['period'],today) for j in jobs]
    if not ranges or any(r is None for r in ranges):
        return ''
    merged=[]
    for start,end in sorted(ranges):
        if merged and start<=merged[-1][1]: merged[-1][1]=max(end,merged[-1][1])
        else: merged.append([start,end])
    return duration(sum(end-start for start,end in merged))


class SectionHeading(Flowable):
    def __init__(self,text):
        super().__init__();self.text=text;self.keepWithNext=True
    def wrap(self,width,height):
        self.width=width;self.height=31;return width,31
    def draw(self):
        c=self.canv;c.setFont('Resume',12);c.setFillColor(colors.HexColor('#aaaaaa'))
        c.drawString(0,9,self.text);c.setStrokeColor(colors.HexColor('#cccccc'));c.setLineWidth(.45);c.line(0,5,self.width,5)


class SkillTags(Flowable):
    def __init__(self,items):
        super().__init__();self.items=items
    def wrap(self,width,height):
        self.width=width;self.rows=[];row=[];x=0
        for item in self.items:
            # Long labels wrap as plain text lines within the available width.
            words=item.split();parts=[];part=''
            for word in words:
                trial=(part+' '+word).strip()
                if pdfmetrics.stringWidth(trial,'Resume',10)+7>width and part:
                    parts.append(part);part=word
                else: part=trial
            if part: parts.append(part)
            for part in parts:
                w=min(width,pdfmetrics.stringWidth(part,'Resume',10)+7)
                if row and x+w>width: self.rows.append(row);row=[];x=0
                row.append((x,w,part));x+=w+7
        if row:self.rows.append(row)
        self.height=len(self.rows)*19
        return width,self.height
    def split(self,width,height):
        self.wrap(width,height);count=int(height//19)
        if count<=0:return []
        if count>=len(self.rows):return [self]
        return [SkillTags([v[2] for row in self.rows[:count] for v in row]),SkillTags([v[2] for row in self.rows[count:] for v in row])]
    def draw(self):
        c=self.canv;c.setFont('Resume',10)
        for n,row in enumerate(self.rows):
            y=self.height-(n+1)*19+3
            for x,w,label in row:
                c.setFillColor(colors.HexColor('#e5e5e5'));c.rect(x,y,w,14,fill=1,stroke=0)
                c.setFillColor(colors.black);c.drawString(x+3,y+3,label)


def render(text, candidate=None, updated_at=None):
    register_fonts();candidate=candidate or {}
    try: today=date.fromisoformat((updated_at or '')[:10])
    except ValueError: today=date.today()
    sections=split_sections(text);jobs,extra_experience=jobs_from_lines(sections.get('experience',[]))
    width=A4[0]-84;left=85;right=width-left
    body=ParagraphStyle('Body',fontName='Resume',fontSize=10.5,leading=13.5,spaceAfter=5,allowWidows=0,allowOrphans=0,splitLongWords=True)
    name_style=ParagraphStyle('Name',parent=body,fontName='ResumeBold',fontSize=24,leading=28,spaceAfter=7,keepWithNext=True)
    bold=ParagraphStyle('Bold',parent=body,fontName='ResumeBold',fontSize=12,leading=16,spaceAfter=3,keepWithNext=True)
    small=ParagraphStyle('Small',parent=body,fontSize=9,leading=11,textColor=colors.HexColor('#777777'))
    role_style=ParagraphStyle('Role',parent=body,fontSize=12,leading=16,spaceAfter=7)
    def para(value,style=body): return Paragraph(escape(value),style)
    def row(label,content):
        t=Table([[para(label,small) if isinstance(label,str) else label,content]],colWidths=[left,right],hAlign='LEFT')
        t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(0,-1),10),('RIGHTPADDING',(1,0),(1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]))
        return t
    story=[]
    header=list(sections.get('header',[]))+sections.get('contacts',[])
    desired=sections.get('desired',[])
    title=desired[0] if desired else candidate.get('title','')
    if not title:
        title=next((line for line in header if ROLE.search(line)), 'Программист 1С')
    name=candidate.get('name','').strip()
    if header and header[0]!=title and not ROLE.search(header[0]) and not re.search(r'[@:+/\d]',header[0]) and len(header[0].split()) in (2,3,4):
        name=header[0]
    header=[line for line in header if line not in (name,title)]
    if not candidate.get('showAge',False):
        header=[line for line in header if not re.search(r'\b\d{1,2}\s+(?:лет|года?|год)\b.*родил|^(?:Мужчина|Женщина),',line,re.I)]
    elif candidate.get('age') and not any(re.search(r'\b\d{1,2}\s+(?:лет|года?|год)\b',line) for line in header):
        age=str(candidate['age']);header.insert(0,age+' '+(plural(int(age),('год','года','лет')) if age.isdigit() else 'лет'))
    for key,prefix in [('telegram','Telegram: '),('github','GitHub: ')]:
        value=str(candidate.get(key,'')).strip()
        if value and (key!='github' or candidate.get('showGithub',True)) and not any(value in line for line in header): header.append(prefix+value)
    if not any('Москва' in line or 'Проживает:' in line for line in header):header.append('Проживает: Москва')
    header=['Проживает: Москва' if line=='Москва' else line for line in header]
    story.append(Indenter(left))
    if name: story.append(para(name,name_style))
    for line in header:story.append(para(line))
    story.extend([Indenter(-left),Spacer(1,12),SectionHeading('Желаемая должность и зарплата'),para(title,bold)])
    details=list(desired[1:])
    if not any(re.match(r'^специализаци[яи](?:\s*:|$)',line,re.I) for line in details):
        details=['Специализации:','- Программист, разработчик']+details
    for line in details: story.append(para(line))
    if sections.get('experience'):
        total=total_duration(jobs,today)
        story.append(SectionHeading('Опыт работы'+(' - '+total if total else '')))
        for line in extra_experience:story.append(para(line))
        for job in jobs:
            bounds=interval(job['period'],today)
            label=job['period'].replace(' - ',' -\n',1)
            if bounds: label+='\n'+duration(bounds[1]-bounds[0])
            left_text=Paragraph(escape(label).replace('\n','<br/>'),small)
            content=[para(job['company'],bold)]
            if job['role']:content.append(para(job['role'],role_style))
            if job['body']:content.append(para(job['body'][0]))
            t=row(left_text,content)
            story.append(t);story.append(Indenter(left))
            for line in job['body'][1:]:story.append(para(line))
            story.extend([Indenter(-left),Spacer(1,13)])
    if sections.get('education'):
        story.append(SectionHeading('Образование'))
        lines=sections['education'];i=0
        while i<len(lines):
            m=re.match(r'^(\d{4})(?:\s+|$)(.*)',lines[i])
            if m:
                label=m[1];content=[]
                if m[2]:content.append(para(m[2],bold))
                elif i+1<len(lines):i+=1;content.append(para(lines[i],bold))
                t=row(label,content);t.keepWithNext=i+1<len(lines);story.append(t)
            else:
                story.extend([Indenter(left),para(lines[i]),Indenter(-left)])
            i+=1
    if sections.get('skills') or sections.get('languages'):
        story.append(SectionHeading('Навыки'))
        if sections.get('languages'):
            story.append(row('Знание языков',[para(line) for line in sections['languages']]))
        if sections.get('skills'):
            items=[]
            for line in sections['skills']:
                items.extend(x.strip(' -') for x in re.split(r'[;,]',line) if x.strip(' -'))
            # Each tag row can flow onto a new page without a giant table cell.
            tags=SkillTags(items);tags.wrap(right,1000)
            first=[v[2] for v in tags.rows[0]] if tags.rows else []
            rest=[v[2] for tagrow in tags.rows[1:] for v in tagrow]
            story.append(row('Навыки',[SkillTags(first)]))
            if rest:story.extend([Indenter(left),SkillTags(rest),Indenter(-left)])
    for key,label in [('projects','Проекты'),('certificates','Сертификаты'),('courses','Повышение квалификации, курсы'),('driving','Опыт вождения'),('about','Дополнительная информация')]:
        if sections.get(key):
            story.append(SectionHeading(label))
            lines=sections[key]
            story.append(row('Обо мне' if key=='about' else '',[para(lines[0])]))
            story.append(Indenter(left))
            for line in lines[1:]:story.append(para(line))
            story.append(Indenter(-left))
    output=io.BytesIO()
    doc=SimpleDocTemplate(output,pagesize=A4,leftMargin=42,rightMargin=42,topMargin=60,bottomMargin=35,title=(name+' - ' if name else '')+'Резюме',author=name)
    def page(canvas,document):
        canvas.saveState()
        if document.page==1:
            canvas.setFillColor(colors.HexColor('#ededed'));canvas.rect(0,A4[1]-39,A4[0],39,fill=1,stroke=0)
        canvas.setFont('Resume',8);canvas.setFillColor(colors.HexColor('#b4b4b4'))
        footer=(name+' | ' if name else '')+'Резюме обновлено '+today.strftime('%d.%m.%Y')
        canvas.drawString(42,18,footer);canvas.drawRightString(A4[0]-42,18,str(document.page));canvas.restoreState()
    doc.build(story,onFirstPage=page,onLaterPages=page)
    return output.getvalue()


if __name__=='__main__':
    data=json.load(sys.stdin)
    sys.stdout.buffer.write(render(data['resume_text'],data.get('candidate'),data.get('updated_at')))
