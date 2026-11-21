# Resultado da homologação local

Data: 2026-11-19. Ambiente: Windows, Node.js 24.22.3, Wrangler 4.164.0.

## Isolamento

O Worker de homologação usa `wrangler.local.toml`, nome `ai-free-credits-agent-homologation`, ID D1 fictício `00000000-0000-0000-0000-000000000001` e binding local em `.wrangler/state/v3/d1`. Os comandos D1 e `wrangler dev` foram executados somente com `--local`. O harness `test/local-worker.js` serve feeds em memória e rejeita qualquer URL diferente da fixture; nenhuma fonte real foi chamada e nenhuma credencial foi configurada.

## Banco local

Schema-base e migração `0001_offer_metadata_and_sources.sql` aplicados com sucesso. O Wrangler reportou 4 comandos do schema-base e 15 comandos da migração. Resultado final: `offers` tem 20 colunas, `sources` tem 9 colunas e `offer_evidence` tem 8 colunas. A tabela `sources` contém 12 fontes iniciais.

Após a homologação inicial: 1 oferta, 12 fontes, 2 eventos de evidência e 14 registros de varredura. Na validação local posterior das correções, duas varreduras positivas adicionais geraram os registros 15 e 16 e deixaram a oferta em `review`; os dois eventos de evidência anteriores continuam presentes.

## Worker e comportamento

- Wrangler iniciou em `http://127.0.0.1:8787` com `--local`.
- `GET /health`, `GET /offers` e `GET /runs` responderam corretamente.
- `POST /scan` sem secret local respondeu `401`.
- A primeira fixture positiva processou 2 itens com URLs equivalentes e gravou 1 oferta.
- Repetir a fixture manteve 1 oferta e 1 evento de evidência positiva.
- A fixture negativa alterou a oferta para `rejected` e acrescentou o segundo evento de evidência.
- Não houve erros de varredura nas fixtures.
- Após as correções finais, `wrangler dev --local` iniciou com o build guard; as varreduras sintéticas foram registradas em D1 local e `/runs` exibiu os novos registros.

## Desempenho observado

Dez varreduras adicionais pelo HTTP loopback do Worker local, cada uma com um feed sintético em memória: wall time mínimo 10,66 ms, mediana 12,14 ms e p95/máximo 273,25 ms. O outlier mostra variabilidade do ambiente local. Esses valores incluem cliente HTTP, IPC e D1 local; Wrangler não forneceu aqui uma medida isolada de CPU do Worker. Portanto, **não validam** o limite de CPU de 10 ms do Workers Free nem predizem Production.

## Problemas e limitações

- Wrangler não estava instalado inicialmente. O sandbox bloqueou symlinks do layout padrão do pnpm e, por padrão, impediu os scripts de instalação de `workerd` e `esbuild`. Foi necessário usar layout hoisted e aprovar apenas esses dois scripts após inspecionar que eles preparam/validam os binários locais. Isso foi específico deste ambiente.
- `wrangler.toml` continua contendo o binding de Production. Para evitar uso acidental, a homologação deve sempre usar `wrangler.local.toml` e `--local`; nunca acrescente `--remote`.
- O endpoint `/_homologation/scan` existe apenas no entrypoint de teste. Não publique o harness nem use a configuração local para deployment.
- CPU isolada, rede para provedores externos e comportamento do D1 remoto ainda não foram medidos.
