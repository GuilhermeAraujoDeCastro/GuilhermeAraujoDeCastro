// Confere se todo link e imagem do README ainda responde. Roda no GitHub Actions (links.yml).
import { readFileSync } from 'node:fs';

// Sites que recusam robô de propósito (não quer dizer que o link quebrou).
const IGNORAR = [/linkedin\.com/];
const TENTATIVAS = 3;

const texto = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const links = [...new Set([...texto.matchAll(/https?:\/\/[^\s"')<>]+/g)].map((m) => m[0].replace(/[.,]$/, '')))]
  .filter((url) => !IGNORAR.some((r) => r.test(url)));

async function status(url) {
  for (let i = 1; i <= TENTATIVAS; i++) {
    try {
      const resposta = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'checar-links' } });
      if (resposta.ok || i === TENTATIVAS) return resposta.status;
    } catch (erro) {
      if (i === TENTATIVAS) return erro.name;
    }
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
}

const quebrados = [];
for (const url of links) {
  const codigo = await status(url);
  if (codigo !== 200) quebrados.push(`${codigo}  ${url}`);
}

console.log(`${links.length} links conferidos.`);
if (quebrados.length) {
  console.error(`Links com problema:\n${quebrados.join('\n')}`);
  process.exit(1);
}
