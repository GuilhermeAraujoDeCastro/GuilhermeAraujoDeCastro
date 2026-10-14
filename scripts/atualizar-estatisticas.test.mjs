import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {parseCalendarHtml,calendarWindow,profileDate,publicMetrics,renderStats,renderActivity,update,loadPublicData} from './atualizar-estatisticas.mjs';

const login='PerfilTeste',asOf='2026-11-05',now=new Date('2026-11-05T12:00:00Z');
const days=Array.from({length:365},(_,index)=>({date:new Date(Date.UTC(2026,10,5)-(364-index)*86_400_000).toISOString().slice(0,10),contributionCount:index===364?7:0}));
const htmlDay=(day,index)=>`<td id="day-${index}" data-date="${day.date}" class="ContributionCalendar-day" data-level="0"></td><tool-tip for="day-${index}">${day.contributionCount?day.contributionCount+' contributions':'No contributions'} on November 5th.</tool-tip>`;
const calendarHtml=days.map(htmlDay).join('');
const fixture=()=>({user:{login,public_repos:2,followers:3},repositories:[{id:1,private:false,owner:{login},stargazers_count:2},{id:2,private:false,owner:{login},stargazers_count:5},{id:3,private:true,owner:{login},stargazers_count:100}],days});

test('calendário distingue zero, singular e números com separador de milhar',()=>{
  const html=htmlDay({date:asOf,contributionCount:0},0)+htmlDay({date:'2026-11-04',contributionCount:1},1).replace('1 contributions','1 contribution')+htmlDay({date:'2026-11-03',contributionCount:'1,234'},2);
  assert.deepEqual(parseCalendarHtml(html).map(day=>day.contributionCount),[0,1,1234]);
});
test('resposta HTML de erro ou contagem desconhecida não vira atividade zero',()=>{
  assert.throws(()=>parseCalendarHtml('<html>Service unavailable</html>'),/Calendário público ausente/);
  assert.throws(()=>parseCalendarHtml(htmlDay({date:asOf,contributionCount:1},0).replace('1 contributions','unknown contributions')),/contagem/);
});
test('datas ausentes, duplicadas com conflito e valores não finitos são rejeitados',()=>{
  assert.throws(()=>calendarWindow(days.slice(0,-1),asOf),/incompleto/);
  assert.throws(()=>calendarWindow([...days,{date:asOf,contributionCount:8}],asOf),/conflitantes/);
  assert.throws(()=>calendarWindow([{date:asOf,contributionCount:NaN}],asOf,1),/inválido/);
  assert.throws(()=>calendarWindow([{date:'2026-02-30',contributionCount:1}],asOf,1),/Data inválida/);
});
test('métricas incluem apenas repositórios públicos do dono e não confundem contribuições com commits',()=>{
  const data=fixture();data.repositories.push({id:4,private:false,owner:{login:'OutroPerfil'},stargazers_count:200});
  const metrics=publicMetrics(data,login,asOf);
  assert.equal(metrics.repositories,2);assert.equal(metrics.stars,7);assert.equal(metrics.followers,3);assert.equal(metrics.contributions,7);
  assert.match(renderStats(metrics),/não quantidade de commits/);
  assert.throws(()=>publicMetrics({...data,repositories:data.repositories.filter(repo=>repo.id!==2)},login,asOf),/incompleta/);
});
test('geração é determinística e uma série totalmente zerada não produz NaN ou Infinity',()=>{
  const metrics=publicMetrics(fixture(),login,asOf);
  assert.equal(renderStats(metrics),renderStats(metrics));assert.equal(renderActivity(metrics),renderActivity(metrics));
  const zero=publicMetrics({...fixture(),days:days.map(day=>({...day,contributionCount:0}))},login,asOf);
  const svg=renderActivity(zero);assert(!/NaN|Infinity/.test(svg));assert.match(svg,/2026-11-05: 0/);
});
test('a data de atualização segue America/Sao_Paulo na virada UTC',()=>{
  assert.equal(profileDate(new Date('2026-11-06T01:00:00Z')),'2026-11-05');
});
test('falha de consulta preserva os dois arquivos existentes',async()=>{
  const outputDir=await mkdtemp(join(tmpdir(),'perfil-stats-'));
  try{
    await writeFile(join(outputDir,'estatisticas.svg'),'stats-anterior');await writeFile(join(outputDir,'atividade.svg'),'atividade-anterior');
    await assert.rejects(update({login,outputDir,now,fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
    assert.equal(await readFile(join(outputDir,'estatisticas.svg'),'utf8'),'stats-anterior');assert.equal(await readFile(join(outputDir,'atividade.svg'),'utf8'),'atividade-anterior');
  }finally{
    assert.equal(dirname(resolve(outputDir)),resolve(tmpdir()));assert(basename(outputDir).startsWith('perfil-stats-'));
    await rm(outputDir,{recursive:true,force:true});
  }
});
test('token fica apenas na API GitHub e falha GraphQL usa o calendário público validado',async()=>{
  const seen=[];const data=fixture();
  const fetchImpl=async(url,options)=>{
    seen.push({url,authorization:options.headers.Authorization});
    if(url==='https://api.github.com/graphql')return {ok:true,json:async()=>({errors:[{message:'unavailable'}]})};
    if(url.startsWith('https://github.com/'))return {ok:true,text:async()=>calendarHtml};
    return {ok:true,json:async()=>url.includes('/repos?')?data.repositories:data.user};
  };
  const loaded=await loadPublicData({login,asOf,now,token:'token-ficticio-de-teste',fetchImpl});
  assert.equal(publicMetrics(loaded,login,asOf).contributions,7);
  assert(seen.filter(item=>item.url.startsWith('https://api.github.com/')).every(item=>item.authorization==='Bearer token-ficticio-de-teste'));
  assert(seen.filter(item=>item.url.startsWith('https://github.com/')).every(item=>item.authorization===undefined));
});
test('calendário GraphQL válido dispensa HTML e mantém as contagens reais da resposta',async()=>{
  const data=fixture(),seen=[];
  const fetchImpl=async(url)=>{
    seen.push(url);
    if(url==='https://api.github.com/graphql')return {ok:true,json:async()=>({data:{user:{contributionsCollection:{contributionCalendar:{weeks:[{contributionDays:days}]}}}}})};
    return {ok:true,json:async()=>url.includes('/repos?')?data.repositories:data.user};
  };
  const loaded=await loadPublicData({login,asOf,now,token:'token-ficticio-de-teste',fetchImpl});
  assert.equal(publicMetrics(loaded,login,asOf).contributions,7);assert(seen.every(url=>new URL(url).hostname==='api.github.com'));
});
