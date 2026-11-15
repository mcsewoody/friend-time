"""Download only official public calendar datasets; curl validates TLS using host trust."""
import csv,datetime,html,io,json,re,subprocess,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def fetch(url):
 return subprocess.check_output(['curl','--fail','--silent','--show-error','--location','--retry','2','--max-time','60',urllib.parse.quote(url,safe=':/?=&%')])
def rows(raw):
 try:s=raw.decode('utf-8-sig')
 except UnicodeDecodeError:s=raw.decode('cp950')
 return list(csv.DictReader(io.StringIO(s)))
page=fetch('https://data.gov.tw/dataset/14718').decode()
links=list(dict.fromkeys(html.unescape(u) for u in re.findall(r'https[^\s<>"\\]+',page) if '.csv' in u and '&amp;' not in u))
official={};sources={}
for year in range(2023,datetime.date.today().year+3):
 choices=[u for u in links if urllib.parse.parse_qs(urllib.parse.urlsplit(u).query).get('name',[''])[0].startswith(str(year-1911)) and 'Google' not in urllib.parse.unquote(u)]
 if not choices:continue
 url=choices[-1];data=rows(fetch(url));parsed={}
 for r in data:
  key=r.get('西元日期','').strip()
  if not re.fullmatch(r'\d{8}',key):continue
  date=datetime.datetime.strptime(key,'%Y%m%d').date()
  if date.year!=year:continue
  flag=r['是否放假'].strip();assert flag in ['0','2']
  parsed[date.isoformat()]={'isHoliday':flag=='2','note':r.get('備註','').strip()}
 assert len(parsed)==(datetime.date(year+1,1,1)-datetime.date(year,1,1)).days
 official.update(parsed);sources[str(year)]=url
public='https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/'
lunar_url=public+'A-A0087-001?Authorization=rdec-key-123-45678-011121314&format=CSV'
term_url=public+'A-A0087-003?Authorization=rdec-key-123-45678-011121314&format=CSV'
lunar={r['日期']:r for r in rows(fetch(lunar_url)) if re.fullmatch(r'\d{4}-\d{2}-\d{2}',r.get('日期',''))}
terms={r['日期']:r for r in rows(fetch(term_url)) if re.fullmatch(r'\d{4}-\d{2}-\d{2}',r.get('日期',''))}
payload={'checkedAt':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds'),'official':official,'sources':sources,'lunar':lunar,'terms':terms,'lunarSource':lunar_url,'termSource':term_url}
out=ROOT/'.qa'/'official-calendar.json';out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(payload,ensure_ascii=False))
print(f'DGPA years {list(sources)}; CWA lunar {min(lunar)} to {max(lunar)}; terms {min(terms)} to {max(terms)}')
