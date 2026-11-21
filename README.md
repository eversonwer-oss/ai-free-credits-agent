# AI Free Credits Agent

Worker para descobrir ofertas publicamente documentadas de free tiers, créditos promocionais e planos gratuitos de ferramentas de IA. As ofertas novas entram em `review`; nenhuma delas é tratada como confirmação de gratuidade. Evidências posteriores que indiquem encerramento ou cobrança mudam o status para `expired` ou `rejected` e são preservadas em `offer_evidence`.

## Fontes

`src/sources.js` contém 12 fontes RSS/Atom, API pública e páginas oficiais. Cada entrada registra provedor, URL, tipo, categorias temáticas e confiabilidade de 1 a 5. A tabela D1 `sources` guarda o mesmo cadastro; `enabled=0` desativa uma fonte sem remover seus dados. Categorias das ofertas são calculadas pelo texto de cada item, não pelas categorias gerais da fonte.

## Limites por varredura

- Até 12 fontes, com no máximo cinco buscas simultâneas.
- No máximo dois redirects por fonte, seguidos manualmente; no pior caso são 36 subrequests externos (12 fontes × 3 requisições), abaixo do limite Free de 50.
- Timeout de 6 segundos por fonte.
- Até 3 itens por feed e 20 itens processados no total.
- Até 42.666 bytes por fonte, no máximo aproximado de 512 KiB por execução.
- Até 20 ofertas observadas; duas instruções por oferta no batch D1 (no máximo 40), mais a gravação do registro da varredura.
- Páginas HTML têm extração limitada a título, descrição, cabeçalhos, parágrafos e itens de lista, com até 6.000 caracteres de texto.

O código limita o conteúdo antes de decodificá-lo e para o parser de RSS/Atom após o número permitido de itens. Esses limites reduzem o trabalho, mas **não validam** o limite de CPU de 10 ms por invocação do Workers Free. O tempo de CPU precisa ser observado em um Worker de homologação Cloudflare; o teste local Node não substitui essa medição.

## Banco D1: instalação nova e existente

`schema.sql` define as colunas originais de `offers` e as dez colunas compatíveis de `scan_runs`. A migração `migrations/0001_offer_metadata_and_sources.sql` adiciona os metadados e as tabelas auxiliares. Após aplicar ambos, banco novo e banco existente chegam à mesma estrutura. O binding de Production registra `migrations/` em `wrangler.toml`.

### Banco novo

1. Crie o D1 `ai-free-credits` e confira o binding em `wrangler.toml`.
2. Aplique o schema-base:

   ```sh
   npx wrangler d1 execute ai-free-credits --remote --file=./schema.sql
   ```

3. Aplique a migração uma vez pelo fluxo rastreado do Wrangler (ele cria e mantém `d1_migrations`):

   ```sh
   npx wrangler d1 migrations apply ai-free-credits --remote
   ```

4. Antes de publicar, confira o histórico e o schema resultante. A migração é aditiva e não altera `scan_runs`.

### Banco existente

Não execute `schema.sql` sobre um banco com dados. Antes de migrar, faça estas verificações somente de leitura no banco correto:

```sh
npx wrangler d1 migrations list ai-free-credits --remote
npx wrangler d1 execute ai-free-credits --remote --command="PRAGMA table_info(offers);"
npx wrangler d1 execute ai-free-credits --remote --command="PRAGMA table_info(scan_runs);"
npx wrangler d1 execute ai-free-credits --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Antes de qualquer migração remota, confira no banco correto o schema completo, defaults, constraints, contagens de registros e histórico remoto. Confirme que `offers` mantém suas 11 colunas originais (incluindo `id INTEGER PRIMARY KEY`), que nenhuma destas colunas existe ainda (`benefit_type`, `expires_at`, `region`, `requires_card`, `billing`, `evidence`, `confidence_reasons`, `last_verified_at`, `updated_at`), e que `sources` e `offer_evidence` não existem. Confirme também todas as dez colunas de `scan_runs`, inclusive as antigas (`id`, `started_at`, `finished_at`, `status`, `items_found`, `error`) e as quatro adicionadas (`feeds_checked`, `items_seen`, `offers_saved`, `errors`), e anote as contagens antes da operação.

Prossiga somente se `0001_offer_metadata_and_sources.sql` estiver pendente no histórico, o schema observado corresponder a esse preflight e existir um backup operacional aprovado. Se `d1_migrations` ainda não existir, use `wrangler d1 migrations apply` para que o Wrangler crie e mantenha o histórico; não execute o arquivo SQL manualmente no console. Se qualquer coluna de destino existir sem a migração registrada, o histórico indicar aplicação, uma tabela auxiliar já existir ou qualquer estrutura/contagem divergir, pare e investigue. A migração usa `ALTER TABLE ADD COLUMN`, que não é seguro para reaplicação manual.

Depois do preflight e do backup operacional aprovado, aplique somente:

```sh
npx wrangler d1 migrations apply ai-free-credits --remote
```

O Wrangler registra as migrações concluídas em `d1_migrations`. Não rode o conteúdo de `0001` manualmente nem volte a aplicá-lo fora do fluxo de migrações. Aplique em homologação primeiro e confira o resultado; se houver falha, verifique o estado do banco antes de qualquer nova tentativa.

`0001` adiciona exatamente as nove colunas acima a `offers`, cria `sources` e `offer_evidence`, adiciona índices e semeia as fontes com `INSERT OR IGNORE`. Não altera `scan_runs`; suas colunas antigas e novas permanecem intactas. O Worker consulta `PRAGMA table_info(scan_runs)` e grava nos campos presentes, incluindo o conjunto antigo e o novo. `status` recebe `success` ou `partial`; `items_found` recebe `items_seen`; `error` e `errors` recebem o mesmo texto de erro. `offers.id` permanece inteiro e é gerado pelo D1. A tabela de evidências usa o mesmo tipo para `offer_id` e impede a remoção de ofertas/fontes referenciadas, preservando o histórico.

### Ordem de implantação

Em Production, execute a migração primeiro e confira o schema e os dados; publique o Worker só depois. Para validar o limite de CPU, use um Worker e D1 de homologação separados, faça uma varredura com conteúdo representativo e confira CPU/wall time em Workers Observability. Não use `/scan` de Production como teste de carga.

## Segurança e validação de ofertas

- URLs com usuário/senha embutidos são rejeitadas.
- Fragmentos, trackers conhecidos e parâmetros de segredo conhecidos são removidos; parâmetros funcionais como `source` permanecem.
- URLs de itens vêm de conteúdo externo, são armazenadas e retornadas como JSON, mas não são acessadas pelo Worker.
- `ADMIN_TOKEN` continua sendo um secret do Worker e nunca deve entrar no código ou nos logs.
- Validade, região, cartão e condições de cobrança são heurísticas baseadas no texto e exigem revisão humana. Uma data de validade não identificada não significa que a oferta continue ativa.

## Testes locais

Requer Node.js 22.5 ou mais recente (`node:sqlite` para verificar o schema localmente). Não precisa de Wrangler, conta Cloudflare, D1 remoto ou `ADMIN_TOKEN`.

```sh
node --test
node --test test/perf.test.js
```

Os testes de compatibilidade usam SQLite em memória e verificam a instalação nova e uma cópia do schema Production informado, com 17 registros em `scan_runs`. Também comparam as nove colunas entre migração e SQL do Worker e conferem as chaves estrangeiras. A migração foi exercitada separadamente pelo Wrangler contra D1 local isolado. O teste de desempenho mede somente o parser no Node local; não afirma que CPU do Workers Free esteja abaixo de 10 ms.

## Homologação no runtime local do Worker

`wrangler.local.toml` usa outro nome de Worker, um ID D1 fictício, `workers_dev = false` e um build guard que permite somente `wrangler dev`. Um comando de publicação ou upload de versão falha antes do bundle. O harness também responde 404 para `/_homologation/scan` fora de `localhost`, `127.0.0.1` ou `::1`. Ele não é a entrada da Production: `wrangler.toml` aponta apenas para `src/index.js`. Ainda assim, nunca use a configuração local em um comando de deploy.

O harness aponta para `test/local-worker.js`, executa a lógica real de varredura contra um feed RSS sintético e nunca busca fontes externas. Todos os comandos abaixo incluem `--local`; não acrescente `--remote` e não use `wrangler.toml` para esta homologação.

```sh
pnpm install
pnpm exec wrangler d1 execute ai-free-credits-local --local --config wrangler.local.toml --file=./schema.sql
pnpm exec wrangler d1 migrations apply ai-free-credits-local --local --config wrangler.local.toml
pnpm exec wrangler d1 execute ai-free-credits-local --local --config wrangler.local.toml --command="PRAGMA table_info(offers); PRAGMA table_info(sources); PRAGMA table_info(offer_evidence);"
pnpm dev:local
```

Com o Worker local rodando em `http://127.0.0.1:8787`, use outro terminal PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod -Method Post http://127.0.0.1:8787/_homologation/scan
Invoke-RestMethod -Method Post 'http://127.0.0.1:8787/_homologation/scan?state=negative'
Invoke-RestMethod http://127.0.0.1:8787/offers
Invoke-RestMethod http://127.0.0.1:8787/runs
```

A fixture positiva contém URLs duplicadas com parâmetros de tracking; a segunda varredura apresenta evidência de encerramento da oferta. Isso exercita deduplicação, atualização de estado e histórico em D1 local. O `/scan` normal continua sem secret configurado localmente e deve responder `401`; o endpoint específico `/_homologation/scan` existe apenas no entrypoint de homologação.

O tempo medido entre o cliente local e o Worker local é wall time e inclui inicialização/IPC/D1 local. Ele não representa a métrica de CPU isolada do runtime Cloudflare nem valida o limite de 10 ms do Workers Free. Para isso, use ambiente Cloudflare de homologação separado e confira Workers Observability; não publique este harness.

## Endpoints

- `GET /health`
- `GET /offers?limit=50`
- `GET /offers?category=video`
- `GET /runs`
- `POST /scan` com `Authorization: Bearer <token configurado>`

Os endpoints GET são públicos nesta versão. A coleta manual exige o secret `ADMIN_TOKEN` configurado na Cloudflare.
