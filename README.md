# AI Free Credits Agent

Agente para descobrir oportunidades públicas de créditos gratuitos, planos free e testes de ferramentas de IA. O projeto começa com um MVP baseado em feeds RSS/Atom e revisão humana.

## O que já está implementado

- Cloudflare Worker com execução agendada a cada 30 minutos.
- Coleta inicial de feeds públicos do Cloudflare, Hugging Face e GitHub.
- Filtro por termos relacionados a créditos, planos gratuitos e testes.
- Classificação básica por categoria e pontuação de relevância.
- Persistência e deduplicação no Cloudflare D1.
- API JSON para consultar ofertas, execuções e saúde do serviço.
- Nenhum serviço pago é necessário para executar a arquitetura dentro dos limites gratuitos disponíveis.

> O agente identifica e organiza oportunidades; não cria contas automaticamente. Cadastro, verificação de e-mail, CAPTCHA, MFA e aceite de termos permanecem sob ação humana. Isso evita cadastros indevidos e respeita as regras dos provedores.

## Estrutura

- `src/index.js`: Worker, leitor RSS/Atom, filtro e endpoints.
- `schema.sql`: tabelas do D1.
- `wrangler.toml`: configuração do Worker e cron.

## Configuração inicial no Cloudflare

1. Crie uma conta Cloudflare e abra **Workers & Pages**.
2. Crie um banco D1 chamado `ai-free-credits`.
3. Copie o identificador do banco e substitua `REPLACE_WITH_D1_DATABASE_ID` em `wrangler.toml`.
4. Execute a migração: `npx wrangler d1 execute ai-free-credits --remote --file=./schema.sql`.
5. Faça login no Wrangler: `npx wrangler login`.
6. Configure um token forte para proteger a coleta manual: `npx wrangler secret put ADMIN_TOKEN`.
7. Publique: `npx wrangler deploy`.
8. Confirme em **Workers & Pages → seu Worker → Settings/Triggers** que o cron `*/30 * * * *` está ativo.

## Endpoints

- `GET /`: informações básicas.
- `GET /health`: estado do serviço.
- `GET /offers`: ofertas recentes.
- `GET /offers?category=models-api`: filtro por categoria.
- `GET /runs`: últimas execuções.
- `POST /scan`: executar uma coleta manual.

Os endpoints de consulta são públicos neste MVP. A coleta manual `POST /scan` exige `Authorization: Bearer SEU_ADMIN_TOKEN`; configure o segredo `ADMIN_TOKEN` antes de publicar. Restrinja CORS quando conectar um painel.

## Limitações importantes

- Cron a cada 30 minutos é monitoramento periódico, não um processo permanentemente ativo nem garantia de tempo real.
- O plano gratuito tem limites de execução e armazenamento sujeitos às regras vigentes da Cloudflare.
- Os feeds e filtros iniciais não cobrem toda a internet; novas fontes serão adicionadas gradualmente.
- Uma menção a “free” não garante que a oferta esteja ativa ou disponível no Brasil. Verifique sempre a página oficial, elegibilidade, validade e termos antes de usar.
- O MVP não envia mensagens automaticamente para esta conversa. O acompanhamento inicial é feito pela API; uma integração de notificações pode ser adicionada depois.

## Próximas etapas

1. Criar o banco D1 e inserir o ID em `wrangler.toml`.
2. Publicar o Worker na Cloudflare.
3. Testar a primeira coleta e ajustar fontes/filtros.
4. Construir painel e notificações, mantendo custo zero.
