# Estatísticas do perfil

Os dois SVGs em `assets/analytics/` são gerados com dados visíveis no GitHub. O README carrega esses arquivos do próprio repositório, sem depender de um serviço de imagens de terceiros.

O card mostra repositórios públicos, estrelas nesses repositórios, seguidores e contribuições exibidas no calendário dos últimos 365 dias. Contribuições incluem outras atividades além de commits. O gráfico usa os últimos 31 dias, incluindo o dia atual, que ainda pode receber atividade.

## Execução local

Requer Node.js 22 ou superior. Não há dependências npm.

```sh
node --test scripts/atualizar-estatisticas.test.mjs
node scripts/atualizar-estatisticas.mjs --username GuilhermeAraujoDeCastro
```

Sem token, a rotina usa a API REST pública e o calendário público do GitHub. Se `GITHUB_TOKEN` estiver no ambiente, consulta também o calendário pela API GraphQL e usa limites autenticados. O token só é enviado para `api.github.com` e não é gravado nos SVGs. Não coloque credenciais no README ou nos arquivos do repositório.

O parâmetro opcional `--output` escolhe a pasta de saída. `--source-dir` permite reproduzir a geração a partir de arquivos públicos já obtidos: `usuario.json`, `repositorios.json` e `contribuicoes.html`. Dados fictícios dos testes ficam apenas em pastas temporárias.

## Atualização diária

O workflow `estatisticas.yml` roda diariamente, também permite execução manual e roda quando seu código muda na branch `main`. Não exige PAT ou configuração de serviço pago: usa o `GITHUB_TOKEN` fornecido pelo próprio GitHub Actions.

O job de geração tem permissão de leitura. Somente o job que publica as imagens recebe `contents: write`; seu commit inclui apenas os dois SVGs. A rotina não cria commit quando o conteúdo não mudou e não usa force push. Se `main` mudar durante a execução, preserva as imagens existentes.

Respostas inválidas, calendário incompleto ou falhas de consulta interrompem a geração e preservam os arquivos publicados. A data visível nos cards permite identificar a última atualização válida. O calendário HTML é uma alternativa à API GraphQL e pode exigir manutenção se o GitHub alterar seu formato.

Agendamentos podem atrasar; em repositórios públicos, o GitHub pode desativá-los após 60 dias sem atividade. Para conferir ou executar novamente, abra **Actions → Atualizar estatísticas do perfil**. Se o repositório ou a organização bloquear commits do Actions, será necessário revisar essa permissão; o workflow não altera configurações remotas.
