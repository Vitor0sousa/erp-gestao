# Hub Estoque — ERP de Gestão

Sistema web para gerenciar produtos, estoque e kits, acompanhar anúncios e resultados financeiros do Mercado Livre e simular preços de venda. Utiliza autenticação pelo Supabase e está hospedado na Vercel.

## Funcionalidades

- **Login:** acesso por e-mail e senha e encerramento de sessão pelo menu lateral.
- **Produtos:** cadastro e edição de SKU, nome, custo, estoque e foto.
- **Kits:** composição com produtos simples, cálculo do custo e disponibilidade conforme os componentes.
- **Anúncios:** consulta, busca e solicitação de sincronização com o Mercado Livre.
- **Financeiro:** indicadores de vendas pagas, custos, taxas e frete, lucro estimado, lista de pedidos paginada e detalhes financeiros em modal.
- **Calculadora:** simulação de comissão, frete, lucro e margem para anúncios Clássico e Premium. Os parâmetros são estimativas definidas no código, sem consulta de tarifas em tempo real.
- **Assistente de IA:** geração de rascunhos de anúncios com título, descrição e seleção de imagens, por uma Edge Function.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Interface | Angular 20, TypeScript, componentes standalone, Signals e CSS |
| Navegação | Angular Router |
| Autenticação e banco | Supabase Auth, Postgres e supabase-js |
| Processamento remoto | Supabase Edge Functions |
| Imagens | Cloudinary com upload assinado |
| Hospedagem | Vercel |
| Entrada de servidor | Angular SSR e Express; rotas atualmente em `RenderMode.Client` |
| Testes | Jasmine e Karma |

## Estrutura

```text
api/
  cloudinary-sign.js          # Autoriza uploads de imagens
scripts/
  set-env.js                 # Gera configuração do Angular antes do build
public/                      # Arquivos públicos
src/
  app/
    auth/                    # Guarda de autenticação e testes
    calculadora-precos/      # Simulador de preços e margem
    layout/                  # Estrutura das páginas internas
    pages/
      anuncios/
      assistente/
      dashboard/             # Produtos, estoque e kits
      dashboard-financeiro/
      login/
    shared/sidebar/          # Navegação e logout
    app.routes.ts            # Rotas da aplicação
    app.routes.server.ts     # Estratégia de renderização
  environments/              # Configurações locais/geradas, ignoradas pelo Git
  server.ts                  # Entrada Express/Angular
angular.json                 # Configuração de build e desenvolvimento
```

As implementações das Edge Functions, o esquema SQL e as políticas do banco não estão versionados neste repositório. Para utilizar todas as funcionalidades, é necessário um projeto Supabase com esses recursos configurados. A pasta local `supabase/` é ignorada pelo Git.

## Rotas

| Caminho | Página | Acesso |
| --- | --- | --- |
| `/login` | Login | Público |
| `/dashboard` | Produtos e estoque | Autenticado |
| `/anuncios` | Anúncios | Autenticado |
| `/assitente` | Assistente de IA | Autenticado |
| `/financeiro` | Dashboard financeiro | Autenticado |
| `/calculadora` | Calculadora de preços | Autenticado |

A URL `/` redireciona para `/dashboard`. A grafia `/assitente` corresponde à rota atualmente definida no código. O menu também contém um link para `/vinculos`, mas essa rota ainda não está implementada.

As páginas internas usam o `LayoutComponent` e a guarda `canActivateChild`. Antes de liberar cada navegação, a guarda aguarda a validação do usuário com `supabase.auth.getUser()`. Sem autenticação válida ou em caso de falha, o acesso é redirecionado para `/login`.

## Desenvolvimento local

### 1. Instalar dependências

Utilize Node.js e npm compatíveis com Angular 20 e instale as versões do lockfile:

```bash
npm ci
```

No PowerShell, se a política de execução bloquear `npm.ps1`, utilize `npm.cmd` nos comandos.

### 2. Configurar o Angular

Crie `src/environments/environment.ts` e `src/environments/environment.development.ts`. Essa pasta é ignorada pelo Git.

Exemplo para `environment.development.ts`:

```typescript
export const environment = {
  production: false,
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseKey: 'SUA_CHAVE_ANON_PUBLICA',
  cloudinaryCloudName: 'SEU_CLOUD_NAME',
};
```

Para `environment.ts`, utilize a mesma estrutura com `production: true` e os valores correspondentes. O build padrão utiliza esse arquivo; o servidor de desenvolvimento o substitui por `environment.development.ts`, conforme o `angular.json`.

As variáveis configuradas na Vercel não são disponibilizadas automaticamente no computador local. `scripts/set-env.js` gera apenas `environment.ts`, usando variáveis do processo; ele não gera o arquivo de desenvolvimento nem carrega `.env` automaticamente.

### 3. Iniciar a interface

```bash
npm start
```

Acesse `http://localhost:4200` e entre com um usuário existente no Supabase. A interface oferece login, sem tela de cadastro.

O `ng serve` executa a interface, mas não a função `api/cloudinary-sign.js`. Para testar o envio de fotos localmente, o ambiente precisa também servir esse endpoint em `/api/cloudinary-sign`.

## Configuração na Vercel

### Variáveis de ambiente

| Variável | Utilização | Visibilidade |
| --- | --- | --- |
| `SUPABASE_URL` | Cliente Angular e validação de sessão na API | Pública |
| `SUPABASE_ANON_KEY` | Cliente Angular e cliente Supabase da API | Chave pública `anon` |
| `CLOUDINARY_CLOUD_NAME` | Configuração e upload de imagens | Pública |
| `CLOUDINARY_API_KEY` | Identificação do upload assinado | Enviada ao navegador durante o upload |
| `CLOUDINARY_API_SECRET` | Geração da assinatura Cloudinary | Exclusiva do servidor |

O script incorpora ao frontend apenas a URL do Supabase, sua chave pública e o nome do Cloudinary. Nunca utilize uma chave `service_role` ou outro segredo no lugar da chave pública do frontend.

### Build

Como `src/environments/` não é versionado, o ambiente de build precisa gerar `environment.ts` antes de compilar. Para utilizar o script existente, configure o **Build Command** como:

```bash
node scripts/set-env.js && npm run build
```

O `npm run build` atual executa somente `ng build`; não chama o gerador automaticamente. Essa orientação não altera as configurações existentes no painel da Vercel.

Configure as variáveis nos ambientes de publicação correspondentes, como Production e Preview. Alterações nos valores incorporados ao frontend precisam de um novo build.

### Função de `scripts/` e `api/`

**`scripts/set-env.js`** lê as variáveis do processo e escreve o módulo TypeScript importado pelo Angular. Ele é executado durante a preparação do build.

**`api/cloudinary-sign.js`** é o backend para autorizar uploads. Durante o envio de uma foto, o dashboard faz um POST para `/api/cloudinary-sign` com o token da sessão. A função valida esse token no Supabase e retorna assinatura, timestamp e parâmetros públicos do Cloudinary. O navegador envia a imagem diretamente ao Cloudinary e salva a URL no produto. O segredo permanece no servidor.

## Integrações com o Supabase

### Listagem de produtos

“Meus Produtos” mantém a ordenação por nome utilizada na consulta original.

A barra de pesquisa filtra por trechos do nome ou SKU, sem diferenciar maiúsculas e
minúsculas, preservando a ordem da lista. Limpar o campo exibe todos os produtos
carregados novamente.

### Dados e funções

O frontend utiliza estas tabelas:

| Tabela | Uso |
| --- | --- |
| `produtos_internos` | Cadastro, estoque, custo e busca de produtos |
| `composicao_kits` | Componentes e quantidades dos kits |
| `meli_anuncios` | Dados dos anúncios sincronizados |
| `anuncio_skus` | Associação entre anúncios e produtos |

O Financeiro consulta o Supabase diretamente com `createClient`, a configuração de
`environment` e chamadas `.from(...).select(...)`, seguindo o padrão das páginas de
produtos e anúncios. As consultas ficam em `src/app/services/financeiro.service.ts`;
os cálculos compartilhados em `src/app/models/calculo-financeiro.ts`. São usadas
as permissões RLS da sessão atual, sem consultar credenciais das contas. A RPC
anterior `obter_dashboard_financeiro` não foi alterada.

### Pedidos do Mercado Livre no Financeiro

A seção de pedidos aparece depois dos custos gerais e antes do item mais vendido.
São exibidos 20 pedidos por página, do mais recente ao mais antigo, com busca por
número, título ou SKU e filtros de status e conta. Datas usam `America/Sao_Paulo`;
o último dia do período é incluído integralmente. A busca e o status afetam somente
a lista; período e conta também afetam os indicadores de pedidos pagos.

O modal apresenta todos os itens importados, origem das imagens, quantidades,
custo unitário atual, total de custo e composição financeira. Suporta fechamento
por Escape, foco contido e retorno ao botão de origem. Pedidos sem itens continuam
visíveis. Preços históricos de linha, pagamentos, rastreamento, descontos e estornos
não registrados aparecem como não disponíveis, sem usar preço atual do anúncio.

O custo vem diretamente de `produtos_internos.custo_unitario`, inclusive para kits
com custo pronto. Não se recalcula a composição do kit. Cada custo unitário é
arredondado para centavos antes de multiplicar pela quantidade, e as somas usam
centavos inteiros. A fórmula é `receita - custo dos produtos - taxa - frete`.
`valor_total` é tratado como o total histórico importado do pedido; não há nova
dedução de descontos, pois a base não registra sua decomposição.

Esta é a versão de consulta com dados atuais prevista na especificação: não há
snapshots de custo, reconciliação ou reprocessamento de pedidos. Todos os resultados
calculáveis são estimados. Custo zero do cadastro, taxa/frete zero sem confirmação,
valores inválidos ou ausência de itens impedem calcular o lucro; não são tratados
como zero confirmado. O lucro agregado inclui apenas os pedidos calculáveis e a
margem usa a receita desse mesmo conjunto, sem média das margens individuais.
Os totais gerais de venda/taxa/frete consideram todos os pedidos pagos do período;
custos incompletos não são apresentados como um total completo.

O serviço Angular lê os registros do período em lotes e exibe páginas de 20 pedidos.
Para não retornar indicadores truncados, rejeita consultas acima de 20 mil registros
por conjunto e períodos maiores que 367 dias, solicitando um intervalo menor.
Para volumes maiores, o próximo passo é uma consulta agregada paginada no Postgres.

Não é necessário executar SQL ou alterar as Edge Functions para esta versão. O
Financeiro usa `environment.supabaseUrl` e `environment.supabaseKey`, como as outras
páginas, e pode ser executado com `ng serve` e os arquivos de ambiente configurados.
Não depende de endpoint próprio na pasta `api/` nem de um servidor local adicional.

A leitura não altera estoque, produtos, pedidos ou movimentos. Recuperação de itens
ausentes, snapshots históricos, correção dos importadores e rateio de fretes por
envio são evoluções separadas; não se deve apresentar os dados atuais como lucro
confirmado. Alterar um custo cadastrado muda as estimativas de vendas anteriores.

Referências da origem consultadas: [Orders](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas/gerenciamento-de-vendas),
[Provisões](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/provisoes) e
[Custos de envio](https://developers.mercadolivre.com.br/pt_br/mercadolideres-lojas-oficiais/mercado-envios-custos-e-cotacoes).
A documentação descreve `sale_fee` por unidade e frete do vendedor em `senders[].cost`;
esta versão apresenta os totais já persistidos, sem tentar corrigir taxas históricas
ou confundir custo do comprador com o do vendedor.

Os componentes de anúncios e assistente chamam, respectivamente:

```text
POST {SUPABASE_URL}/functions/v1/meli-sync
POST {SUPABASE_URL}/functions/v1/gerar-anuncio-ia
```

As requisições enviam o token da sessão no header `Authorization`. Os endpoints publicados devem corresponder aos caminhos utilizados pelos componentes. Publicar o frontend na Vercel não publica essas Edge Functions: elas são mantidas no Supabase, com suas próprias configurações e segredos.

## Comandos

| Comando | Descrição |
| --- | --- |
| `npm start` | Servidor de desenvolvimento Angular |
| `npm run build` | Build de produção em `dist/gestao/` |
| `npm run watch` | Build contínuo na configuração de desenvolvimento |
| `npm test` | Testes com Karma/Jasmine |
| `npm run serve:ssr:gestao` | Executa a entrada Node gerada pelo build |

Para executar os testes sem modo de observação, em um ambiente com Chrome instalado:

```bash
npm test -- --watch=false --browsers=ChromeHeadless
```

Os testes de autenticação estão em `src/app/auth/auth.guard.spec.ts`. Cobrem acesso sem sessão, espera pela validação, revalidação entre páginas, falha de conexão e login público. A existência desses testes não significa que a suíte tenha sido executada com sucesso neste checkout.

## Controle de acesso

A guarda controla a navegação da interface. As permissões sobre os dados continuam sendo definidas pelas políticas RLS do Supabase e pela autorização nas funções de backend. O relatório [SECURITY-CHECKUP.md](SECURITY-CHECKUP.md) registra os achados da revisão de segurança e as recomendações de correção.
