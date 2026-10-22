# Checkup de segurança — 22/10/2026

## Escopo e método

Revisão estática do repositório Angular/Express, dependências do package-lock.json, API Cloudinary e consultas somente de leitura ao Supabase conectado, projeto **Gestão** (`uvjadekrdvydtorcrhkd`). A URL no callback OAuth publicado corresponde a esse projeto. Foram consultados metadados, políticas, privilégios, definições SQL, código das sete Edge Functions e Security Advisors. Não foram lidos valores de tokens de contas nem executadas chamadas que alterem estoque, pedidos ou integrações. Nenhuma correção foi aplicada à aplicação ou à produção.

Este relatório identifica permissões e caminhos vulneráveis; não comprova exploração anterior. A validação das funções remotas foi feita pelo código publicado e configuração, sem disparar suas operações. Configurações externas de WAF, proxy, Cloudinary e cadastro público não foram verificadas.

## Achados prioritários

### 1. Crítico — atualização de estoque no Mercado Livre sem autenticação

**Evidência:** Edge Function `meli-update-stock`, slug `rapid-processor`, versão 10, `verify_jwt=false`. Em `index.ts:18–24` apenas exige POST e lê `payload.record`. Em `34–72`, consulta vínculos e tokens com service_role e faz PUT no Mercado Livre com `available_quantity: novoEstoque`. Em `119–121`, passa diretamente `produto.id` e `produto.estoque_fisico` fornecidos pelo chamador. Não há validação de credencial de entrada no restante do código.

**Impacto:** quem obtiver um UUID de produto vinculado pode enviar uma quantidade arbitrária aos anúncios associados, sem sessão do ERP. Não depende de alterar primeiro a tabela de produtos.

**Correção:** autenticar o webhook interno antes de qualquer consulta; usar credencial exclusiva para esse fluxo e atualizar o emissor em conjunto. Buscar o estoque vigente no banco pelo ID, em vez de confiar no record recebido; validar quantidade inteira e limites. Testar rejeição de chamada sem credencial e com credencial incorreta em ambiente isolado.

### 2. Crítico — tokens do Mercado Livre acessíveis a qualquer usuário autenticado

**Evidência:** `public.meli_contas` contém colunas `access_token` e `refresh_token`. A política `total` aplica `ALL TO authenticated USING (true) WITH CHECK (true)`. Os privilégios incluem SELECT, INSERT, UPDATE e DELETE para authenticated.

**Impacto:** uma sessão válida pode consultar os tokens diretamente pela API de dados, independentemente das telas disponíveis, e alterar ou excluir as credenciais. Isso permite uso indevido da integração conforme os escopos concedidos pelo Mercado Livre. Não foram consultados os valores desses tokens. Cadastro público aberto não foi confirmado.

**Correção:** retirar acesso dos clientes a essa tabela e manter credenciais em área acessível somente pelo backend. Se a interface precisar listar contas, expor apenas campos seguros por uma interface específica. Revisar usuários autorizados e logs; avaliar revogação/rotação dos tokens conforme a exposição identificada.

### 3. Alto — outras funções públicas executam operações privilegiadas

Todas as funções abaixo têm `verify_jwt=false` e não validam a identidade do chamador no código publicado:

| Função / slug / versão | Evidência e impacto |
| --- | --- |
| `meli-sync` / `clever-api` / 8 | `index.ts:4–18` cria cliente service_role e seleciona a primeira conta. Sincroniza anúncios, cria produtos e vínculos e renova tokens sem autorização de entrada. |
| `sync-vendas` / `sync-vendas` / 2 | `index.ts:24–35` inicia processamento privilegiado sem autenticação. Importa histórico de pedidos e itens; chamadas repetidas consomem recursos e cota da integração. |
| `gerar-anuncio-ia` / `gerar-anuncio-ia` / 8 | `index.ts:9–29` aceita produto_id e lê o produto usando service_role. Chama Gemini e retorna conteúdo baseado em dados internos. Permite consumo da cota de IA e acesso indireto a dados de um produto cujo UUID seja conhecido. |

**Correção:** exigir identidade verificada e autorização de membro do ERP nas funções de usuário; reservar funções operacionais para credenciais internas. Aplicar limites de frequência e concorrência, especialmente em IA e sincronizações. CORS não substitui autenticação; enviar Bearer no frontend não protege uma função que ignora o header.

### 4. Alto — banco autoriza operações amplas para toda sessão autenticada

**Evidência:** RLS está habilitado nas nove tabelas públicas, mas produtos_internos, composicao_kits, meli_anuncios, anuncio_skus, pedidos e itens_pedido têm políticas ALL para authenticated com condições true. banco_imagens permite ALL com condição baseada apenas em auth.role().

**Impacto:** qualquer usuário autenticado recebe acesso operacional amplo, incluindo exclusão e alteração de pedidos e estoque. Não há restrição de membro aprovado, função ou empresa nessas políticas. Mesmo num ERP de empresa única, possuir uma conta no Auth equivale a receber essas permissões.

**Correção:** definir quais usuários pertencem ao ERP e quais operações cada papel pode realizar; aplicar esse modelo nas políticas e nas Edge Functions. Se houver múltiplas empresas, acrescentar vínculo explícito de empresa e isolamento correspondente. Evitar atribuir papéis com user_metadata editável pelo usuário.

### 5. Alto — callback OAuth permite vinculação sem estado de autorização

**Evidência:** `meli-auth`, slug `clever-service`, versão 5, `index.ts:4–10` lê apenas code; `25–63` troca o código e faz upsert de conta com service_role. Não verifica state, sessão do administrador nem associação com uma tentativa autorizada de conexão.

**Impacto:** um código válido emitido para esse aplicativo pode inserir uma conta sem comprovar autorização do administrador do ERP. Como sincronizações selecionam a primeira conta sem escopo, contas adicionais também tornam o comportamento ambíguo.

**Correção:** iniciar conexão a partir de administrador autenticado; emitir state imprevisível, de uso único e com expiração, associado à sessão e à empresa. Validar o state antes da troca e da gravação. Vincular a conta explicitamente ao contexto autorizado.

### 6. Alto — dependências com alertas conhecidos

**Evidência:** `npm.cmd audit --json --ignore-scripts` retornou **41 pacotes afetados: 3 críticos, 27 altos, 9 moderados e 2 baixos**. A contagem inclui dependências diretas, transitivas, de execução e de desenvolvimento; não representa 41 caminhos comprovados de exploração. O registro apontou correções disponíveis nos exemplos Angular analisados.

Os alertas incluem Angular core/compiler (XSS), platform-server (XSS, SSRF e DoS), router (DoS), CLI/build e tar (crítico). A aplicabilidade depende dos recursos usados e de como o projeto é executado: falha de ferramenta de desenvolvimento não equivale automaticamente a vulnerabilidade acessível em produção.

**Correção:** atualizar o conjunto Angular de forma compatível e as dependências transitivas pelo lockfile; revisar mudanças e executar build/testes e novo audit. Não aplicar `npm audit fix --force` indiscriminadamente. Exemplo de aviso upstream: https://github.com/angular/angular/security/advisories/GHSA-jj27-h5hq-8x99 .

## Outros achados

- **Médio — upload controlado apenas no navegador.** `src/app/pages/dashboard/dashboard.ts:234–281` verifica MIME e 5 MB no cliente. `api/cloudinary-sign.js:28–50` assina somente timestamp e folder; não vincula um arquivo nem uma permissão específica do ERP. Um usuário autenticado pode contornar as verificações locais e reutilizar a assinatura para outros uploads aceitos pelo provedor. Configurações externas podem impor restrições, mas não foram verificadas. Usar preset assinado com formatos/tamanho restritos, autorização, cotas e identificador controlado pelo servidor. Assinaturas Cloudinary excluem file e resource_type: https://cloudinary.com/documentation/authentication_signatures .
- **Médio — rotas sem guarda e carregamento antes da checagem de sessão.** `src/app/app.routes.ts:18–28` não define canActivate/canActivateChild. Anúncios e assistente consultam dados diretamente; dashboard, financeiro e calculadora iniciam a verificação assíncrona sem aguardá-la antes de carregar dados. Centralizar proteção de navegação e aguardar a sessão. Isso melhora o fluxo, mas não substitui RLS e autorização no backend.
- **Médio — webhook público com validação insuficiente.** `meli-webhook`, slug `rapid-api`, versão 10, aceita JSON público e agenda processamento. Para orders_v2, concatena resource à URL da API e grava dados sem checar explicitamente seller.id do pedido contra a conta selecionada. Restringir resource a caminhos de pedidos válidos, verificar pertencimento na resposta oficial, limitar repetição e usar o mecanismo de autenticidade suportado pelo provedor. O código de items encaminha a uma função interna que já exige credencial e valida formato do caminho. Não foi comprovada falsificação de pedido ou SSRF externo.
- **Médio — proteção contra senhas vazadas desabilitada.** Confirmado pelo Security Advisor. Habilitar se disponível no plano e revisar política de senha/MFA para operadores privilegiados. Não foram avaliadas configurações de MFA ou rate limit do Auth.
- **Baixo / endurecimento — funções SQL sem search_path fixo.** obter_dashboard_financeiro e decrementar_estoque usam nomes de tabelas não qualificados e não têm search_path configurado. Ambas são SECURITY INVOKER, portanto não foi identificado bypass de RLS por elas. Qualificar tabelas, fixar search_path e limitar EXECUTE aos papéis necessários. decrementar_estoque também aceita quantidade negativa e não valida disponibilidade; restringir execução ao fluxo operacional e validar regras no servidor.
- **Baixo / endurecimento — headers não definidos no código.** `src/server.ts` não configura CSP, proteção contra framing ou outros headers de segurança. Podem ser adicionados pelo provedor; não foi auditada uma URL publicada. Verificar resposta HTTP real e configurar CSP compatível com Angular e origens necessárias.
- **Baixo — prevenção de commit de segredos incompleta.** `.gitignore` ignora src/environments, mas não .env e variantes. Adicionar padrões de arquivos de credenciais com exceção explícita para exemplo sem valores. `scripts/set-env.js` inclui apenas parâmetros públicos do frontend; a chave anon/publicável no navegador é esperada, e não substitui as políticas do banco.

## Alertas que não devem ser confundidos com exploração comprovada

O Advisor marcou `atualiza_estoque_kits` como SECURITY DEFINER executável por anon/authenticated. A definição mostra **RETURNS trigger**, não uma RPC comum. Não foi demonstrada chamada direta pelo endpoint RPC. Revisar/revogar permissões desnecessárias como endurecimento e preservar seu funcionamento por trigger; não classificar esse alerta isolado como alteração anônima de estoque comprovada.

estoque_movimentos tem RLS sem políticas: isso bloqueia acesso comum por esses papéis, em vez de liberar dados. Só adicionar políticas se houver necessidade funcional e autorização definida.

## Ordem recomendada e validação

1. Proteger meli-update-stock e suas chamadas internas; validar estoque pelo banco.
2. Bloquear acesso de clientes aos tokens e restringir autorização nas demais funções públicas.
3. Corrigir vínculo OAuth e políticas de membros/papéis.
4. Atualizar dependências e reforçar uploads, navegação e configuração de autenticação.
5. Em ambiente isolado, verificar matriz visitante / usuário sem acesso ao ERP / operador / administrador; conferir bloqueios de leitura e escrita, sincronização legítima, OAuth e webhook real. Validar resultados sem realizar testes destrutivos em produção.

Referência sobre RLS e autorização: https://supabase.com/docs/guides/database/postgres/row-level-security .

Não foi executado build nem teste funcional: o checkout não inclui os arquivos environment importados e a revisão não provisionou credenciais ou dependências. Configurações de cadastro público, logs de incidentes, políticas do Cloudinary e headers publicados continuam pendentes de verificação. A ausência de achados em uma revisão não garante ausência de vulnerabilidades.
