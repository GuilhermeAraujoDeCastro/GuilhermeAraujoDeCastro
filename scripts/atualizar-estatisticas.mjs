import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const DAY=86_400_000;
const COLORS={bg:'#0D1117',border:'#1E3A8A',title:'#3B82F6',accent:'#00E5FF',text:'#C9D1D9'};
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const integer=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw new Error('Valor inválido em '+label);return value;};
const number=value=>integer(value,'estatística').toLocaleString('pt-BR');
const millis=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Data inválida no calendário');return Date.parse(date+'T00:00:00Z');};
const shift=(date,days)=>new Date(millis(date)+days*DAY).toISOString().slice(0,10);
const pretty=date=>date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);

export function profileDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return values.year+'-'+values.month+'-'+values.day;
}
function loginValue(login){if(!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login))throw new Error('Login GitHub inválido');return login;}
function attributes(source){return Object.fromEntries([...source.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match=>[match[1],match[2]??match[3]]));}

export function parseCalendarHtml(html){
  const tips=new Map([...html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)].map(match=>[attributes(match[1]).for,match[2].replace(/<[^>]+>/g,'').trim()]));
  const days=[];
  for(const match of html.matchAll(/<td\b([^>]*)>/gi)){
    const attrs=attributes(match[1]);
    if(!attrs['data-date']||!attrs.class?.split(/\s+/).includes('ContributionCalendar-day'))continue;
    let count;
    if(/^\d+$/.test(attrs['data-count']??''))count=Number(attrs['data-count']);
    else {
      const text=tips.get(attrs.id)??'';
      if(/^No contributions on /i.test(text))count=0;
      else {
        const value=text.match(/^((?:\d+)|(?:[1-9]\d{0,2}(?:,\d{3})+)) contributions? on /i);
        if(!value)throw new Error('Não foi possível ler a contagem do calendário público');
        count=Number(value[1].replaceAll(',',''));
      }
    }
    days.push({date:attrs['data-date'],contributionCount:count});
  }
  if(!days.length)throw new Error('Calendário público ausente na resposta do GitHub');
  return days;
}

export function calendarWindow(days,asOf,count=365){
  millis(asOf);
  const map=new Map();
  for(const day of days){
    millis(day.date);integer(day.contributionCount,'contribuições');
    if(map.has(day.date)&&map.get(day.date)!==day.contributionCount)throw new Error('Contagens conflitantes para a mesma data');
    map.set(day.date,day.contributionCount);
  }
  return Array.from({length:count},(_,index)=>{
    const date=shift(asOf,index-count+1);
    if(!map.has(date))throw new Error('Calendário incompleto: '+date);
    return {date,count:map.get(date)};
  });
}

async function request(url,{token,fetchImpl=fetch,method='GET',body,html=false}={}){
  const headers={'User-Agent':'GitHub-Profile-Analytics','Accept':html?'text/html':'application/vnd.github+json','Accept-Language':'en-US,en;q=0.9'};
  if(new URL(url).hostname==='api.github.com'&&token)headers.Authorization='Bearer '+token;
  if(body)headers['Content-Type']='application/json';
  const response=await fetchImpl(url,{method,headers,body,signal:AbortSignal.timeout(25_000),redirect:'error'});
  if(!response.ok)throw new Error('Consulta pública do GitHub falhou: HTTP '+response.status);
  return html?response.text():response.json();
}

export async function loadPublicData({login,asOf,now=new Date(),token,fetchImpl=fetch,sourceDir}={}){
  loginValue(login);
  if(sourceDir){
    const [user,repositories,html]=await Promise.all(['usuario.json','repositorios.json','contribuicoes.html'].map(name=>readFile(resolve(sourceDir,name),'utf8')));
    return {user:JSON.parse(user),repositories:JSON.parse(repositories),days:parseCalendarHtml(html)};
  }
  const options={token,fetchImpl};
  const user=await request('https://api.github.com/users/'+login,options);
  integer(user.public_repos,'repositórios públicos');
  if(user.public_repos>10_000)throw new Error('Quantidade de repositórios acima do limite desta rotina');
  const repositories=[];
  for(let page=1;page<=Math.max(1,Math.ceil(user.public_repos/100));page++){
    const result=await request('https://api.github.com/users/'+login+'/repos?type=owner&per_page=100&sort=full_name&page='+page,options);
    if(!Array.isArray(result))throw new Error('Lista de repositórios inválida');
    repositories.push(...result);
  }
  let days;
  if(token){
    try{
      const result=await request('https://api.github.com/graphql',{...options,method:'POST',body:JSON.stringify({
        query:'query($login: String!, $from: DateTime!, $to: DateTime!) { user(login: $login) { contributionsCollection(from: $from, to: $to) { contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }',
        variables:{login,from:shift(asOf,-364)+'T00:00:00Z',to:now.toISOString()},
      })});
      if(result.errors?.length||!result.data?.user)throw new Error('Consulta GraphQL indisponível');
      days=result.data.user.contributionsCollection.contributionCalendar.weeks.flatMap(week=>week.contributionDays);
      calendarWindow(days,asOf);
    }catch{
      console.warn('Consulta GraphQL indisponível; consultando o calendário público.');
      days=undefined;
    }
  }
  if(!days){
    const html=await request('https://github.com/users/'+login+'/contributions',{fetchImpl,html:true});
    days=parseCalendarHtml(html);
  }
  return {user,repositories,days};
}

export function publicMetrics(data,login,asOf){
  loginValue(login);
  if(data.user?.login?.toLowerCase()!==login.toLowerCase())throw new Error('Usuário retornado difere do perfil');
  const expected=integer(data.user.public_repos,'repositórios públicos');
  const followers=integer(data.user.followers,'seguidores');
  if(!Array.isArray(data.repositories))throw new Error('Lista de repositórios inválida');
  const repositories=data.repositories.filter(repo=>repo.private===false&&repo.owner?.login?.toLowerCase()===login.toLowerCase());
  for(const repo of repositories)integer(repo.id,'identificador do repositório');
  if(new Set(repositories.map(repo=>repo.id)).size!==repositories.length||repositories.length!==expected)throw new Error('Lista de repositórios públicos incompleta ou duplicada');
  const stars=repositories.reduce((sum,repo)=>integer(sum+integer(repo.stargazers_count,'estrelas'),'soma de estrelas'),0);
  const calendar=calendarWindow(data.days,asOf);
  const contributions=calendar.reduce((sum,day)=>integer(sum+day.count,'soma de contribuições'),0);
  return {login,asOf,repositories:expected,followers,stars,contributions,calendar};
}

function frame(width,height,title,description,body){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escape(title)}</title><desc id="desc">${escape(description)}</desc><rect x=".5" y=".5" width="${width-1}" height="${height-1}" rx="8" fill="${COLORS.bg}" stroke="${COLORS.border}"/><g font-family="Segoe UI,Arial,sans-serif">${body}</g></svg>\n`;
}

export function renderStats(metrics){
  const rows=[['Repositórios públicos',metrics.repositories],['Estrelas nos projetos',metrics.stars],['Seguidores',metrics.followers],['Contribuições no último ano',metrics.contributions]];
  const body=`<text x="24" y="32" fill="${COLORS.title}" font-size="18" font-weight="600">Estatísticas do GitHub</text>`+
    rows.map(([label,value],index)=>{const y=65+index*29;return `<circle cx="28" cy="${y-5}" r="3" fill="${COLORS.accent}"/><text x="42" y="${y}" fill="${COLORS.text}" font-size="14">${label}</text><text x="470" y="${y}" text-anchor="end" fill="${COLORS.text}" font-size="14" font-weight="600">${number(value)}</text>`;}).join('')+
    `<text x="24" y="189" fill="${COLORS.text}" font-size="11">Dados visíveis no perfil · ${pretty(metrics.asOf)}</text>`;
  return frame(495,210,'Estatísticas públicas de '+metrics.login,rows.map(([label,value])=>label+': '+number(value)).join('; ')+'. Atualizado em '+pretty(metrics.asOf)+'. Contribuições agregadas exibidas no perfil, não quantidade de commits.',body);
}

export function renderActivity(metrics){
  const days=metrics.calendar.slice(-31);
  const left=60,right=976,top=80,bottom=238;
  const max=4*Math.max(1,Math.ceil(Math.max(...days.map(day=>day.count))/4));
  const points=days.map((day,index)=>({x:left+index*(right-left)/30,y:bottom-day.count*(bottom-top)/max,...day}));
  const coords=points.map(point=>point.x.toFixed(2)+','+point.y.toFixed(2)).join(' ');
  let body=`<text x="24" y="32" fill="${COLORS.title}" font-size="20" font-weight="600">Atividade no GitHub</text><text x="24" y="53" fill="${COLORS.text}" font-size="12">Contribuições por dia · últimos 31 dias</text>`;
  for(let index=0;index<=4;index++){
    const y=bottom-index*(bottom-top)/4;
    body+=`<path d="M${left} ${y}H${right}" stroke="${COLORS.border}" stroke-width="1"/><text x="48" y="${y+4}" text-anchor="end" fill="${COLORS.text}" font-size="11">${number(index*max/4)}</text>`;
  }
  body+=`<polygon points="${left},${bottom} ${coords} ${right},${bottom}" fill="${COLORS.border}" opacity=".35"/><polyline points="${coords}" fill="none" stroke="${COLORS.title}" stroke-width="2"/>`;
  for(const point of points)body+=`<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3" fill="${COLORS.accent}"><title>${pretty(point.date)}: ${number(point.count)} contribuições</title></circle>`;
  for(const index of [0,5,10,15,20,25,30])body+=`<text x="${points[index].x}" y="260" text-anchor="middle" fill="${COLORS.text}" font-size="11">${pretty(days[index].date).slice(0,5)}</text>`;
  body+=`<text x="24" y="286" fill="${COLORS.text}" font-size="11">Fonte: calendário visível no GitHub · atualizado em ${pretty(metrics.asOf)}</text>`;
  return frame(1000,305,'Gráfico de atividade de '+metrics.login,days.map(day=>day.date+': '+day.count).join('; '),body);
}

export async function update({login,outputDir,sourceDir,token,fetchImpl,now=new Date()}={}){
  const asOf=profileDate(now);
  const data=await loadPublicData({login,asOf,now,sourceDir,token,fetchImpl});
  const metrics=publicMetrics(data,login,asOf);
  const images=[['estatisticas.svg',renderStats(metrics)],['atividade.svg',renderActivity(metrics)]];
  await mkdir(outputDir,{recursive:true});
  const temporary=[];
  try{
    for(const [name,svg] of images){
      const target=resolve(outputDir,name),temp=target+'.tmp-'+process.pid;
      temporary.push(temp);await writeFile(temp,svg,'utf8');
    }
    for(let index=0;index<images.length;index++)await rename(temporary[index],resolve(outputDir,images[index][0]));
  }finally{await Promise.all(temporary.map(path=>rm(path,{force:true})));}
  return metrics;
}

async function main(){
  const args=process.argv.slice(2),options={};
  for(let index=0;index<args.length;index+=2){
    if(!['--username','--output','--source-dir'].includes(args[index])||!args[index+1])throw new Error('Argumentos inválidos');
    options[args[index]]=args[index+1];
  }
  const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const login=options['--username']||process.env.GITHUB_REPOSITORY_OWNER||'GuilhermeAraujoDeCastro';
  const metrics=await update({login,outputDir:resolve(options['--output']||resolve(repositoryRoot,'assets/analytics')),sourceDir:options['--source-dir'],token:process.env.GITHUB_TOKEN});
  console.log('Dois gráficos gerados com dados públicos de '+metrics.login+' em '+pretty(metrics.asOf)+'.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('Atualização interrompida: '+error.message);process.exitCode=1;});
