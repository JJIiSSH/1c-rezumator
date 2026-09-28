"""One portable executable for local PDF import and export."""
import json
import sys
import pdfplumber
from export_pdf import render

if __name__ == '__main__':
    if sys.argv[1:] == ['export']:
        data = json.load(sys.stdin)
        sys.stdout.buffer.write(render(data['resume_text'], data.get('candidate'), data.get('updated_at')))
    elif len(sys.argv) == 3 and sys.argv[1] == 'extract':
        with pdfplumber.open(sys.argv[2]) as pdf:
            if len(pdf.pages) > 80:
                raise ValueError('Максимум 80 страниц')
            text = '\n\n'.join(page.extract_text() or '' for page in pdf.pages)
            print(json.dumps({'text': text[:120000], 'pages': len(pdf.pages)}, ensure_ascii=False))
    else:
        raise SystemExit('Usage: rezumator-pdf export | extract FILE')
