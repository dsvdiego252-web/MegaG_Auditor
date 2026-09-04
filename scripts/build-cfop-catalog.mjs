// Regenerate from the public CONFAZ consolidation; never scrape authenticated data.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source='https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cfop_cvsn_1-6.24';
const html=await readFile(process.argv[2]||'.data/cfop-source/official.html','utf8');
const checkedAt=process.argv[3]||new Date().toISOString().slice(0,10);
const clean=s=>s.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/\s+/g,' ').trim();
const paragraphs=[...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)].map(m=>({attrs:m[1],text:clean(m[2])}));
const records=[],headers=[];let current=null,officialGroup='',amendment=null;
for(const p of paragraphs){
 if(p.text.startsWith('Nova redação dada ao CFOP 7.667'))amendment={start:'2026-02-01',end:null,reference:'Ajuste SINIEF 39/25'};
 if(p.text.startsWith('Redação anterior dada ao CFOP 7.667'))amendment={start:'2024-06-01',end:'2026-01-31',reference:'Ajuste SINIEF 03/24'};
 const match=/^([123567])\.(\d{3})\s*[-–]\s*(.+)$/.exec(p.text);
 if(match){
  const cfop=match[1]+match[2],description=match[3];
  if(description===description.toUpperCase()){headers.push({cfop,description});officialGroup=description;current=null;continue;}
  const validity=cfop==='7667'?amendment:{start:'2024-06-01',end:null,reference:'Ajuste SINIEF 03/24'};
  if(!validity)throw Error('Vigência não identificada para '+cfop);
  if(/RedacaoAnt/.test(p.attrs)&&cfop!=='7667')throw Error('Redação histórica inesperada: '+cfop);
  current={cfop,description,notes:[],officialGroup,...validity};records.push(current);continue;
 }
 if(current&&p.text.startsWith('Classificam-se')||current&&/^(Também|Quando |Neste )/.test(p.text))current.notes.push(p.text);
}
if(records.length<500||records.length>800)throw Error('Quantidade inesperada de códigos: '+records.length);
const keys=records.map(r=>r.cfop+':'+r.start);if(new Set(keys).size!==keys.length)throw Error('Código/vigência duplicado.');
const duplicates=records.filter((r,i)=>records.some((s,j)=>j!==i&&s.cfop===r.cfop));
if(duplicates.some(r=>r.cfop!=='7667'))throw Error('Nova alteração de vigência exige revisão do extrator.');
const metadata={source,checkedAt,sourceHash:createHash('sha256').update(html).digest('hex'),version:checkedAt+'-confaz-03-24-39-25',legalReference:'Convênio s/nº de 15/12/1970, Anexo II; Ajustes SINIEF 03/24 e 39/25',coverageStart:'2024-06-01',records:records.length,officialHeaders:headers.length};
await writeFile('lib/data/cfop-official.json',JSON.stringify({metadata,records},null,2)+'\n');
console.log(JSON.stringify({...metadata,codes:new Set(records.map(r=>r.cfop)).size,byPrefix:Object.fromEntries(['1','2','3','5','6','7'].map(p=>[p,new Set(records.filter(r=>r.cfop.startsWith(p)).map(r=>r.cfop)).size]))},null,2));
