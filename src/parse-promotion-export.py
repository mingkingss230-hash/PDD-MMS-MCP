"""Parse original native reports without guessing missing rows or metrics."""
import sys,json,re,warnings
from decimal import Decimal,InvalidOperation
from datetime import date,timedelta
warnings.filterwarnings('ignore',message='Workbook contains no default style')
file,mode,start,end=sys.argv[1:]
if file.endswith('.xlsx'):
 import openpyxl
 w=openpyxl.load_workbook(file,read_only=True,data_only=True);s=w.active;s.reset_dimensions();raw=[list(r) for r in s.values];w.close()
else:
 import xlrd
 w=xlrd.open_workbook(file);s=w.sheet_by_index(0);raw=[s.row_values(i) for i in range(s.nrows)]
headers=[str(x) for x in raw[0]]
if mode.endswith('hourly') and headers[0]!=start: raise ValueError('File date mismatch')
rows=[];total=None;notes=[];keys=set();groups={}
for r in raw[1:]:
 if not r: continue
 label=str(r[0]);item=dict(zip(headers,r))
 if label=='总计':total=item;continue
 if label.startswith('注'):notes.append(label);continue
 if mode.endswith('hourly'):
  m=re.fullmatch(r'(\d{1,2}):00-(\d{1,2}):00',label)
  if not m:raise ValueError('Unknown hour row')
  hour=int(m[1]);assert 0<=hour<24 and int(m[2])==hour+1
  item['hour']=hour;item['date']=start
 else:
  date.fromisoformat(label)
  if not start<=label<=end:raise ValueError('File date out of range')
  item['date']=label
 goods=str(item.get('商品ID','unit'));key=(goods,item.get('date'),item.get('hour'))
 if key in keys:raise ValueError('Duplicate goods/date/hour row')
 keys.add(key);groups.setdefault(goods,set()).add(item.get('hour',item['date']));rows.append(item)
if total is None:raise ValueError('Missing native total')
checks={}
for k in ['成交花费(元)','总花费(元)','交易额(元)','净交易额(元)','成交笔数','净成交笔数','曝光量','点击量']:
 if k not in headers:continue
 try:
  actual=sum((Decimal(str(r[k])) for r in rows),Decimal(0));expected=Decimal(str(total[k]))
  checks[k]={'sum':str(actual),'nativeTotal':str(expected),'matches':abs(actual-expected)<=Decimal('.01')}
 except (InvalidOperation,TypeError):checks[k]={'matches':None,'reason':'platform unavailable/non-numeric; not zero'}
expected_days=(date.fromisoformat(end)-date.fromisoformat(start)).days+1
complete=bool(groups) and all(len(v)==(24 if mode.endswith('hourly') else expected_days) for v in groups.values())
result={'headers':headers,'rows':rows,'nativeTotal':total,'notes':notes,'goodsCount':len(groups) if mode=='shop-hourly' else 1,'validation':{'dateValid':True,'uniqueRows':True,'hoursComplete':complete if mode.endswith('hourly') else None,'daysComplete':complete if mode=='unit-daily' else None,'totals':checks}}
print(json.dumps(result,ensure_ascii=True))
